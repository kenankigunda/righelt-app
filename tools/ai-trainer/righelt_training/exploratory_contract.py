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
    if (plan.get('schema')!=1 or plan.get('kind')!=KIND or plan.get('lane') not in ('A','B')
            or type(plan.get('seed')) is not int or not 0<=plan['seed']<2**32
            or plan.get('stage')!='initial' or plan.get('trainingStopWall')!=TRAINING_STOP
            or plan.get('artifactDeadlineWall')!=ARTIFACT_DEADLINE
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
    if elapsed>=7200:raise ValueError('exploratory repair window exhausted')


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
