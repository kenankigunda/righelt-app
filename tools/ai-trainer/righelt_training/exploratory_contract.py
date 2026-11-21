"""One dated exploratory allocation, separate from historical sequence authority."""
import hashlib
import json
import math
from pathlib import Path

TRAINING_STOP = 1795183200  # 2026-11-20 14:00 UTC
ARTIFACT_DEADLINE = 1795190400  # 2026-11-20 16:00 UTC
KIND = 'attention-exploratory-window'


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,allow_nan=False).encode()).hexdigest()


def validate(plan):
    if plan.get('schema')==2:
        from .cloud_episode import validate as validate_episode
        validate_episode(plan)
    legacy=plan.get('schema')==1
    if (plan.get('schema') not in (1,2) or plan.get('kind')!=KIND or plan.get('lane') not in ('A','B')
            or type(plan.get('seed')) is not int or not 0<=plan['seed']<2**32
            or plan.get('stage')!='initial' or legacy and (plan.get('trainingStopWall')!=TRAINING_STOP
            or plan.get('artifactDeadlineWall')!=ARTIFACT_DEADLINE)
            or not isinstance(plan.get('authorizationReference'),str) or len(plan['authorizationReference'])<8):
        raise ValueError('explicit dated exploratory authority required')
    native=plan['nativeManifest']
    if native.get('executionBackend') not in ('mps','cuda'):
        raise ValueError('explicit MPS or CUDA backend required')
    run=Path(plan['runDir'])
    if run.is_absolute() or len(run.parts)<2 or run.parts[0]!='.ai-runs' or any(p in ('.','..') for p in run.parts):
        raise ValueError('unsafe exploratory run path')
    if (native.get('sourceRevision')!=plan['sourceRevision'] or native.get('seed')!=plan['seed']
            or native.get('stage')!=plan['stage'] or native.get('warmStart',{}).get('sha256')!=plan['checkpoint']['sha256']
            or native.get('modelArchitecture',{}).get('id')!='board-attention-48x2-v1'
            or 'continuation' in native or 'exploratoryWindow' in native):
        raise ValueError('exploratory native identity differs')
    for key in ('checkpoint','executionRecipe','trainingRecipe','portableClosure'):
        ref=plan[key]
        if (set(ref)!={'path','sha256'} or not isinstance(ref['path'],str)
                or len(ref['sha256'])!=64 or any(c not in '0123456789abcdef' for c in ref['sha256'])):
            raise ValueError('bound exploratory inputs required')
    return plan


def validate_gate(gate,source_revision,backend,plan):
    """Source proof plus actual backend probe, not historical strength health."""
    from .config import CONFIG_SHA256
    from .manifest import dependency_inventory
    from .portable import read_bound
    if (gate.get('schema')!=1 or gate.get('kind')!='exploratory-launch-gate'
            or gate.get('sourceRevision')!=source_revision or gate.get('configSha256')!=CONFIG_SHA256
            or gate.get('proofDependencies')!=dependency_inventory()):
        raise ValueError('exploratory gate source/configuration differs')
    for name in ('coreTests','trainerTests','exactReplay','targetBackend'):
        proof=gate.get('checks',{}).get(name,{})
        if proof.get('passed') is not True:raise ValueError('exploratory launch proof missing: '+name)
        read_bound(proof['evidence'])
    target=gate['checks']['targetBackend']
    if (target.get('backend')!=backend or any(target.get(key) is not True for key in
            ('restorePassed','checkpointRecoveryPassed','finiteUpdatePassed','numericPassed','abiPassed'))):
        raise ValueError('actual target-backend restore/update/export proof missing')
    report=json.loads(read_bound(target['evidence']))
    compatible=False
    if target.get('compatibleExecutionRecipe'):
        previous_raw=read_bound(target['compatibleExecutionRecipe'])
        previous=json.loads(previous_raw);current=json.loads(read_bound(plan['executionRecipe']))
        if hashlib.sha256(previous_raw).hexdigest()!=report.get('executionRecipeSha256'):
            raise ValueError('compatible backend recipe bytes differ')
        # Only this gate/authority module may change. Model, optimizer, data,
        # arithmetic, sampling and every other source byte must remain identical.
        for record in (previous,current):
            record['settings']['sourceFiles'].pop('exploratory_contract.py',None)
        compatible=(previous==current and target.get('compatibleSourceRevision')==report.get('sourceRevision'))
    if (report.get('schema')!=1 or report.get('kind') not in ('disposable-local-mps-preflight','disposable-target-backend-preflight')
            or not (report.get('sourceRevision')==source_revision or compatible) or report.get('backend')!=backend
            or report.get('configSha256')!=CONFIG_SHA256 or report.get('passed') is not True
            or report.get('inputCheckpointSha256')!=plan['checkpoint']['sha256']
            or not (report.get('executionRecipeSha256')==plan['executionRecipe']['sha256'] or compatible)
            or type(report.get('updates')) is not int or report['updates']<=0
            or not isinstance(report.get('parameterDelta'),(int,float))
            or not math.isfinite(report['parameterDelta']) or report['parameterDelta']<=0
            or any(report.get(k) is not True for k in ('teacherLoaded','freshBaselineInitialized',
                'checkpointRecoveryPassed','numericParityPassed','abiPassed','originalCheckpointUnchanged'))):
        raise ValueError('target-backend evidence does not prove the planned continuation')
    numeric=json.loads(read_bound(report['numericReport']))
    if (numeric.get('schema')!=2 or numeric.get('referenceDevice')!=backend or numeric.get('numericPassed') is not True
            or numeric.get('onnxSha256')!=report.get('export',{}).get('sha256')
            or numeric.get('inputShape',[None])[1:]!=[46,10,10]
            or numeric.get('arithmetic',{}).get('policyApplied') is not True
            or report.get('export',{}).get('dtype')!='float32' or report['export'].get('opset')!=17
            or report['export'].get('configSha256')!=CONFIG_SHA256
            or any(set(b.get('comparisons',{}))!={'torchCpuToOrtCpu','torchReferenceToTorchCpu','torchReferenceToOrtCpu'} for b in numeric.get('batches',[]))
            or not numeric.get('batches') or any(c.get('passed') is not True or len(c.get('outputs',[]))!=2
                or any(o.get('abiPassed') is not True or o.get('finite') is not True for o in c['outputs'])
                for b in numeric['batches'] for c in b.get('comparisons',{}).values())):
        raise ValueError('target numeric/ABI proof differs')
    if not numeric_gate_passed(numeric):raise ValueError('target numeric output/tolerance proof differs')
    return gate


def numeric_gate_passed(numeric):
    """Mirror the existing raw ABI/NumPy acceptance, never its diagnostics."""
    if numeric.get('atol')!=1e-5 or numeric.get('rtol')!=1e-4 or numeric.get('inputDtype')!='float32':return False
    count=numeric.get('states');shape=numeric.get('inputShape')
    if type(count)is not int or count<=0 or shape!=[count,46,10,10]:return False
    cursor=0
    for batch in numeric.get('batches',[]):
        size=batch.get('count')
        if batch.get('start')!=cursor or type(size)is not int or not 0<size<=32 or cursor+size>count:return False
        if set(batch.get('comparisons',{}))!={'torchCpuToOrtCpu','torchReferenceToTorchCpu','torchReferenceToOrtCpu'}:return False
        for comparison in batch['comparisons'].values():
            if comparison.get('passed')is not True or len(comparison.get('outputs',[]))!=2:return False
            for output,name,expected in zip(comparison.get('outputs',[]),('policy','value'),([size,2801],[size])):
                if (output.get('name')!=name or output.get('referenceShape')!=expected or output.get('actualShape')!=expected
                        or output.get('referenceDtype')!='float32' or output.get('actualDtype')!='float32'
                        or output.get('passed') is not True or output.get('abiPassed') is not True or output.get('finite') is not True
                        or output.get('referenceNonfinite')!=0 or output.get('actualNonfinite')!=0 or output.get('exceedingCells')!=0):return False
        cursor+=size
    return cursor==count


def continuation(directory,manifest):
    from .allocation import Allocation
    plan=validate(manifest['exploratoryWindow'])
    creation=Allocation(Path(directory).resolve().parent,directory).accounting()[0]
    if creation.get('exploratoryPlanSha256')!=digest(plan):
        raise ValueError('exploratory allocation binding changed')
    return {'kind':KIND,'planSha256':digest(plan),'preserveState':True,'freshHealth':True,
            'policyOnlyFresh':True,'recoveryCheckpoint':plan['checkpoint']['path'],
            'recoverySha256':plan['checkpoint']['sha256']}


def consume_resume(directory,reason,now):
    plan_path=Path(directory)/'plan.json'
    if plan_path.exists() and json.loads(plan_path.read_bytes()).get('schema')==2:
        raise ValueError('cloud repair episode permits no same-allocation resumes')
    """Caller holds supervisor.lock; consume before every internal/outer respawn."""
    from .allocation import append,rows
    if reason not in ('resource-pressure-stop','transport-interruption'):
        raise ValueError('unclassified exploratory failure cannot resume')
    directory=Path(directory);path=directory/'exploratory-recovery.jsonl'
    events=[r for r in rows(path) if r['event']=='resume-consumed']
    if len(events)>=2 or now>=TRAINING_STOP:
        raise ValueError('exploratory resume allowance exhausted')
    start_repair(directory,now)
    check_repair(directory,now)
    append(path,{'event':'resume-consumed','ordinal':len(events)+1,'reason':reason,
                 'observedAt':now,'trainingStopWall':TRAINING_STOP})


def repair_state(directory,now):
    from .allocation import rows
    total=0.;opened=None
    for row in rows(Path(directory)/'exploratory-recovery.jsonl'):
        if row['event']=='repair-started':
            if opened is not None:raise ValueError('overlapping repair intervals')
            opened=row['observedAt']
        elif row['event']=='repair-ended':
            if opened is None or row['observedAt']<opened:raise ValueError('invalid repair interval')
            total+=row['observedAt']-opened;opened=None
    if not math.isfinite(now) or opened is not None and now<opened:raise ValueError('invalid repair clock')
    return total+(now-opened if opened is not None else 0),opened


def check_repair(directory,now):
    elapsed,_=repair_state(directory,now)
    path=Path(directory)/'plan.json'
    plan=json.loads(path.read_bytes()) if path.exists() else {}
    if plan.get('schema')==2:
        from .cloud_episode import validate as validate_episode
        validate_episode(plan)
        limit=plan['repairDeadlineWall']-plan['repairStartedAtWall']
        if elapsed>=limit:raise ValueError('cloud repair window exhausted')
    elif elapsed>=7200:raise ValueError('exploratory repair window exhausted')


def start_repair(directory,now):
    from .allocation import append
    _,opened=repair_state(directory,now)
    if opened is None:append(Path(directory)/'exploratory-recovery.jsonl',{'event':'repair-started','observedAt':now})
    check_repair(directory,now)


def finish_repair(directory,now):
    from .allocation import append
    check_repair(directory,now)
    _,opened=repair_state(directory,now)
    if opened is not None:append(Path(directory)/'exploratory-recovery.jsonl',{'event':'repair-ended','observedAt':now})
