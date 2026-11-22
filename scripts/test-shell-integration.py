"""Exercise bundled hooks in an isolated PTY without loading user config files."""
import json
import os
import pathlib
import pty
import select
import signal
import sys
import tempfile
import time

shell = sys.argv[1]
scenario = sys.argv[2] if len(sys.argv) > 2 else "normal"
selected = sys.argv[3] if len(sys.argv) > 3 else shell
source = pathlib.Path(__file__).resolve().parents[1] / "src-tauri/src/ssh/shell_integration"
script = (source / (selected + ".sh")).read_text()
encoded = " builtin eval $'" + script.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'\r"

with tempfile.TemporaryDirectory(prefix="duossh-shell-") as directory:
    pathlib.Path(directory, "example.txt").write_text("example\n")
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(directory)
        env = dict(os.environ, TERM="xterm-256color", PS1="demo$ ", PROMPT="demo% ",
                   ZDOTDIR=directory, HISTFILE=os.devnull)
        args = ["--noprofile", "--norc", "-i"] if shell == "bash" else ["-dfi"]
        os.execve("/bin/" + shell, ["/bin/" + shell] + args, env)
    os.set_blocking(fd, False)

    def read():
        buffer = b""
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.15)[0]:
                try:
                    packet = os.read(fd, 65536)
                    if not packet:
                        break
                    buffer += packet
                except OSError:
                    break
            elif buffer:
                break
        return buffer.decode("utf8", "replace")

    events = []

    def command(value):
        data = value.encode()
        position = 0
        early = b""
        deadline = time.monotonic() + 5
        # Drain echo while sending: PTY write may be partial or backpressured.
        while position < len(data) and time.monotonic() < deadline:
            readable, writable, _ = select.select([fd], [fd], [], 0.05)
            if readable:
                try:
                    early += os.read(fd, 65536)
                except BlockingIOError:
                    pass
            if writable:
                try:
                    position += os.write(fd, data[position:position + 128])
                except BlockingIOError:
                    pass
        assert position == len(data), "PTY input timeout"
        output = early.decode("utf8", "replace") + read()
        events.append({"input": value, "output": output})

    try:
        initial = read()
        setup = "alias ll='ls -l'; "
        if scenario == "conflict":
            setup += "trap ':' DEBUG" if shell == "bash" else "typeset -ar precmd_functions=()"
        elif shell == "bash":
            setup += "PS1='before$ '; PROMPT_COMMAND='printf \"old-hook:%s\\n\" \"$?\"'"
        else:
            setup += "PROMPT='before%% '; precmd() { printf 'old-hook:%s\\n' \"$?\"; }; precmd_functions=(); preexec_functions=()"
        command(setup + "\r")
        command(encoded)
        command("ll\r")
        command("false\r")
        command('printf "status:%s\\n" "$?"\r')
        command(encoded)
        command("ll\r")
        command("exit\r")
        assert sorted(os.listdir(directory)) == ["example.txt"], "hooks must not create config files"
        print(json.dumps({"shell": shell, "bytes": len(encoded.encode()), "initial": initial, "events": events}))
    finally:
        os.close(fd)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
