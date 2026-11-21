"""Bounded same-Pod backend qualification before the shared exploratory driver.

The prospective source gate is immutable. The actual backend gate is produced
inside this allocation, never predicted before a GPU exists.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import time
import uuid


def same_state(left,right):
    import torch
    if isinstance(left,torch.Tensor):return isinstance(right,torch.Tensor) and torch.equal(left.detach().cpu(),right.detach().cpu())
    if isinstance(left,dict):return isinstance(right,dict) and left.keys()==right.keys() and all(same_state(left[k],right[k]) for k in left)
    if isinstance(left,(list,tuple)):return type(left)is type(right) and len(left)==len(right) and all(same_state(a,b) for a,b in zip(left,right))
    return left==right


def main():
    os.environ['RIGHELT_RESOURCE_POLICY']='adaptive-headroom-v2'
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True);parser.add_argument('--gate-report',type=Path,required=True)
    args=parser.parse_args()
    from .exploratory_contract import validate,digest
    from .exploratory_window import read,configure,context,drive
    from .portable import read_bound,contained
    from .config import ROOT,CONFIG_SHA256
    from .manifest import dependency_inventory,write_manifest
    from .checkpoint import atomic_json,weights_sha256
    from .arithmetic import ieee_fp32
    plan=validate(read(args.plan))
    if plan['nativeManifest']['executionBackend']!='cuda' or os.environ.get('RIGHELT_HOSTED')!='1':
        raise ValueError('cloud preflight requires its admitted CUDA worker')
    recipe=configure(plan);source=read(args.gate_report)
    if (source.get('schema')!=1 or source.get('kind')!='exploratory-source-gate'
            or source.get('sourceRevision')!=plan['sourceRevision'] or source.get('configSha256')!=CONFIG_SHA256
            or source.get('proofDependencies')!=dependency_inventory()
            or source.get('targetProbeKind')!='disposable-target-backend-preflight'):
        raise ValueError('prospective source gate differs')
    for name in ('coreTests','trainerTests','exactReplay'):
        if source.get('checks',{}).get(name,{}).get('passed') is not True:raise ValueError('source proof missing')
        read_bound(source['checks'][name]['evidence'])
    directory=contained(ROOT,plan['runDir']);directory.mkdir(parents=True,exist_ok=True)
    if plan['schema']==2:
        from .cloud_episode import start_repair
        start_repair(directory,plan,time.time())
    state_path=directory/'preflight-state.json'
    state={'schema':1,'kind':'cloud-preflight-disposition','campaignId':os.environ['COMPUTE_ID'],
        'generation':int(os.environ['COMPUTE_GENERATION']),'sourceRevision':plan['sourceRevision'],
        'planSha256':digest(plan),'status':'running','productiveWorkStarted':False}
    if not state_path.exists():atomic_json(state_path,state)
    report_path=directory/'preflight/preflight-report.json'
    # A stopped preflight is not retried silently. The outer owned worker may
    # reuse only a fully bound successful report from this same allocation.
    if not report_path.exists():
        if (directory/'preflight').exists():raise ValueError('incomplete backend preflight requires classified repair')
        probe=copy.deepcopy(plan);probe['runDir']=plan['runDir']+'/preflight'
        target=contained(ROOT,probe['runDir']);target.mkdir(parents=True)
        native=copy.deepcopy(plan['nativeManifest']);native['exploratoryWindow']=probe
        mh=write_manifest(target/'manifest.json',native)
        from .allocation import append
        allocation_id=uuid.uuid4().hex
        append(directory/'allocation-events.jsonl',{'event':'created','allocation':str(target),'stage':'initial',
            'seconds':600,'id':allocation_id,'observedAt':time.time(),'exploratoryPlanSha256':digest(probe),
            'authorization':plan['authorizationReference']})
        now=time.monotonic();remaining=min(600,plan['trainingStopWall']-time.time()-600)
        if remaining<=120:raise ValueError('no useful backend/training runway')
        atomic_json(target/'runtime.json',{'schema':2,'seed':probe['seed'],'stage':'initial','manifestSha256':mh,
            'command':'training','startedMonotonic':now,'deadlineMonotonic':now+remaining,
            'deadlineWall':time.time()+remaining,'reserveSeconds':60,'allocationId':allocation_id,
            'exploratoryPlanSha256':digest(probe)})
        original_env=dict(os.environ)
        try:
            # No claims or games are issued by this disposable inherited batch.
            os.environ['RIGHELT_HOSTED']='0';os.environ['RIGHELT_EXPLORATORY_LOCAL']='1'
            context(target,probe,recipe)
            from .runner_monitor import RunnerMonitor
            from .runner import Runner
            from .trainer import train_round
            from .export import export_onnx,numeric_parity
            from .portable import resolve_reference
            from .checkpoint import inspect_checkpoint
            from .resources import AdaptivePolicy
            from .telemetry import Telemetry
            import numpy as np
            import torch
            import random
            with ieee_fp32(),RunnerMonitor(target) as monitor,monitor.operation('backend-preflight',remaining):
                policy=AdaptivePolicy()
                def resource_boundary():
                    sample=Telemetry(directory,target/'absent-activity.json',target/'device-memory.json',os.getpid()).sample()
                    allocation=policy.decide(sample)
                    if allocation.stop or allocation.paused:raise RuntimeError('backend resource qualification unavailable')
                    atomic_json(target/'allocation.json',allocation.record())
                resource_boundary()
                cp=resolve_reference(plan['checkpoint']['path'],expected_sha256=plan['checkpoint']['sha256'])
                runner=Runner(target,probe['seed'],'initial',resume=cp,monitor=monitor)
                resource_boundary();before=weights_sha256(runner.model.state_dict());positions=list(runner.buffer.positions)[:32]
                update=train_round(runner.model,runner.optimizer,positions,device='cuda',seed=probe['seed'],
                    deadline=min(now+remaining,time.monotonic()+120),operation=monitor.operation)
                if update['updates']!=1 or update['nonzeroUpdates']!=1:raise ValueError('backend update incomplete')
                runner.state['updates']+=1;runner.state['nonzeroUpdates']+=1;runner.checkpoint()
                context(target,probe,recipe);latest=read(target/'latest.json')
                restored=Runner(target,probe['seed'],'initial',resume=Path(latest['checkpoint']),monitor=monitor)
                if weights_sha256(restored.model.state_dict())!=weights_sha256(runner.model.state_dict()) or weights_sha256(restored.model.state_dict())==before:
                    raise ValueError('backend checkpoint did not restore exact changed weights')
                expected=inspect_checkpoint(Path(latest['checkpoint']),manifest_sha256=mh,require_recovery=True)
                if (not same_state(restored.optimizer.state_dict(),expected['optimizer'])
                        or random.getstate()!=expected['pythonRng'] or not torch.equal(torch.get_rng_state(),expected['torchRng'])
                        or not same_state(torch.cuda.get_rng_state_all(),expected.get('cudaRng'))
                        or any(restored.state.get(k)!=expected['recovery']['state'].get(k) for k in
                            ('updates','round','phase','trainingBatch','nextJob','archives','curriculumSwitched','pendingGenerationJob'))):
                    raise ValueError('backend optimizer/RNG/replay cursor recovery differs')
                resource_boundary()
                export=export_onnx(restored.model,target/'probe.onnx')
                states=np.asarray([p['encoded'] for p in positions],dtype=np.float32).reshape(-1,46,10,10)
                parity=numeric_parity(restored.model,target/'probe.onnx',states,reference_device='cuda',report_path=target/'numeric-parity.json')
                numeric_ref={'path':str((target/'numeric-parity.json').relative_to(ROOT)),
                    'sha256':hashlib.sha256((target/'numeric-parity.json').read_bytes()).hexdigest()}
                report={'schema':1,'kind':'disposable-target-backend-preflight','passed':True,'backend':'cuda',
                    'sourceRevision':plan['sourceRevision'],'configSha256':CONFIG_SHA256,
                    'inputCheckpointSha256':plan['checkpoint']['sha256'],'executionRecipeSha256':plan['executionRecipe']['sha256'],
                    'countsTowardCandidate':False,'teacherLoaded':restored.teacher is not None,
                    'freshBaselineInitialized':bool(restored.fresh_baseline),'updates':update['updates'],
                    'parameterDelta':update['batches'][0]['parameterDelta'],'checkpointRecoveryPassed':True,
                    'numericParityPassed':parity['numericPassed'],'abiPassed':True,'numericReport':numeric_ref,
                    'export':export,'originalCheckpointUnchanged':hashlib.sha256(cp.read_bytes()).hexdigest()==plan['checkpoint']['sha256']}
                atomic_json(report_path,report)
        finally:
            os.environ.clear();os.environ.update(original_env)
    gate=copy.deepcopy(source);gate['kind']='exploratory-launch-gate'
    gate['checks']['targetBackend']={'passed':True,'backend':'cuda','restorePassed':True,
        'checkpointRecoveryPassed':True,'finiteUpdatePassed':True,'numericPassed':True,'abiPassed':True,
        'evidence':{'path':str(report_path.relative_to(ROOT)),'sha256':hashlib.sha256(report_path.read_bytes()).hexdigest()}}
    gate_path=directory/'launch-gate.json';atomic_json(gate_path,gate)
    # Preserve the exact prospective plan; actual hardware proof is a separate
    # output gate, not an alteration of an input or training recipe.
    plan_path=directory/'plan.json'
    if plan_path.exists() and read(plan_path)!=plan:raise ValueError('cloud plan changed')
    atomic_json(plan_path,plan)
    atomic_json(state_path,{**state,'status':'ready','preflightCompleted':True,'productiveWorkStarted':False})
    print(json.dumps(drive(plan,gate_path)))


if __name__=='__main__':main()
