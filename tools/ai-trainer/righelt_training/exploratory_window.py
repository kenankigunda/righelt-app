"""Foreground, single-allocation driver. No provider creation or interactive repair."""
import argparse
import copy
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

from .exploratory_contract import validate,digest


def read(path):
    return json.loads(Path(path).read_bytes())


def configure(plan):
    from .config import ROOT
    from .cloud_launch import REPLACEMENT
    if plan.get('launchAuthorityId')==REPLACEMENT['id']:
        os.environ['RIGHELT_HOSTED_MEMORY_SCOPE']=REPLACEMENT['memoryScope']
    else:os.environ.pop('RIGHELT_HOSTED_MEMORY_SCOPE',None)
    closure=plan['portableClosure']
    os.environ['RIGHELT_TRAINING_DEVICE']=plan['nativeManifest']['executionBackend']
    os.environ.update(RIGHELT_RESOURCE_POLICY='adaptive-headroom-v2',
        RIGHELT_PORTABLE_ROOT=str(ROOT),RIGHELT_PORTABLE_CLOSURE_PATH=str(ROOT/closure['path']),
        RIGHELT_PORTABLE_CLOSURE_SHA256=closure['sha256'])
    # Local execution verifies the same method without enabling remote claims.
    if os.environ.get('RIGHELT_HOSTED')!='1':os.environ['RIGHELT_EXPLORATORY_LOCAL']='1'
    from .portable import read_bound,resolve_reference
    for key in ('checkpoint','trainingRecipe','executionRecipe'):read_bound(plan[key])
    os.environ.update(RIGHELT_EXECUTION_RECIPE_PATH=str(resolve_reference(plan['executionRecipe']['path'])),
        RIGHELT_EXECUTION_RECIPE_SHA256=plan['executionRecipe']['sha256'])
    from .execution_recipe import verify_runtime
    recipe=verify_runtime()
    if (recipe['settings']['mode']!='attention-incumbent-continuation' or recipe['settings'].get('policyRefresh')
            or recipe['incumbent']['checkpointSha256']!=plan['checkpoint']['sha256']):
        raise ValueError('unchanged attention method required')
    if (json.loads(read_bound(plan['trainingRecipe']))!=recipe['settings']['trainingRecipe']
            or plan['nativeManifest'].get('trainingRecipe')!=recipe['settings']['trainingRecipe']):
        raise ValueError('native root-search recipe differs')
    return recipe


def context(directory,plan,recipe):
    from .checkpoint import atomic_json
    recovered=[]
    if (directory/'latest.json').exists():
        latest=read(directory/'latest.json')
        recovered=[{'path':latest['checkpoint'],'sha256':latest['sha256']}]
    target=directory/'exploratory-context.json'
    atomic_json(target,{'execution':{'inputCheckpointSha256':plan['checkpoint']['sha256'],
        'dataSha256':recipe['dataSha256']},'recoveryFiles':recovered})
    if os.environ.get('RIGHELT_HOSTED')!='1':os.environ['RIGHELT_EXECUTION_CONTEXT']=str(target)


def verify(directory,plan):
    training_stop=plan['trainingStopWall']
    artifact_deadline=plan['artifactDeadlineWall']
    import math
    import numpy as np
    import torch
    from .portable import resolve_reference
    from .checkpoint import inspect_checkpoint,load_checkpoint,atomic_json,weights_sha256
    from .model import model_from_record
    from .trainer import make_optimizer
    from .attention_method import reconstruct_replay
    from .replay import ReplayBuffer
    from .export import export_onnx,numeric_parity
    from .fresh_health import load_baseline,audit_evidence,continuation_for,read_game
    from .config import CONFIG
    from .device import selected_device
    manifest=read(directory/'manifest.json')
    latest=read(directory/'latest.json');checkpoint=resolve_reference(latest['checkpoint'],expected_sha256=latest['sha256'])
    recovery=read(directory/'recovery-endpoint.json') if plan['schema']==3 and (directory/'recovery-endpoint.json').exists() else None
    if recovery is not None:
        if (recovery.get('kind')!='local-last-durable-endpoint' or recovery.get('checkpointSha256')!=latest['sha256']
                or recovery.get('completedWorkInvented') is not False):raise ValueError('invalid recovered endpoint binding')
        result=recovery
    else:result=read(directory/'runner-result.json')
    if plan['schema']==2:
        from .cloud_episode import artifact_deadline as endpoint_deadline
        artifact_deadline=endpoint_deadline(plan,result)
    if time.time()>=artifact_deadline:raise TimeoutError('artifact deadline expired')
    allowed=('budget-or-resource-stop','insufficient-generation-runway','validation-handoff')
    if result.get('reason') not in allowed+(('local-recovered-checkpoint',) if plan['schema']==3 else ()):
        raise ValueError('unplanned endpoint cannot qualify')
    model=model_from_record(manifest['manifest']).to(selected_device());optimizer=make_optimizer(model)
    data=load_checkpoint(checkpoint,model,optimizer,manifest_sha256=manifest['sha256'],require_recovery=True)
    if recovery is not None:result={**result,'state':data['recovery']['state']}
    if data['updates']!=latest['updates'] or data['recovery']['state']!=result['state']:
        raise ValueError('endpoint cursor differs from sealed checkpoint')
    method=configure(plan)['settings']['attentionMethod']
    guards=read(resolve_reference(manifest['manifest']['evaluationGuards']['path'],
        expected_sha256=manifest['manifest']['evaluationGuards']['sha256']))
    buffer=ReplayBuffer(protected_encoding_hashes=guards['encodingHashes'],protected_family_ids=guards['familyIds'])
    reconstruct_replay(buffer,data,method,base=directory)
    games={name:read_game(resolve_reference(name,base=directory)) for name in data['recovery']['state']['archives']}
    contract=continuation_for(directory,manifest['manifest']);baseline=load_baseline(directory,contract)
    proof=audit_evidence(directory,data['recovery']['state'],baseline,games)
    original=resolve_reference(plan['checkpoint']['path'],expected_sha256=plan['checkpoint']['sha256'])
    initial=inspect_checkpoint(original,manifest_sha256=read(resolve_reference(original.with_suffix('.json')))['manifestSha256'],require_recovery=True)
    delta=sum(float((v.detach().cpu()-initial['model'][k]).abs().sum()) for k,v in model.state_dict().items())
    if not proof['freshExamplesUsed'] or data['updates']<=initial['updates'] or not math.isfinite(delta) or delta<=0:
        raise ValueError('endpoint has no witnessed fresh-policy learning')
    positions=list(buffer.positions)[:32]
    if not positions:raise ValueError('recovered replay is empty')
    states=np.asarray([p['encoded'] for p in positions],dtype=np.float32).reshape(-1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
    output=directory/'model.onnx';export_onnx(model,output)
    parity=numeric_parity(model,output,states,reference_device=str(selected_device()),report_path=directory/'numeric-parity.json')
    if not parity['numericPassed']:raise ValueError('numeric parity failed')
    report={'schema':1,'kind':'exploratory-candidate','qualified':True,'lane':plan['lane'],
        'planSha256':digest(plan),'sourceRevision':plan['sourceRevision'],'checkpoint':latest,
        'modelSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'modelBytes':output.stat().st_size,
        'trainingStopWall':training_stop,'artifactDeadlineWall':artifact_deadline,
        **({'trainingStoppedAtMs':result['trainingStoppedAtMs']} if plan['schema']==2 else {}),
        'updates':data['updates']-initial['updates'],'parameterDelta':delta,'learning':proof,
        'availableFutureFactLabels':sum(sum(p.get('futureFacts',{}).get('mask',[])) for p in buffer.positions),
        'recoveryPassed':True,'numericParityPassed':True,'browserAcceptance':'pending',
        'strengthEstablished':False,'defaultPromotion':False,'observedAt':time.time()}
    if recovery is not None:report['recoveredEndpoint']=recovery
    if time.time()>=artifact_deadline:raise TimeoutError('artifact deadline expired')
    atomic_json(directory/'candidate-report.json',report)
    return report


def drive(plan,gate):
    training_stop=plan['trainingStopWall'];artifact_deadline=plan['artifactDeadlineWall']
    os.environ['RIGHELT_RESOURCE_POLICY']='adaptive-headroom-v2'
    from .config import ROOT
    from .checkpoint import atomic_json
    from .manifest import write_manifest
    from .allocation import Allocation,append,identity
    from .budget import Budget
    from .processes import cleanup_owned,start_group,stop_group,register_owned,install_stop_handlers
    from .supervisor import run_phase
    from .exploratory_contract import validate_gate
    from .portable import resolve_reference
    from .resource_policy import POLICY_ID
    if POLICY_ID!='adaptive-headroom-v2':raise ValueError('resource policy imported before exploratory configuration')
    import psutil
    from .portable import contained
    directory=contained(ROOT,plan['runDir'])
    directory.mkdir(parents=True,exist_ok=True)
    with (directory.parent/'supervisor.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        recipe=configure(plan)
        validate_gate(read(gate),plan['sourceRevision'],plan['nativeManifest']['executionBackend'],plan)
        # No mutable branch/source repair is permitted inside this driver.
        from .source_image import source_image
        image=source_image()
        revision=image['sourceRevision'] if image else subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        if revision!=plan['sourceRevision']:raise ValueError('frozen source revision differs')
        native=copy.deepcopy(plan['nativeManifest']);native['exploratoryWindow']=plan
        manifest_path=directory/'manifest.json'
        if manifest_path.exists():
            if read(manifest_path)['manifest']!=native:raise ValueError('allocation manifest changed')
            manifest_hash=read(manifest_path)['sha256']
        else:manifest_hash=write_manifest(manifest_path,native)
        allocation=Allocation(directory.parent,directory)
        if not allocation.events():
            if time.time()>=training_stop-600:raise ValueError('no initial training runway')
            append(allocation.path,{'event':'created','allocation':str(directory),'stage':'initial',
                'seconds':artifact_deadline-time.time(),'id':uuid.uuid4().hex,'observedAt':time.time(),
                'exploratoryPlanSha256':digest(plan),'authorization':plan['authorizationReference']})
        if allocation.accounting()[0].get('exploratoryPlanSha256')!=digest(plan):raise ValueError('allocation changed')
        allocation.recover_abandoned(cleanup_owned)
        cleanup_owned(directory)
        awake=None
        if sys.platform=='darwin':awake=subprocess.Popen(['/usr/bin/caffeinate','-is','-w',str(os.getpid())])
        install_stop_handlers()
        try:
            if time.time()<training_stop and not (directory/'runner-result.json').exists():
                if (directory/'latest.json').exists():
                    from .exploratory_contract import consume_resume
                    prior=read(directory/'driver-result.json') if (directory/'driver-result.json').exists() else {}
                    consume_resume(directory,prior.get('reason'),time.time())
                interval,_,_=allocation.begin('training')
                now=time.monotonic();remaining=training_stop-time.time()
                runtime={'schema':2,'seed':plan['seed'],'stage':'initial','manifestSha256':manifest_hash,
                    **({'episodeId':plan['episodeId']} if plan['schema']==2 else {}),
                    'command':'training','startedMonotonic':now,'deadlineMonotonic':now+remaining,
                    'deadlineWall':training_stop,'reserveSeconds':min(300,remaining/4),
                    'allocationId':allocation.accounting()[0]['id'],'allocationInterval':interval['id'],
                    'supervisorPid':os.getpid(),'bootTime':psutil.boot_time(),'exploratoryPlanSha256':digest(plan)}
                atomic_json(directory/'runtime.json',runtime);context(directory,plan,recipe)
                cp=read(directory/'latest.json')['checkpoint'] if (directory/'latest.json').exists() else str(resolve_reference(plan['checkpoint']['path']))
                argv=[sys.executable,'-m','righelt_training.runner','--run-dir',str(directory),'--seed',str(plan['seed']),
                    '--stage','initial','--resume',cp]
                try:
                    reason='unclassified-interruption'
                    with (directory/'runner.log').open('a') as log:
                        reason,_=run_phase(argv,{**os.environ,'PYTHONPATH':str(ROOT/'tools/ai-trainer')},log,
                            Budget(now,remaining,training_stop),runtime,directory,directory.parent,
                            plan.get('activityFile',str(directory/'absent-activity.json')))
                    if reason!='completed':raise RuntimeError('training stopped: '+reason)
                finally:
                    atomic_json(directory/'driver-result.json',{'reason':reason,'observedAt':time.time(),
                        'planSha256':digest(plan),'trainingStopWall':training_stop})
                    cleanup_owned(directory);allocation.finish(interval['id'],reason='exploratory-training-ended')
            if not (directory/'runner-result.json').exists():raise ValueError('no complete endpoint')
            if plan['schema']==2:
                from .cloud_episode import artifact_deadline as endpoint_deadline
                artifact_deadline=endpoint_deadline(plan,read(directory/'runner-result.json'))
            if time.time()>=artifact_deadline:raise TimeoutError('artifact deadline expired')
            context(directory,plan,recipe)
            process=None
            try:
                with (directory/'verification.log').open('a') as log:
                    process=start_group([sys.executable,'-m','righelt_training.exploratory_window','--plan',
                        str(directory/'plan.json'),'--verify-only'],cwd=ROOT,
                        env={**os.environ,'PYTHONPATH':str(ROOT/'tools/ai-trainer')},stdout=log,stderr=log)
                    register_owned(directory,process)
                    while process.poll() is None:
                        if time.time()>=artifact_deadline:raise TimeoutError('artifact deadline expired')
                        time.sleep(.25)
                    if process.returncode:raise RuntimeError('candidate verification failed; inspect verification.log')
            finally:
                if process is not None:stop_group(process)
                cleanup_owned(directory)
            return read(directory/'candidate-report.json')
        finally:
            cleanup_owned(directory)
            if awake is not None:awake.terminate();awake.wait(timeout=5)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--gate-report',type=Path)
    parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    plan=validate(read(args.plan))
    if args.verify_only:
        configure(plan)
        from .arithmetic import ieee_fp32
        with ieee_fp32():verify(args.plan.parent,plan)
    else:
        if not args.gate_report:parser.error('--gate-report required')
        from .checkpoint import atomic_json
        from .config import ROOT
        from .portable import contained
        target=contained(ROOT,plan['runDir']+'/plan.json')
        if target.exists() and read(target)!=plan:raise ValueError('frozen plan changed')
        if not target.exists():atomic_json(target,plan)
        print(json.dumps(drive(plan,args.gate_report)))


if __name__=='__main__':main()
