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


# Ownership is independently readable by the coordinator if a supervisor stalls.
def register_owned(directory,process):
    from .allocation import append,identity
    from pathlib import Path
    record=identity(process.pid)
    append(Path(directory)/'process-ownership.jsonl',{**record,'group':os.getpgid(process.pid),'owner':os.getpid()})
    return record


def cleanup_owned(directory,owner=None):
    import psutil
    from pathlib import Path
    from .allocation import rows,alive
    records=rows(Path(directory)/'process-ownership.jsonl')
    targets=[]
    for record in records:
        if owner is not None and record.get('owner')!=owner:continue
        if not alive(record):continue
        try:
            process=psutil.Process(record['pid'])
            if os.getpgid(process.pid)!=record['group']:raise RuntimeError('owned process group changed')
            # Capture identities before killing the group leader; wait/reap checks
            # must not accidentally match a reused PID.
            targets.extend(process.children(recursive=True));targets.append(process)
            os.killpg(record['group'],signal.SIGKILL)
        except ProcessLookupError:pass
    _,live=psutil.wait_procs(targets,timeout=3)
    if any(p.is_running() and p.status()!=psutil.STATUS_ZOMBIE for p in live):
        raise RuntimeError('owned compute did not stop')
