"""Convert a coordinator's live task snapshot without refreshing its timestamp."""
import argparse
import json
import math
from pathlib import Path
import time
from .checkpoint import atomic_json
from .resource_policy import LIMITS


def observation(envelope, now=None):
    now=time.time() if now is None else now
    observed=envelope['observedAt']
    if isinstance(observed,bool) or not isinstance(observed,(float,int)) or not math.isfinite(observed):
        raise ValueError('invalid observation time')
    if not 0<=now-observed<=LIMITS['activityFreshSeconds']:
        raise ValueError('task snapshot is stale or from the future')
    project=envelope['projectId'];excluded=envelope['excludedThreadId']
    expected=set(envelope['expectedThreadIds'])
    if not project or not excluded or not expected or excluded in expected:
        raise ValueError('explicit project, current task and other expected tasks required')
    snapshot=envelope['snapshot']
    rows=[*snapshot.get('pinnedThreads',[]),*snapshot.get('threads',[])]
    relevant={}
    for row in rows:
        if row.get('kind')=='codex' and row.get('projectId')==project and row['id']!=excluded:
            if row['id'] in relevant and relevant[row['id']]!=row['status']:
                raise ValueError('conflicting task status')
            relevant[row['id']]=row['status']
    retired=envelope.get('retiredTasks',{})
    for task,receipt in retired.items():
        if (receipt.get('threadId')!=task or receipt.get('completed') is not True
            or not receipt.get('evidence') or not receipt.get('authorization')):
            raise ValueError('retired task requires completion evidence and scope authorization')
    # Keep the raw observation intact. Verified historical tasks are outside the
    # current work set only while unloaded/absent/idle; resumed work re-enters.
    protected={task:status for task,status in relevant.items()
               if task not in retired or status not in ('notLoaded','idle')}
    missing=sorted(expected-set(relevant)-set(retired))
    unavailable=bool(snapshot.get('unavailableHosts') or snapshot.get('unavailableSources'))
    # Only explicit idle observations can authorize ramp-up. Missing, unloaded,
    # unknown or blocked tasks remain conservative until independently resolved.
    active=bool(missing or unavailable or (not relevant and not retired) or any(s!='idle' for s in protected.values()))
    return {'schema':1,'observedAt':observed,'developmentActive':active,
            'source':'codex-task-snapshot','projectId':project,'excludedThreadId':excluded,
            'tasks':relevant,'protectedTasks':protected,'retiredTasks':retired,
            'missingExpectedTasks':missing,'sourcesUnavailable':unavailable}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('snapshot',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    atomic_json(args.output,observation(json.loads(args.snapshot.read_text())))

if __name__=='__main__':main()
