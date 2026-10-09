"""Hard-bounded child groups; killing a promise cannot stop recursive engine work."""
import os
import signal
import subprocess
import time
import uuid


def start_group(argv, **kwargs):
    token=uuid.uuid4().hex
    env=dict(kwargs.pop('env',os.environ));env['RIGHELT_COMPUTE_GROUP_TOKEN']=token
    process=subprocess.Popen(argv,start_new_session=True,env=env,**kwargs)
    process._righelt_group_token=token
    return process


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


def has_exited(process):
    """A zombie cannot compute. Unreadable state is not evidence of exit."""
    import psutil
    try:return not process.is_running() or process.status()==psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:return True
    except psutil.AccessDenied:return False


# Ownership is independently readable by the coordinator if a supervisor stalls.
def register_owned(directory,process):
    from .allocation import append,identity
    from pathlib import Path
    record=identity(process.pid)
    append(Path(directory)/'process-ownership.jsonl',{**record,'group':os.getpgid(process.pid),'owner':os.getpid(),
        'groupToken':getattr(process,'_righelt_group_token',None)})
    return record


def cleanup_owned(directory,owner=None):
    import psutil
    from pathlib import Path
    from .allocation import rows,alive
    records=rows(Path(directory)/'process-ownership.jsonl')
    records=[record for record in records if owner is None or record.get('owner')==owner]
    # A live, identity-matching leader is an ancestry witness even for legacy
    # records. Keep these Process objects: psutil.kill checks their birth times.
    witnessed={}
    for record in records:
        if not alive(record):continue
        try:
            leader=psutil.Process(record['pid'])
            if leader.create_time()!=record['created']:continue
            if os.getpgid(leader.pid)!=record['group']:raise RuntimeError('owned process group changed')
            for process in leader.children(recursive=True)+[leader]:
                witnessed[(process.pid,process.create_time())]=process
        except (ProcessLookupError,psutil.NoSuchProcess):pass
    tokens={}
    for record in records:
        token=record.get('groupToken')
        if isinstance(token,str) and token:
            tokens[token]=min(tokens.get(token,record['created']),record['created'])
    earliest=min(tokens.values(),default=float('inf'))
    deadline=time.monotonic()+3
    while True:
        targets=dict(witnessed)
        for process in psutil.process_iter():
            try:
                birth=process.create_time()
                if (process.pid,birth) in targets:continue
                if birth<earliest:continue
                # Detached descendants (including Chromium) inherit the unique
                # allocation token but intentionally create another group/session.
                # The token, creation time and same user establish ownership;
                # group numbers alone never do. Process.kill checks PID reuse.
                if process.uids().real!=os.getuid():continue
                if has_exited(process):continue
                group=os.getpgid(process.pid)
                try:token=process.environ().get('RIGHELT_COMPUTE_GROUP_TOKEN')
                except psutil.AccessDenied:
                    # Exit can race the environment read after the first status
                    # sample. Require fresh exit evidence, never infer it from
                    # denied access alone.
                    if has_exited(process):continue
                    # A known group must be inspectable to verify cleanup. An
                    # unrelated protected process grants no authority to kill it.
                    if any(record['group']==group for record in records):raise
                    continue
                if token in tokens and birth>=tokens[token]:
                    targets[(process.pid,birth)]=process
            except (ProcessLookupError,psutil.NoSuchProcess):continue
        live=[]
        for identity,process in targets.items():
            try:
                if not process.is_running() or process.status()==psutil.STATUS_ZOMBIE:continue
                # Process.kill verifies PID/create-time before signalling; never
                # send killpg to a number whose original leader has disappeared.
                process.kill();live.append(process)
            except (ProcessLookupError,psutil.NoSuchProcess):pass
        if not live:return
        witnessed=targets
        psutil.wait_procs(live,timeout=min(.1,max(0,deadline-time.monotonic())))
        if time.monotonic()>=deadline:
            if any(p.is_running() and p.status()!=psutil.STATUS_ZOMBIE for p in live):
                raise RuntimeError('owned compute did not stop')
            # One final scan catches children forked just before parent death.
            deadline=time.monotonic()+.1
