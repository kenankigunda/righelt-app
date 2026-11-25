"""Own the dedicated local process, active clock, resource limits and recovery receipts."""
import argparse
from dataclasses import asdict
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import time
from .candidate_campaign import configure, read


def advance_clock(prior, now, wall, running):
    elapsed = now-prior['lastMonotonic']
    if elapsed < 0 or wall < prior['firstWall']:
        raise ValueError('campaign clock moved backwards')
    return {**prior,'charged':prior['charged']+(elapsed if prior['running'] else 0),
            'lastMonotonic':now,'lastWall':wall,'running':running}


def start_clock(directory, authority, diagnosis):
    from .allocation import append
    from .checkpoint import atomic_json
    import psutil
    path=directory/'clock.json'
    now,wall=time.monotonic(),time.time()
    if not path.exists():
        if diagnosis:raise ValueError('no interrupted campaign to resume')
        clock={'firstWall':wall,'lastWall':wall,'lastMonotonic':now,'charged':0,
               'resumes':0,'repairSeconds':0,'boot':psutil.boot_time(),'running':False}
    else:
        prior=read(path)
        if not diagnosis:raise ValueError('existing campaign requires diagnosed recovery')
        report=read(diagnosis)
        if (not report.get('cause') or not report.get('correction') or not report.get('evidence') or
                not isinstance(report.get('repairSeconds'),(float,int)) or report['repairSeconds']<0):
            raise ValueError('incomplete diagnosed recovery')
        if prior['running']:
            # Recovery runs only after cleanup_owned observes the old group gone.
            # An unclosed interval has no trustworthy earlier end time.
            prior['charged']+=max(0,wall-prior['lastWall'])
        if prior['resumes']>=authority['maximumResumes'] or prior['repairSeconds']+report['repairSeconds']>authority['repairSeconds']:
            raise RuntimeError('diagnosed training recovery allowance exhausted')
        if wall-prior['firstWall']-prior['charged']>authority['maximumInterruptionsSeconds']:
            raise TimeoutError('training interruption allowance exhausted')
        if (directory/'training-result.json').exists():
            raise ValueError('already completed local campaign')
        clock={**prior,'resumes':prior['resumes']+1,'repairSeconds':prior['repairSeconds']+report['repairSeconds'],
               'running':False,'lastMonotonic':now,'lastWall':wall,'boot':psutil.boot_time()}
        if clock['charged']>=authority['trainingSeconds']:
            raise TimeoutError('active allocation exhausted during unclosed interval')
        append(directory/'recoveries.jsonl',{'at':wall,'resume':clock['resumes'],'diagnosis':report,
            'latest':read(directory/'latest.json')})
    clock=advance_clock(clock,now,wall,True)
    atomic_json(path,clock)
    return clock


def supervise(directory, inputs, qualification, diagnosis):
    import psutil
    from .checkpoint import atomic_json
    from .config import ROOT
    from .allocation import append
    from .processes import start_group,stop_group,register_owned,cleanup_owned,install_stop_handlers
    from .resources import AdaptivePolicy,GIB
    from .telemetry import Telemetry,artifact_bytes
    from .portable import read_bound
    import json
    install_stop_handlers()
    root=directory.parent
    lock=(root/'campaign-owner.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    cleanup_owned(directory)
    authority=json.loads(read_bound(read(inputs)['authority']))
    manifest=read(directory/'manifest.json')
    if (manifest['manifest']['resourcePolicy']!='dedicated-local-24g-v1' or
            (not qualification and not (directory/'milestones/qualified.json').exists())):
        raise ValueError('local qualification and resource policy required')
    if qualification and (directory/'clock.json').exists():
        raise ValueError('qualification cannot reopen a training campaign')
    clock=None if qualification else start_clock(directory,authority,diagnosis)
    now=time.monotonic()
    seconds=1800 if qualification else authority['trainingSeconds']-clock['charged']
    if seconds<=0:raise TimeoutError('local allocation exhausted')
    stop_wall=time.time()+seconds
    if clock:
        stop_wall=min(stop_wall,clock['firstWall']+authority['trainingSeconds']+authority['maximumInterruptionsSeconds'])
    runtime={'schema':2,'seed':manifest['manifest']['seed'],'stage':'initial','command':'tactical-practice',
        'startedMonotonic':now,'deadlineMonotonic':now+seconds,'deadlineWall':stop_wall,'reserveSeconds':10,
        'bootTime':psutil.boot_time(),'allocationId':authority['campaign'],'supervisorPid':os.getpid(),
        'manifestSha256':manifest['sha256']}
    atomic_json(directory/'runtime.json',runtime)
    atomic_json(directory/'allocation.json',{'paused':False,'stop':False,'workers':2,'reason':'initializing'})
    activity=directory/'operator-activity.json'
    # Include all new campaign bytes outside this run in the storage allowance.
    # The old archive objects are hardlinks. Counting them again is conservative.
    outside=max(0,artifact_bytes(ROOT.parent)-artifact_bytes(directory))
    worker=None
    cause='supervisor-interrupted'
    policy=AdaptivePolicy()
    try:
        with (directory/('qualification.log' if qualification else 'training.log')).open('a') as log:
            worker=start_group([sys.executable,'-m','righelt_training.candidate_campaign',
                'qualify' if qualification else 'train','--directory',str(directory),'--inputs',str(inputs)],
                cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            register_owned(directory,worker)
            awake=start_group(['/usr/bin/caffeinate','-is','-w',str(os.getpid())],stdout=log,stderr=log)
            register_owned(directory,awake)
            sensors=Telemetry(directory,activity,directory/'device-memory.json',worker.pid)
            start=time.monotonic()
            while worker.poll() is None:
                wall=time.time()
                atomic_json(activity,{'schema':1,'observedAt':wall,'developmentActive':False,
                    'rampAuthorized':True,'source':'explicit dedicated Mac reservation'})
                sample=sensors.sample()
                decision=policy.decide(sample)
                record=decision.record()
                if sample.artifact_bytes+outside>=63*GIB or sample.disk_free_bytes<=51*GIB:
                    record.update(paused=True,stop=True,reason='storage-checkpoint-reserve')
                startup=time.monotonic()-start<45 and record['reason']=='device-memory-unknown'
                if startup:
                    record.update(paused=False,workers=2,reason='initializing-device-heartbeat')
                atomic_json(directory/'allocation.json',record)
                append(directory/'resource-history.jsonl',{'at':wall,'allocation':record,'sample':asdict(sample),
                    'additionalCampaignBytes':outside})
                if clock:
                    clock=advance_clock(clock,time.monotonic(),wall,True)
                    atomic_json(directory/'clock.json',clock)
                if record['stop'] or (record['paused'] and not startup):
                    cause=record['reason']
                    raise InterruptedError('dedicated Mac resource stop: '+cause)
                if time.monotonic()>=runtime['deadlineMonotonic'] or time.time()>=stop_wall:
                    cause='clock-exhausted'
                    break
                time.sleep(min(5,max(.05,runtime['deadlineMonotonic']-time.monotonic())))
            code=worker.poll()
            if code is None and cause=='clock-exhausted':
                stop_group(worker)
            elif code:
                cause='runner-exit-'+str(code)
                raise RuntimeError('campaign worker failed: '+cause)
            if qualification:
                if not (directory/'milestones/qualified.json').exists():
                    raise ValueError('worker missing qualified exact parent')
            elif not (directory/'training-result.json').exists():
                raise RuntimeError('training stopped without final retention result')
            cause='completed'
    finally:
        if worker is not None and worker.poll() is None:stop_group(worker)
        cleanup_owned(directory,owner=os.getpid())
        if clock:
            clock=advance_clock(clock,time.monotonic(),time.time(),False)
            atomic_json(directory/'clock.json',clock)
        append(directory/'supervision.jsonl',{'at':time.time(),'qualification':qualification,'reason':cause,
            'activeSeconds':clock['charged'] if clock else 0})
        lock.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['qualify','train'])
    parser.add_argument('--inputs',type=Path,required=True)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--diagnosis',type=Path)
    args=parser.parse_args()
    configure(read(args.inputs))
    supervise(args.directory.resolve(),args.inputs.resolve(),args.mode=='qualify',args.diagnosis)


if __name__=='__main__':
    main()
