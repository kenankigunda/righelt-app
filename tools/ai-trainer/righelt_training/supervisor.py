"""External watchdog: resource policy and hard process-group deadline enforcement."""
import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import signal
import sys
import time
import psutil

from .budget import Budget
from .checkpoint import atomic_json
from .config import CONFIG,CONFIG_SHA256,ROOT
from .manifest import build_manifest,write_manifest
from .processes import start_group,stop_group
from .resources import AdaptivePolicy
from .telemetry import Telemetry


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
            or health.get('progressReportPublished') is not True):
            raise ValueError('overnight health or progress-report gate missing')


def supervise(process,budget,policy,telemetry,run_dir,*,clock=time.monotonic,sleep=time.sleep,sample_seconds=None):
    sample_seconds=sample_seconds or CONFIG['resources']['sampleSeconds']
    next_sample=clock();paused_since=None
    events=Path(run_dir)/'resource-events.jsonl'
    try:
        while process.poll() is None:
            now=clock()
            if budget.remaining(now)<=0:
                stop_group(process)
                return 'budget-expired'
            if now>=next_sample:
                sample=telemetry.sample();allocation=policy.decide(sample)
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
                        try:os.kill(process.pid,signal.SIGUSR1)
                        except ProcessLookupError:pass
                    elif now-paused_since>=sample_seconds:
                        stop_group(process)
                        return 'resource-pressure-stop'
                else:paused_since=None
                next_sample=now+sample_seconds
            sleep(min(.25,budget.remaining(clock())))
        return 'completed' if process.returncode==0 else 'runner-failed'
    finally:
        if process.poll() is None:stop_group(process)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--activity-file',type=Path,required=True)
    parser.add_argument('--gate-report',type=Path,required=True)
    parser.add_argument('--stage',choices=('initial','overnight'),required=True)
    parser.add_argument('--seed',type=int,required=True)
    parser.add_argument('--resume',type=Path)
    args=parser.parse_args()
    manifest=build_manifest(args.seed,args.stage)
    validate_gate_report(json.loads(args.gate_report.read_text()),manifest['sourceRevision'],args.stage)
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
        budget=Budget(started,runtime['deadlineMonotonic']-started)
        if budget.remaining(time.monotonic())<=0:raise ValueError('original budget expired; no reset permitted')
    else:
        args.run_dir.mkdir(parents=True)
        digest=write_manifest(args.run_dir/'manifest.json',manifest)
        started=time.monotonic();budget=Budget(started,manifest['seconds'])
        runtime={'schema':1,'startedMonotonic':started,'deadlineMonotonic':started+budget.seconds,
                 'manifestSha256':digest,'stage':args.stage,'seed':args.seed,'bootTime':psutil.boot_time()}
    if args.resume:
        metadata=json.loads(args.resume.with_suffix('.json').read_text())
        if metadata['configSha256']!=CONFIG_SHA256:raise ValueError('resume checkpoint configuration changed')
        runtime['parentCheckpointManifestSha256']=metadata['manifestSha256']
        runtime['parentCheckpoint']=str(args.resume.resolve())
    atomic_json(runtime_path,runtime)
    atomic_json(args.run_dir/'allocation.json',{'workers':CONFIG['resources']['minWorkers'],
                'memory_gib':CONFIG['resources']['minMemoryGiB'],'paused':False,'stop':False,
                'reason':'initial-conservative','observedAt':time.time()})
    argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(args.run_dir.resolve()),'--seed',str(args.seed),'--stage',args.stage]
    if args.resume:argv+=['--resume',str(args.resume.resolve())]
    env={**os.environ,'PYTHONPATH':str(ROOT/'tools/ai-trainer')}
    with (args.run_dir/'runner.log').open('w') as log:
        process=start_group(['/usr/bin/nice','-n','10',*argv],cwd=ROOT,env=env,stdout=log,stderr=log)
        reason=supervise(process,budget,AdaptivePolicy(),Telemetry(args.run_dir,args.activity_file),args.run_dir)
    atomic_json(args.run_dir/'supervisor-result.json',{'reason':reason,'runnerReturncode':process.returncode,
                'elapsedSeconds':time.monotonic()-started,'budgetSeconds':budget.seconds,'productionPromotion':False})
    print(json.dumps({'reason':reason,'runDir':str(args.run_dir)}))

if __name__=='__main__':main()
