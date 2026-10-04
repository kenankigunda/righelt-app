"""Observed useful training yield per charged allocation hour, never update count."""
import argparse
import json
import math
from pathlib import Path
import time
import psutil
from .allocation import Allocation, rows
from .checkpoint import atomic_json


def charged_seconds(directory):
    _,closed,pending=Allocation(Path(directory).parent,directory).accounting()
    for interval in pending:
        elapsed=max(0,time.time()-interval['wall'])
        if interval['boot']==psutil.boot_time():elapsed=max(elapsed,time.monotonic()-interval['monotonic'])
        closed+=elapsed
    return closed


def report(events,charged):
    if not math.isfinite(charged) or charged<0:raise ValueError('invalid charged time')
    attempted={};generated={};accepted={};unfinished={};deferred={};phases={};missing=[];unobserved=set()
    for event in events:
        kind=event.get('type')
        if kind=='decision-progress':
            decision=event['decision'];key=decision['id']
            if key in attempted and attempted[key]!=decision:raise ValueError('conflicting decision evidence')
            attempted[key]=decision
        elif kind=='game':
            accepted[event['id']]=event
        elif kind=='generated-game':
            generated[event['id']]=event
        elif kind in ('unfinished','unfinished-verification'):
            identity=event.get('id',event.get('job',{}).get('id'))
            unfinished[identity]=event.get('reason',event.get('result',{}).get('reason','unknown'))
        elif kind=='admission-deferred':
            deferred[event['kind']]=deferred.get(event['kind'],0)+1
        elif kind=='admission-unobserved':unobserved.add(event['id'])
        elif kind in ('training-batch','inference-batch','worker-first-message'):
            phases[kind]=phases.get(kind,0.)+event['seconds']
    policy=value=terminal=0
    for identity,event in accepted.items():
        terminal+=event['termination']=='terminal'
        if 'policyPositions' not in event or 'valuePositions' not in event:
            missing.append(identity);continue
        policy+=event['policyPositions'];value+=event['valuePositions']
    hours=charged/3600
    rate=lambda count:count/hours if hours>0 else None
    attempted_policy=sum(row.get('policyMask',True) for row in attempted.values())
    generated_value=sum(row['valuePositions'] for row in generated.values())
    return {'schema':1,'chargedSeconds':charged,'observedAttemptedDecisions':len(attempted),
            'observedAttemptedPolicyPositions':attempted_policy,
            'observedAttemptedPolicyPositionsPerChargedHour':rate(attempted_policy),
            'generatedValuePositionsBeforeReplay':generated_value,
            'generatedValuePositionsPerChargedHourBeforeReplay':rate(generated_value),
            'acceptedGames':len(accepted),'acceptedTerminalGames':terminal,
            'acceptedPolicyPositions':policy,'acceptedValuePositions':value,
            'acceptedTerminalGamesPerChargedHour':rate(terminal),
            'acceptedPositionCountsComplete':not missing,
            'acceptedPolicyPositionsPerChargedHour':rate(policy) if not missing else None,
            'acceptedValuePositionsPerChargedHour':rate(value) if not missing else None,
            'unfinishedGames':len(unfinished),'deferralsByKind':deferred,'measuredSeconds':phases,
            'legacyGamesWithoutPositionCounts':missing,
            'interruptedLaunchesWithoutDuration':sorted(unobserved),
            'coverage':'Attempted decisions are observed commits, including unfinished games. '
                       'Accepted positions require exact replay. Missing observations are not inferred. '
                       'Phase timings can overlap across workers; first-message time includes engine startup and initial work.'}


def write_report(directory):
    directory=Path(directory)
    result=report(rows(directory/'runner-events.jsonl'),charged_seconds(directory))
    durations=rows(directory/'admission-durations.jsonl')
    for phase in ('generation','replay'):
        result['measuredSeconds'][phase]=sum(row['seconds'] for row in durations if row['phase']==phase)
    atomic_json(directory/'throughput-report.json',result)
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('run_directory',type=Path);args=parser.parse_args()
    print(json.dumps(write_report(args.run_directory),indent=2))


if __name__=='__main__':main()
