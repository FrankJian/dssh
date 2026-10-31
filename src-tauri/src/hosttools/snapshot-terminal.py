# Optional Python 3 controller on the selected asset. Standard library only;
# output is serialized by this process, while three fixed sh probes run in parallel.
import base64
import json
import os
import selectors
import signal
import subprocess
import sys
import time

configs = json.loads(base64.b64decode(sys.argv[1]))
selector = selectors.DefaultSelector()
records = []
interrupted = False

def interrupted_by_signal(_signum, _frame):
    global interrupted
    interrupted = True

for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(signum, interrupted_by_signal)


def stop_probe(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        # Restricted environments may deny process-group signals. A failure to
        # cancel one probe must never discard the other probe results.
        try:
            proc.kill()
        except OSError:
            pass

def finish(record, stop=False):
    proc = record['proc']
    try:
        selector.unregister(proc.stdout)
    except (KeyError, ValueError):
        pass
    if stop:
        stop_probe(proc)
    proc.stdout.close()
    try:
        record['code'] = proc.wait(timeout=0.3)
    except subprocess.TimeoutExpired:
        record['timeout'] = True
        stop_probe(proc)
        try:
            record['code'] = proc.wait(timeout=0.3)
        except subprocess.TimeoutExpired:
            record['code'] = None
    record['done'] = True

try:
    for script, timeout, limit in configs:
        record = dict(data=bytearray(), timeout=False, truncated=False, code=1,
                      done=False, deadline=time.monotonic()+timeout, limit=limit, proc=None)
        records.append(record)
        try:
            proc = subprocess.Popen(['sh', '-c', script], stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    start_new_session=True)
            record['proc'] = proc
            selector.register(proc.stdout, selectors.EVENT_READ, record)
        except OSError:
            record['done'] = True
    while selector.get_map():
        if interrupted:
            raise KeyboardInterrupt
        now = time.monotonic()
        for record in records:
            if not record['done'] and now >= record['deadline']:
                record['timeout'] = True
                finish(record, True)
        for key, _ in selector.select(0.05):
            record = key.data
            if record['done']:
                continue
            chunk = os.read(key.fileobj.fileno(), 8192)
            if not chunk:
                finish(record)
                continue
            room = record['limit']-len(record['data'])
            record['data'].extend(chunk[:max(0, room)])
            if len(chunk) > room:
                record['truncated'] = True
                finish(record, True)
    partial = False
    for index, record in enumerate(records):
        sys.stdout.buffer.write(b'\n'+record['data'])
        failed = record['timeout'] or record['truncated'] or record['code'] != 0
        if index < 2:
            partial = partial or failed
        elif failed:
            sys.stdout.buffer.write('\n@@DSSH:DOCKER_WARNING\nDocker \u91c7\u96c6\u8d85\u65f6\u3001\u5931\u8d25\u6216\u622a\u65ad\u3002\n'.encode('utf-8'))
    sys.stdout.buffer.write(b'\n@@DSSH:END\n')
    sys.stdout.buffer.flush()
    sys.exit(1 if partial else 0)
finally:
    for record in records:
        if not record['done'] and record['proc'] is not None:
            finish(record, True)
    selector.close()
