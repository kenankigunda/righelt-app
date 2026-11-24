"""One local lifecycle owns three training phases and every endpoint export."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback
import uuid

from .local_episode import wall


class PhaseStop(RuntimeError):
    def __init__(self,reason):
        self.reason=reason
        super().__init__('phase stopped: '+reason)


def read(path):return json.loads(Path(path).read_text())


def stage_endpoint(directory,name,plan):
    from .checkpoint import atomic_json
    latest=read(directory/'latest.json');target=directory/'endpoints'/name
    if (target/'endpoint.json').exists():
        if read(target/'endpoint.json')['checkpoint']!=latest:raise ValueError('sealed endpoint changed')
        return read(target/'endpoint.json')
    target.mkdir(parents=True,exist_ok=True)
    atomic_json(target/'sealed.json',{'checkpoint':latest,'sealedAt':time.time()})
    try:
        from .processes import cleanup_owned
        from .supervisor import run_phase
        from .budget import Budget
        deadline=min(time.time()+900,plan['artifactDeadlineWall'])
        now=time.monotonic();remaining=deadline-time.time()
        if remaining<60:raise TimeoutError('no export runway')
        runtime={**read(directory/'runtime.json'),'command':'export','startedMonotonic':now,
            'deadlineMonotonic':now+remaining,'deadlineWall':deadline,'reserveSeconds':30}
        try:
            with (target/'verification.log').open('a') as log:
                argv=[sys.executable,'-m','righelt_training.local_series','--plan',str(directory/'plan.json'),'--verify-child']
                reason,_=run_phase(argv,dict(os.environ),log,Budget(now,remaining,deadline),runtime,
                    directory,directory.parent,str(directory/'activity-absent.json'))
                if reason!='completed':raise ValueError('sealed endpoint verification stopped: '+reason)
            candidate=read(directory/'candidate-report.json')
        finally:
            cleanup_owned(directory)
        for filename in ('model.onnx','model.json','numeric-parity.json','candidate-report.json','runner-result.json'):
            source=directory/filename
            if source.exists():shutil.copyfile(source,target/filename)
        record={'qualified':True,'deliveryEligible':True,'checkpoint':latest,'candidate':candidate,'sealedAt':read(target/'sealed.json')['sealedAt']}
    except Exception as error:
        record={'qualified':False,'checkpoint':latest,'error':str(error),'sealedAt':read(target/'sealed.json')['sealedAt']}
    atomic_json(target/'endpoint.json',record)
    return record


def seal_recovery(directory,failure):
    """Bind the last durable state without inventing a completed runner result."""
    from .checkpoint import atomic_json,inspect_checkpoint
    latest=read(directory/'latest.json');path=Path(latest['checkpoint'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=latest['sha256']:raise ValueError('recovery checkpoint changed')
    meta=read(path.with_suffix('.json'))
    data=inspect_checkpoint(path,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    if data['updates']!=latest['updates']:raise ValueError('recovery checkpoint cursor differs')
    record={'schema':1,'kind':'local-last-durable-endpoint','checkpointSha256':latest['sha256'],
        'reason':'local-recovered-checkpoint','initiatingFailure':failure,'observedAt':time.time(),
        'completedWorkInvented':False,'browserAcceptance':'pending'}
    atomic_json(directory/'recovery-endpoint.json',record)
    return record


def phase(directory,plan,name,stop,*,targeted=False):
    from .allocation import Allocation
    from .budget import Budget
    from .checkpoint import atomic_json
    from .exploratory_contract import digest
    from .exploratory_window import configure,context
    from .processes import cleanup_owned
    from .supervisor import run_phase
    import psutil
    if stop-time.time()<600:raise TimeoutError('no bounded phase runway')
    result=directory/'runner-result.json'
    if result.exists():
        saved=directory/'phase-results';saved.mkdir(exist_ok=True)
        shutil.copyfile(result,saved/f'{name}-predecessor.json');result.unlink()
    allocation=Allocation(directory.parent,directory)
    interval,_,_=allocation.begin(name)
    now=time.monotonic();remaining=stop-time.time()
    runtime={'schema':2,'seed':plan['seed'],'stage':'initial','manifestSha256':read(directory/'manifest.json')['sha256'],
        'command':'targeted' if targeted else 'training','startedMonotonic':now,'deadlineMonotonic':now+remaining,
        'deadlineWall':stop,'reserveSeconds':min(300,remaining/4),'allocationId':allocation.accounting()[0]['id'],
        'allocationInterval':interval['id'],'supervisorPid':os.getpid(),'bootTime':psutil.boot_time(),
        'exploratoryPlanSha256':digest(plan),'localPhase':name}
    atomic_json(directory/'runtime.json',runtime)
    recipe=configure(plan);context(directory,plan,recipe)
    latest=read(directory/'latest.json') if (directory/'latest.json').exists() else plan['checkpoint']
    checkpoint=latest.get('checkpoint',latest.get('path'))
    if targeted:
        argv=[sys.executable,'-m','righelt_training.local_series','--plan',str(directory/'plan.json'),'--targeted-child']
    else:
        argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(directory),'--seed',str(plan['seed']),
            '--stage','initial','--resume',checkpoint]
    try:
        with (directory/f'{name}.log').open('a') as log:
            reason,_=run_phase(argv,dict(os.environ),log,Budget(now,remaining,stop),runtime,directory,
                directory.parent,plan.get('activityFile',str(directory/'activity-absent.json')))
        if reason!='completed':raise PhaseStop(reason)
        return read(directory/'runner-result.json')
    finally:
        cleanup_owned(directory);allocation.finish(interval['id'],reason=name+'-ended')


def targeted_child(plan,directory):
    from .runner import Runner
    from .runner_monitor import RunnerMonitor
    from .checkpoint import atomic_json
    from .portable import read_bound
    from .certificate_teacher import train
    from .exploratory_window import configure,context
    recipe=configure(plan);context(directory,plan,recipe)
    latest=read(directory/'latest.json');runtime=read(directory/'runtime.json')
    with RunnerMonitor(directory) as monitor:
        with monitor.operation('targeted-full-restore',300):
            runner=Runner(directory,plan['seed'],'initial',resume=Path(latest['checkpoint']),monitor=monitor)
        packet=json.loads(read_bound(plan['certificatePool']))
        guards=json.loads(read_bound(plan['nativeManifest']['evaluationGuards']))
        result=train(runner,packet,guards,runner.deadline-60)
        runner.checkpoint()
        atomic_json(directory/'runner-result.json',{'schema':1,'state':runner.state,'status':'stopped',
            'reason':'budget-or-resource-stop','localPhase':'targeted','targeted':result,
            'trainingHealthOnly':True,'productionGatesPassed':False})


def drive(plan,gate):
    from .checkpoint import atomic_json
    from .config import ROOT
    from .exploratory_contract import validate,validate_gate,digest
    from .exploratory_window import configure,context
    from .local_episode import validate as local_validate
    from .manifest import write_manifest
    from .allocation import Allocation,append
    from .processes import cleanup_owned,install_stop_handlers
    from .portable import contained
    authority=local_validate(validate(plan));directory=contained(ROOT,plan['runDir'])
    directory.mkdir(parents=True,exist_ok=True)
    with (directory.parent/'series-owner.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        configure(plan);validate_gate(read(gate),plan['sourceRevision'],'mps',plan)
        native=copy.deepcopy(plan['nativeManifest']);native['exploratoryWindow']=plan
        if (directory/'manifest.json').exists():
            if read(directory/'manifest.json')['manifest']!=native:raise ValueError('series manifest changed')
        else:write_manifest(directory/'manifest.json',native)
        atomic_json(directory/'plan.json',plan)
        allocation=Allocation(directory.parent,directory)
        if not allocation.events():
            append(allocation.path,{'event':'created','allocation':str(directory),'stage':'initial',
                'seconds':plan['artifactDeadlineWall']-time.time(),'id':uuid.uuid4().hex,'observedAt':time.time(),
                'exploratoryPlanSha256':digest(plan),'authorization':plan['authorizationReference']})
        elif allocation.accounting()[0].get('exploratoryPlanSha256')!=digest(plan):raise ValueError('series allocation changed')
        # Relaunching the lifecycle requires an explicit bounded repair, never KeepAlive.
        if (directory/'series-started.json').exists():raise ValueError('lifecycle already started; inspect durable recovery first')
        atomic_json(directory/'series-started.json',{'pid':os.getpid(),'created':__import__('psutil').Process().create_time(),
            'observedAt':time.time(),'planSha256':digest(plan)})
        # Conservative accounting charges all preparation as an upper bound on
        # its experimental portion, including qualification and repair waits.
        experimental_preparation=max(0,time.time()-wall(authority['kickoff']))
        append(directory/'experimental-events.jsonl',{'event':'preparation-upper-bound',
            'seconds':experimental_preparation,'observedAt':time.time()})
        install_stop_handlers();awake=None;failure=None;endpoints=[]
        if sys.platform=='darwin':awake=subprocess.Popen(['/usr/bin/caffeinate','-is','-w',str(os.getpid())])
        try:
            phase(directory,plan,'broad',wall(authority['boundaries']['broad']))
            context(directory,plan,configure(plan))
            broad=stage_endpoint(directory,'broad',plan);endpoints.append(broad)
            if not broad['qualified']:raise ValueError('broad endpoint did not qualify')
            if plan.get('certificatePool') and time.time()<wall(authority['boundaries']['targeted'])-900:
                experimental_start=time.time()
                experimental_stop=min(wall(authority['boundaries']['targeted']),experimental_start+18000,
                    experimental_start+max(0,authority['caps']['experimentalSeconds']-experimental_preparation))
                append(directory/'experimental-events.jsonl',{'event':'targeted-started','observedAt':experimental_start,
                    'stopWall':experimental_stop,'remainingSeconds':max(0,authority['caps']['experimentalSeconds']-experimental_preparation)})
                try:
                    phase(directory,plan,'targeted',experimental_stop,targeted=True)
                    targeted=read(directory/'targeted-result.json')
                    endpoint=stage_endpoint(directory,'targeted',plan);endpoints.append(endpoint)
                    if not (targeted['accepted'] and endpoint['qualified']):
                        atomic_json(directory/'latest.json',broad['checkpoint'])
                        atomic_json(directory/'targeted-disposition.json',{'accepted':False,'fallback':'broad','result':targeted})
                except Exception as error:
                    cleanup_owned(directory)
                    atomic_json(directory/'targeted-disposition.json',{'accepted':False,'fallback':'broad','error':str(error)})
                    atomic_json(directory/'latest.json',broad['checkpoint'])
                finally:
                    append(directory/'experimental-events.jsonl',{'event':'targeted-ended','observedAt':time.time(),
                        'seconds':time.time()-experimental_start})
            phase(directory,plan,'consolidation',plan['trainingStopWall'])
            context(directory,plan,configure(plan))
            endpoints.append(stage_endpoint(directory,'final',plan))
        except BaseException as error:
            failure={'type':type(error).__name__,'error':str(error),'reason':getattr(error,'reason',None),
                'traceback':traceback.format_exc(),'observedAt':time.time()}
            atomic_json(directory/'series-failure.json',failure)
        finally:
            cleanup_owned(directory)
            # Automatic finishing is owned here, outside any killable training child.
            if (directory/'latest.json').exists() and time.time()<plan['artifactDeadlineWall']:
                try:
                    context(directory,plan,configure(plan))
                    if not (directory/'endpoints/final/endpoint.json').exists():
                        seal_recovery(directory,failure)
                        recovered=stage_endpoint(directory,'recovered-final',plan)
                        # Correctness failures never supersede the earlier passing fallback.
                        recovered['deliveryEligible']=not failure or failure.get('reason') in (
                            'resource-pressure-stop','local-artifact-cap','local-disk-reserve','budget-expired')
                        atomic_json(directory/'endpoints/recovered-final/endpoint.json',recovered)
                        endpoints.append(recovered)
                except Exception as error:
                    atomic_json(directory/'finisher-failure.json',{'error':str(error),'observedAt':time.time()})
            atomic_json(directory/'series-result.json',{'schema':1,'state':'completed' if not failure else 'stopped',
                'endpoints':endpoints,'failure':failure,'cleanupVerified':True,'observedAt':time.time(),
                'defaultPromotion':False,'strengthEstablished':False,'browserAcceptance':'pending'})
            if awake is not None:awake.terminate();awake.wait(timeout=5)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--gate-report',type=Path);parser.add_argument('--targeted-child',action='store_true')
    parser.add_argument('--verify-child',action='store_true')
    args=parser.parse_args();plan=read(args.plan)
    from .config import ROOT
    from .arithmetic import ieee_fp32
    with ieee_fp32():
        if args.verify_child:
            from .exploratory_window import configure,verify
            from .runner_monitor import RunnerMonitor
            configure(plan)
            with RunnerMonitor(ROOT/plan['runDir']) as monitor:
                with monitor.operation('endpoint-export-and-numerical-verification',900):verify(ROOT/plan['runDir'],plan)
        elif args.targeted_child:targeted_child(plan,ROOT/plan['runDir'])
        else:
            if not args.gate_report:parser.error('--gate-report required')
            drive(plan,args.gate_report)


if __name__=='__main__':main()
