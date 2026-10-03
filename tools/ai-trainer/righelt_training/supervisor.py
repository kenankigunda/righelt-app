"""External watchdog: resource policy and hard process-group deadline enforcement."""
import argparse
import fcntl
import hashlib
from dataclasses import asdict
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid
import psutil

from .budget import Budget
from .checkpoint import atomic_json
from .config import CONFIG,CONFIG_SHA256,ROOT
from .manifest import build_manifest,write_manifest
from .processes import start_group,stop_group,install_stop_handlers
from .resources import AdaptivePolicy
from .telemetry import Telemetry,read_device_memory


def validate_gate_report(report, source_revision, stage):
    if report.get('sourceRevision')!=source_revision or report.get('configSha256')!=CONFIG_SHA256:
        raise ValueError('gate report does not match committed source and configuration')
    for name in ('coreTests','trainerTests','exactReplay','exportParity'):
        gate=report.get('checks',{}).get(name,{})
        if gate.get('passed') is not True or not gate.get('evidence'):
            raise ValueError(f'launch gate missing: {name}')
    parity=report['checks']['exportParity']
    if parity.get('heldoutStates',0)<1000 or parity.get('legalMasksPassed') is not True or parity.get('tacticalParityPassed') is not True:
        raise ValueError('export parity acceptance proof is incomplete')
    if stage=='overnight':
        health=report.get('health',{})
        if (health.get('terminalGames',0)<100 or health.get('distinctRecoverableTrainedCheckpoints',0)<2
            or health.get('finiteNonzeroUpdates') is not True or health.get('unresolvedCorrectnessFailures',1)!=0
            or health.get('trainedExportParityPassed') is not True or health.get('unfinishedAttempts',[])
            or health.get('progressReportPublished') is not True):
            raise ValueError('overnight health or progress-report gate missing')


def validation_boundary(runtime,now=None):
    duration=runtime['deadlineMonotonic']-runtime['startedMonotonic']
    boundary=runtime['startedMonotonic']+duration*5/6
    if 'deadlineWall' in runtime:
        now=time.monotonic() if now is None else now
        boundary=min(boundary,now+(runtime['deadlineWall']-duration/6-time.time()))
    return boundary


def validate_training_window(runtime,now):
    if runtime['command']=='training' and now>=validation_boundary(runtime,now):
        raise ValueError('training window ended; resume health, preparation or arena within the original validation reserve')


def request_validation_handoff(run_dir,runtime,now):
    if runtime.get('command')!='training' or now<validation_boundary(runtime,now):return False
    directory=Path(run_dir);path=directory/'handoff-request.json'
    request_id=f"automatic-validation:{runtime['manifestSha256']}:{runtime['deadlineMonotonic']}"
    if path.exists():
        pending=json.loads(path.read_text())
        if pending.get('id')==request_id:return False
        # Preserve an outstanding manual request. A consumed manual request may
        # remain on disk after an earlier checkpoint/resume; it cannot disable
        # the later automatic validation boundary.
        latest=directory/'latest.json'
        consumed=None
        if latest.exists():
            checkpoint=Path(json.loads(latest.read_text())['checkpoint'])
            consumed=json.loads(checkpoint.with_suffix('.runner.json').read_text())['state'].get('lastHandoffId')
        if pending.get('id')!=consumed:return False
    atomic_json(path,{'schema':1,'id':request_id,'reason':'validation',
                     'manifestSha256':runtime['manifestSha256']})
    return True


def supervise(process,budget,policy,telemetry,run_dir,*,clock=time.monotonic,sleep=time.sleep,sample_seconds=None,runtime=None):
    sample_seconds=sample_seconds or CONFIG['resources']['sampleSeconds']
    next_sample=clock();paused_since=None
    events=Path(run_dir)/'resource-events.jsonl'
    try:
        while process.poll() is None:
            now=clock()
            if budget.remaining(now)<=0:
                stop_group(process)
                return 'budget-expired'
            if runtime is not None:request_validation_handoff(run_dir,runtime,now)
            if runtime is not None and runtime.get('command')=='training' and now>=validation_boundary(runtime,now)+60:
                stop_group(process)
                return 'validation-handoff-timeout'
            if now>=next_sample:
                try:
                    sample=telemetry.sample()
                except (RuntimeError, OSError) as error:
                    with events.open('a') as f:
                        f.write(json.dumps({'event':'telemetry-failed','error':str(error)})+'\n')
                    stop_group(process)
                    return 'telemetry-failed'
                allocation=policy.decide(sample)
                atomic_json(Path(run_dir)/'allocation.json',{**allocation.record(),'observedAt':sample.now})
                with events.open('a') as f:
                    f.write(json.dumps({'sample':asdict(sample),'allocation':allocation.record()},allow_nan=False)+'\n');f.flush()
                if allocation.stop:
                    stop_group(process)
                    return allocation.reason
                if allocation.paused:
                    if paused_since is None:
                        paused_since=now
                        # The runner checkpoints between bounded operations. A blocked runner
                        # cannot defeat this external watchdog or extend the run budget.
                        try:
                            if read_device_memory(Path(run_dir)/'device-memory.json',process.pid)[1]:
                                os.kill(process.pid,signal.SIGUSR1)
                        except ProcessLookupError:pass
                    elif now-paused_since>=sample_seconds:
                        stop_group(process)
                        return 'resource-pressure-stop'
                else:paused_since=None
                next_sample=now+sample_seconds
            sleep(min(.25,budget.remaining(clock())))
        return 'completed' if process.returncode==0 else 'runner-failed'
    finally:
        stop_group(process)


def claim_stage(artifact_root, stage, run_directory):
    path=Path(artifact_root)/'budget-ledger.json'
    ledger=json.loads(path.read_text()) if path.exists() else {'schema':1,'stages':{}}
    location=str(Path(run_directory).resolve())
    prior=ledger['stages'].get(stage)
    if prior is not None and prior!=location:
        raise ValueError(f'{stage} stage already claimed; resume its original run instead of resetting budget')
    ledger['stages'][stage]=location
    atomic_json(path,ledger)


def arena_arguments(args,artifact_root):
    prepare=getattr(args,'prepare_arena',False)
    if prepare and (args.arena_plan or getattr(args,'health',False)):raise ValueError('preparation is exclusive with arena and health')
    if not args.arena_plan and not prepare:
        if args.candidate_checkpoint or args.opponent_checkpoint:raise ValueError('arena checkpoint paths require a frozen plan')
        return None
    if not args.run_dir.exists() or not args.resume:raise ValueError('arena reuses an existing supervised run and original deadline')
    if not args.candidate_checkpoint or not args.opponent_checkpoint:raise ValueError('both frozen arena checkpoints required')
    if args.arena_plan and not args.arena_plan.resolve().is_relative_to(args.run_dir.resolve()):raise ValueError('arena plan must belong to this run')
    for path in (args.candidate_checkpoint,args.opponent_checkpoint):
        if not path.resolve().is_relative_to(artifact_root.resolve()):raise ValueError('arena checkpoints must remain in experiment archive')
    if prepare:return None
    from .arena import read_frozen_plan
    _,digest=read_frozen_plan(args.arena_plan)
    return digest


def parity_arguments(args,artifact_root):
    if not args.export_parity:
        if args.parity_corpus:raise ValueError('parity corpus requires export-parity phase')
        return None
    if args.arena_plan or args.prepare_arena or args.health:raise ValueError('export parity is an exclusive phase')
    if not args.resume or not args.run_dir.exists():raise ValueError('export parity requires original run and trained checkpoint resume')
    if not args.parity_corpus or not args.parity_corpus.resolve().is_relative_to(artifact_root.resolve()):raise ValueError('parity corpus must be under experiment archive')
    return hashlib.sha256(args.parity_corpus.read_bytes()).hexdigest()


def record_attempt(directory,event):
    with (Path(directory)/'supervisor-attempts.jsonl').open('a') as stream:
        stream.write(json.dumps({**event,'observedAt':time.time()},allow_nan=False)+'\n')
        stream.flush();os.fsync(stream.fileno())


def main():
    install_stop_handlers()
    parser=argparse.ArgumentParser()
    parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--activity-file',type=Path,required=True)
    parser.add_argument('--gate-report',type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True)
    parser.add_argument('--resume',type=Path)
    parser.add_argument('--arena-plan',type=Path)
    parser.add_argument('--health',action='store_true')
    parser.add_argument('--prepare-arena',action='store_true')
    parser.add_argument('--export-parity',action='store_true')
    parser.add_argument('--parity-corpus',type=Path)
    parser.add_argument('--candidate-checkpoint',type=Path)
    parser.add_argument('--opponent-checkpoint',type=Path)
    args=parser.parse_args()
    artifact_root=ROOT/'.ai-runs'
    parity_digest=parity_arguments(args,artifact_root)
    arena_digest=arena_arguments(args,artifact_root)
    if args.health and (arena_digest or not args.run_dir.exists() or not args.resume):
        raise ValueError('health requires an existing supervised allocation and cannot run alongside arena')
    if not args.run_dir.resolve().is_relative_to(artifact_root.resolve()):
        raise ValueError('run directories must be under .ai-runs for aggregate artifact accounting')
    if args.resume and not args.resume.resolve().is_relative_to(artifact_root.resolve()):
        raise ValueError('resume checkpoints must remain in the aggregate experiment archive')
    artifact_root.mkdir(parents=True,exist_ok=True)
    # Kernel lock survives no crashed process, prevents competing supervisors.
    lock=(artifact_root/'supervisor.lock').open('a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    manifest=build_manifest(args.seed,args.stage)
    validate_gate_report(json.loads(args.gate_report.read_text()),manifest['sourceRevision'],args.stage)
    if args.resume and not args.run_dir.exists() and args.stage!='overnight':
        raise ValueError('initial-stage resume must retain its original directory and budget')
    runtime_path=args.run_dir/'runtime.json'
    if args.run_dir.exists():
        if not args.resume:raise ValueError('existing run requires an explicit checkpoint resume')
        original=json.loads((args.run_dir/'manifest.json').read_text())
        runtime=json.loads(runtime_path.read_text())
        old=original['manifest']
        if any(old[k]!=manifest[k] for k in ('sourceRevision','configSha256','seed','stage','dependencies','lockHashes')):
            raise ValueError('resume source, dependencies or stage changed')
        if runtime.get('bootTime')!=psutil.boot_time():raise ValueError('cannot reuse monotonic budget after reboot')
        digest=original['sha256'];started=runtime['startedMonotonic']
        budget=Budget(started,runtime['deadlineMonotonic']-started,runtime['deadlineWall'])
        if budget.remaining(time.monotonic())<=0:raise ValueError('original budget expired; no reset permitted')
    else:
        args.run_dir.mkdir(parents=True)
        digest=write_manifest(args.run_dir/'manifest.json',manifest)
        started=time.monotonic();wall_started=time.time();budget=Budget(started,manifest['seconds'],wall_started+manifest['seconds'])
        runtime={'schema':1,'startedMonotonic':started,'deadlineMonotonic':started+budget.seconds,'startedWall':wall_started,'deadlineWall':budget.wall_deadline,
                 'manifestSha256':digest,'stage':args.stage,'seed':args.seed,'bootTime':psutil.boot_time()}
    if args.resume:
        metadata=json.loads(args.resume.with_suffix('.json').read_text())
        if metadata['configSha256']!=CONFIG_SHA256:raise ValueError('resume checkpoint configuration changed')
        runtime['parentCheckpointManifestSha256']=metadata['manifestSha256']
        runtime['parentCheckpoint']=str(args.resume.resolve())
    runtime['supervisorPid']=os.getpid()
    runtime['command']='export-parity' if args.export_parity else 'prepare-arena' if args.prepare_arena else 'health' if args.health else 'arena' if arena_digest else 'training'
    validate_training_window(runtime,time.monotonic())
    if parity_digest:
        runtime['parityCorpusSha256']=parity_digest
        runtime['parityCorpusPath']=str(args.parity_corpus.resolve())
    runtime['supervisorAttempt']=uuid.uuid4().hex
    if arena_digest:runtime['arenaPlanSha256']=arena_digest
    else:runtime.pop('arenaPlanSha256',None)
    atomic_json(runtime_path,runtime)
    atomic_json(args.run_dir/'allocation.json',{'workers':CONFIG['resources']['minWorkers'],
                'memory_gib':CONFIG['resources']['minMemoryGiB'],'paused':False,'stop':False,
                'reason':'initial-conservative','observedAt':time.time()})
    claim_stage(artifact_root,args.stage,args.run_dir)
    if args.export_parity:
        argv=[sys.executable,'-m','righelt_training.export_parity','--run-dir',str(args.run_dir.resolve()),
              '--checkpoint',str(args.resume.resolve()),'--corpus',str(args.parity_corpus.resolve())]
    elif args.prepare_arena:
        argv=[sys.executable,'-m','righelt_training.prepare_arena','--run-dir',str(args.run_dir.resolve()),
              '--candidate-checkpoint',str(args.candidate_checkpoint.resolve()),'--opponent-checkpoint',str(args.opponent_checkpoint.resolve())]
    elif args.health:
        argv=[sys.executable,'-m','righelt_training.health','--run-dir',str(args.run_dir.resolve())]
    elif arena_digest:
        argv=[sys.executable,'-m','righelt_training.arena','run','--run-dir',str(args.run_dir.resolve()),
              '--plan',str(args.arena_plan.resolve()),'--candidate-checkpoint',str(args.candidate_checkpoint.resolve()),
              '--opponent-checkpoint',str(args.opponent_checkpoint.resolve())]
    else:
        argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(args.run_dir.resolve()),'--seed',str(args.seed),'--stage',args.stage]
        if args.resume:argv+=['--resume',str(args.resume.resolve())]
    env={**os.environ,'PYTHONPATH':str(ROOT/'tools/ai-trainer')}
    record_attempt(args.run_dir,{'event':'started','id':runtime['supervisorAttempt'],'phase':runtime['command'],'pid':os.getpid()})
    with (args.run_dir/'runner.log').open('a') as log:
        process=start_group(['/usr/bin/nice','-n','10',*argv],cwd=ROOT,env=env,stdout=log,stderr=log)
        reason=supervise(process,budget,AdaptivePolicy(),Telemetry(artifact_root,args.activity_file,args.run_dir/'device-memory.json',process.pid),args.run_dir,runtime=runtime)
    record_attempt(args.run_dir,{'event':'finished','id':runtime['supervisorAttempt'],'phase':runtime['command'],'reason':reason})
    atomic_json(args.run_dir/'supervisor-result.json',{'reason':reason,'runnerReturncode':process.returncode,
                'elapsedSeconds':time.monotonic()-started,'budgetSeconds':budget.seconds,'productionPromotion':False})
    print(json.dumps({'reason':reason,'runDir':str(args.run_dir)}))

if __name__=='__main__':main()
