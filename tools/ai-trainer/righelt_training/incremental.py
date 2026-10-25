"""One explicitly authorized incremental round with a fixed end-to-end deadline.

Reuses the native runner, checkpoint format and external process watchdog. It
does not reopen historical allocations or silently restart after a handoff.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import sys
import subprocess
import time
from .budget import Budget
from .checkpoint import atomic_json
from .config import ROOT
from .manifest import build_manifest, write_manifest, active_manifest
from .processes import start_group, stop_group, register_owned, cleanup_owned, install_stop_handlers
from .production import load_corpus
from .resource_policy import POLICY_ID, LIMITS
from .resources import AdaptivePolicy
from .supervisor import supervise, validate_gate_report
from .telemetry import Telemetry


def checked_contract(value, *, now=None):
    now = time.time() if now is None else now
    if value.get('schema') != 1 or value.get('kind') != 'incremental-production-v1':
        raise ValueError('invalid incremental contract')
    start = datetime.datetime.fromisoformat(value['startedAt']).timestamp()
    end = datetime.datetime.fromisoformat(value['deadline']).timestamp()
    if end-start != 43200 or not start <= now < end:
        raise ValueError('incremental deadline expired or changed')
    if not value.get('humanAuthority') or not value.get('semanticApproval'):
        raise ValueError('incremental authorization missing')
    if not 0 <= value.get('seed', -1) < 2**32 or not value.get('id'):
        raise ValueError('invalid incremental identity')
    return start, end


def main():
    install_stop_handlers()
    parser=argparse.ArgumentParser()
    parser.add_argument('--contract',type=Path,required=True)
    parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--activity-file',type=Path,required=True)
    parser.add_argument('--gate-report',type=Path,required=True)
    args=parser.parse_args()
    if POLICY_ID != 'production-headroom-v3':
        raise ValueError('incremental run requires approved production resource policy')
    contract=json.loads(args.contract.read_text());start,end=checked_contract(contract)
    directory=args.run_dir.resolve();directory.mkdir(parents=True,exist_ok=True)
    # This kernel lock protects the complete native process lifetime.
    lock=(directory/'incremental.lock').open('a+')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    cleanup_owned(directory)
    activity=json.loads(args.activity_file.read_text())
    if (activity.get('developmentActive') is not False or not activity.get('explicitGrant')
            or activity.get('contractId') != contract['id']
            or not 0 <= time.time()-activity['observedAt'] <= LIMITS['activityFreshSeconds']):
        raise ValueError('fresh explicit coordinator resource grant required')
    corpus=contract['productionCorpus'];load_corpus(corpus)
    manifest=build_manifest(contract['seed'],'initial')
    subprocess.run(['git','merge-base','--is-ancestor',contract['semanticApproval'],manifest['sourceRevision']],
                   cwd=ROOT,check=True,capture_output=True)
    validate_gate_report(json.loads(args.gate_report.read_text()),manifest['sourceRevision'],'initial')
    manifest.update(productionCorpus=corpus,warmStart=contract['warmStart'],
                    jobPrefix=contract['id'],incrementalContract=contract,seconds=43200)
    manifest_path=directory/'manifest.json'
    if manifest_path.exists():
        previous=active_manifest(directory)
        if previous['manifest'] != manifest:
            raise ValueError('incremental inputs changed; reviewed stopped source amendment required')
        manifest_hash=previous['sha256']
    else:
        manifest_hash=write_manifest(manifest_path,manifest)
        atomic_json(directory/'incremental-contract.json',contract)
    # Reserve the final four hours for evaluation and release, including all
    # preceding preparation, stopped waits and repairs in the original clock.
    now=time.monotonic();remaining=end-time.time()
    runtime={'schema':2,'startedMonotonic':now-(time.time()-start),
             'deadlineMonotonic':now+remaining,'startedWall':start,'deadlineWall':end,
             'reserveSeconds':14400,'manifestSha256':manifest_hash,'stage':'initial',
             'seed':contract['seed'],'command':'training',
             'parentCheckpointManifestSha256':contract['warmStart']['manifestSha256']}
    if remaining <= 14400:
        raise ValueError('training reserve reached; evaluate retained checkpoints')
    latest=directory/'latest.json'
    checkpoint=Path(json.loads(latest.read_text())['checkpoint']) if latest.exists() else Path(contract['warmStart']['path'])
    if latest.exists():runtime['parentCheckpointManifestSha256']=manifest_hash
    atomic_json(directory/'runtime.json',runtime)
    atomic_json(directory/'allocation.json',{'workers':0,'memory_gib':16,'paused':True,
                'stop':False,'reason':'device-memory-unknown','observedAt':time.time()})
    argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(directory),
          '--seed',str(contract['seed']),'--stage','initial','--resume',str(checkpoint)]
    budget=Budget(now,remaining,end)
    policy=AdaptivePolicy()
    initial=Telemetry(directory,args.activity_file).sample()
    allocation=policy.decide(initial)
    if allocation.paused or allocation.stop:
        raise ValueError('host telemetry does not admit training: '+allocation.reason)
    process=None
    with (directory/'incremental-runner.log').open('ab') as log:
        try:
            process=start_group(['/usr/bin/nice','-n','10',*argv],cwd=ROOT,env=dict(os.environ),stdout=log,stderr=log)
            register_owned(directory,process)
            reason=supervise(process,budget,policy,
                Telemetry(directory,args.activity_file,directory/'device-memory.json',process.pid),
                directory,runtime=runtime)
        finally:
            if process is not None:stop_group(process)
            cleanup_owned(directory)
    atomic_json(directory/'incremental-interval-result.json',{'reason':reason,
                'cleanupVerified':True,'deadlineWall':end,'observedAt':time.time(),
                'requiresExplicitRegrant':True,'productionPromotion':False})
    print(json.dumps({'reason':reason,'cleanupVerified':True,'deadlineWall':end}))
    if reason not in ('completed','resource-pressure-stop','development-active','activity-unknown'):
        raise SystemExit(1)


if __name__=='__main__':main()
