"""Run a short interactive-shell fixture on a real, bounded controlling PTY."""

import errno
import os
import pty
import select
import signal
import sys
import time


def main():
    commands = sys.stdin.buffer.read()
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])

    output = bytearray()
    status = None
    eof = False
    deadline = time.monotonic() + 3
    try:
        os.set_blocking(master, False)
        while time.monotonic() < deadline:
            readable, writable, _ = select.select(
                [] if eof else [master], [master] if commands else [], [], 0.05
            )
            if writable:
                try:
                    count = os.write(master, commands[:4096])
                    commands = commands[count:]
                except BlockingIOError:
                    pass
            if readable:
                try:
                    chunk = os.read(master, 8192)
                    output.extend(chunk)
                    eof = not chunk
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    eof = True
            elif eof:
                time.sleep(0.01)

            child, child_status = os.waitpid(pid, os.WNOHANG)
            if child:
                status = child_status
                # Drain output already buffered when the shell exited.
                while not eof and select.select([master], [], [], 0)[0]:
                    try:
                        chunk = os.read(master, 8192)
                        output.extend(chunk)
                        eof = not chunk
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        eof = True
                break
    finally:
        os.close(master)
        if status is None:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)

    sys.stdout.buffer.write(output)
    if status is None:
        print("Interactive shell fixture exceeded its 3-second deadline", file=sys.stderr)
        return 124
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
