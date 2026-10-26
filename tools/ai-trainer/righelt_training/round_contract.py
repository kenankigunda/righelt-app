"""A shared wall-clock round surrounds all legacy child allocations and pauses."""
import hashlib
import json
import math
from datetime import datetime
from .budget import Budget


ROUND_SECONDS=86400
PILOT_SECONDS=8*3600
RELEASE_RESERVE_SECONDS=5*3600


def stamp(value):
    d=datetime.fromisoformat(value.replace('Z','+00:00'))
    if d.tzinfo is None:raise ValueError('Round timezone required')
    return d.timestamp()


def validate_round(contract,state,now):
    followup=state['followupTraining']
    if (contract.get('schema')!=1 or contract.get('kind')!='followup-round-24h-v1'
            or contract.get('executionStartedAt')!=followup['executionStartedAt']
            or contract.get('deadline')!=followup['deadline']):
        raise ValueError('Original round identity changed')
    start,end=stamp(contract['executionStartedAt']),stamp(contract['deadline'])
    phase=contract.get('phase');phase_end=stamp(contract['phaseDeadline'])
    if not math.isfinite(now)or end-start!=ROUND_SECONDS or not start<=now<phase_end<=end:
        raise ValueError('Expired or reset24-hour round')
    if phase not in ('pilot','main','evaluation','handoff-proof'):
        raise ValueError('Unknown round phase')
    if phase=='pilot'and phase_end>start+PILOT_SECONDS:
        raise ValueError('Pilot exceeds implementation/pilot reserve')
    if phase=='main'and phase_end>end-RELEASE_RESERVE_SECONDS:
        raise ValueError('Main training consumes release reserve')
    if contract.get('checkpointReserveSeconds')!=60:
        raise ValueError('Round checkpoint reserve changed')
    return contract


def round_hash(contract):
    return hashlib.sha256(json.dumps(contract,sort_keys=True,allow_nan=False).encode()).hexdigest()


def require_round_match(existing,requested):
    if existing.get('roundContract')!=requested:
        raise ValueError('Resume omitted or changed original round contract')


def validate_workload(contract,command):
    if command not in ('training','canary','health','export-parity','prepare-arena','arena'):
        raise ValueError('Unknown round workload')
    if (contract['phase']=='evaluation'and command in ('training','canary'))or(contract['phase']=='handoff-proof'and command=='canary'):
        raise ValueError('Evaluation reserve cannot run training')


def bound_runtime(runtime,budget,contract,*,state,wall_now,monotonic_now,boot_identity=0):
    validate_round(contract,state,wall_now)
    validate_workload(contract,runtime['command'])
    identity=round_hash(contract)
    if runtime.get('roundContractSha256',identity)!=identity:
        raise ValueError('Resume changed frozen round contract')
    wall_end=min(runtime['deadlineWall'],stamp(contract['phaseDeadline']),stamp(contract['deadline']))
    mono_end=min(runtime['deadlineMonotonic'],monotonic_now+max(0,wall_end-wall_now))
    if 'roundPhaseMonotonicEnd'in runtime:
        if runtime.get('roundAnchorBootIdentity')!=boot_identity:
            raise ValueError('Reboot requires coordinator round clock reconciliation')
        mono_end=min(mono_end,runtime['roundPhaseMonotonicEnd'])
    duration=mono_end-runtime['startedMonotonic']
    if duration<=60 or mono_end<=monotonic_now:
        raise ValueError('Round has insufficient checkpoint runway')
    runtime.update(roundContractSha256=identity,roundExecutionStartedAt=contract['executionStartedAt'],
                   roundDeadline=contract['deadline'],deadlineWall=wall_end,deadlineMonotonic=mono_end,
                   reserveSeconds=60,roundPhaseMonotonicEnd=mono_end,roundAnchorBootIdentity=boot_identity,
                   optimizationAllowed=contract['phase']in ('pilot','main'))
    # Keep the child's original start. A clamp is not a new allocation.
    seconds=min(budget.seconds,mono_end-budget.started)
    return Budget(budget.started,seconds,wall_end)
