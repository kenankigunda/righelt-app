"""Hard-bounded child groups; killing a promise cannot stop recursive engine work."""
import os
import signal
import subprocess
import time


def start_group(argv, **kwargs):
    return subprocess.Popen(argv,start_new_session=True,**kwargs)


def stop_group(process, grace_seconds=0):
    try:os.killpg(process.pid,signal.SIGTERM if grace_seconds else signal.SIGKILL)
    except ProcessLookupError:return
    try:process.wait(timeout=grace_seconds or 2)
    except subprocess.TimeoutExpired:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=2)


def install_stop_handlers():
    def stop(signum,frame):
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM,stop)
