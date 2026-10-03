"""Timing gates retain failed/censored computations in percentile denominators."""
import argparse
import json
import math
from pathlib import Path
from .config import ROOT
from .checkpoint import atomic_json
CONFIG=json.loads((ROOT/'packages/computer-player/config/benchmark-v1.json').read_text())


def metric(samples,target_ms):
    interrupted=[s for s in samples if s['status']=='interrupted']
    attempted=[s for s in samples if s['status']!='interrupted']
    for s in samples:
        if s['status'] not in ('completed','failed','unfinished','interrupted') or not math.isfinite(s['durationMs']) or s['durationMs']<0:
            raise ValueError('invalid measurement')
    # A failed/unfinished computation has unknown successful completion time.
    # Treat it as +infinity, rather than making success-only percentiles look fast.
    values=sorted(s['durationMs'] if s['status']=='completed' else math.inf for s in attempted)
    def percentile(q):
        if not values:return None
        value=values[max(0,math.ceil(q*len(values))-1)]
        return value if math.isfinite(value) else None
    timely=sum(s['status']=='completed' and s['durationMs']<=target_ms for s in attempted)
    return {'attempts':len(attempted),'interruptions':len(interrupted),'completed':sum(s['status']=='completed' for s in attempted),
            'timelyFraction':timely/len(attempted) if attempted else None,'p90Ms':percentile(.9),'p99Ms':percentile(.99),
            'failedOrUnfinished':sum(s['status']!='completed' for s in attempted),
            'softTargetPassed':bool(attempted) and timely/len(attempted)>=.9,
            'outliers':[s for s in samples if s['status']!='completed' or s['durationMs']>target_ms]}


def report(data):
    samples=data['measurements'];profiles={}
    for profile in CONFIG['profiles']:
        steps=[s for s in samples if s.get('profile')==profile and s['kind']=='step']
        sequences=[s for s in samples if s.get('profile')==profile and s['kind']=='sequence']
        single=metric([s for s in steps if not s.get('sequenceStep')],CONFIG['softStepMs'])
        continuation=metric([s for s in steps if s.get('sequenceStep')],CONFIG['softSequenceStepMs'])
        sequence=metric(sequences,CONFIG['softSequenceMs'])
        all_steps=metric(steps,CONFIG['softStepMs'])
        step_cutoff=max(CONFIG['provisionalStepWatchdogMs'],2*all_steps['p99Ms']) if all_steps['p99Ms'] is not None else None
        sequence_cutoff=max(CONFIG['provisionalSequenceWatchdogMs'],2*sequence['p99Ms']) if sequence['p99Ms'] is not None else None
        enough=all_steps['attempts']>=CONFIG['stepsPerProfile'] and sequence['attempts']>=CONFIG['sequencesPerProfile']
        profiles[profile]={'single':single,'continuation':continuation,'sequence':sequence,'enoughSamples':enough,
                           'derivedStepMs':step_cutoff,'derivedSequenceMs':sequence_cutoff,
                           'reviewRequired':step_cutoff is None or sequence_cutoff is None or step_cutoff>CONFIG['maximumDerivedStepMs'] or sequence_cutoff>CONFIG['maximumDerivedSequenceMs'],
                           'softTargetsPassed':enough and single['softTargetPassed'] and continuation['softTargetPassed'] and sequence['softTargetPassed']}
    return {'schema':1,'profiles':profiles,'cold':metric([s for s in samples if s['kind']=='preparation'],CONFIG['coldTargetMs']),
            'device':data.get('device'),'network':data.get('network'),'userAgent':data.get('userAgent'),
            'acceptancePassed':False,'remaining':['verify actual acceptance device and cellular conditions','freeze final profiles/cutoffs','independent verification workload','human playing-experience approval']}


def main():
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);args=p.parse_args()
    result=report(json.loads(args.input.read_text()));atomic_json(args.output,result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
