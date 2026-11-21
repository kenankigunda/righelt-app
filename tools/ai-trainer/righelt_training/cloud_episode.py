"""The separately authorized original1086 repair episode, never old clock edits."""
import json
import math
from pathlib import Path

LIMITS=json.loads((Path(__file__).resolve().parents[3]/'tools/hosted-compute/cloud-repair-20261120.json').read_bytes())


def validate(plan):
    if (plan.get('schema')!=2 or plan.get('episodeId')!=LIMITS['id']
            or plan.get('executionScope')!='cloud-repair-original1086'
            or plan.get('maximumSameAllocationResumes')!=0
            or plan.get('repairStartedAtWall')!=LIMITS['repairStartedAt']/1000
            or plan.get('repairDeadlineWall')!=LIMITS['repairDeadline']/1000
            or plan.get('artifactAfterTrainingSeconds')!=LIMITS['artifactAfterTrainingMs']/1000
            or plan.get('maximumTrainingSeconds')!=LIMITS['maximumAllocationMs']/1000
            or type(plan.get('allocationStartWall')) not in (int,float)
            or not math.isfinite(plan['allocationStartWall'])
            or not plan['repairStartedAtWall']<=plan['allocationStartWall']<plan['repairDeadlineWall']
            or plan.get('checkpoint',{}).get('sha256')!=LIMITS['checkpointSha256']):
        raise ValueError('explicit original1086 cloud repair authority required')
    training,artifact=plan.get('trainingStopWall'),plan.get('artifactDeadlineWall')
    if (type(training) not in (int,float) or not math.isfinite(training)
            or type(artifact) not in (int,float) or not math.isfinite(artifact)
            or not plan['allocationStartWall']<training<=plan['allocationStartWall']+plan['maximumTrainingSeconds']
            or artifact!=training+plan['artifactAfterTrainingSeconds']):
        raise ValueError('cloud repair training/artifact ceilings differ')
    return plan


def artifact_deadline(plan,runner_result):
    validate(plan)
    ended=runner_result.get('trainingStoppedAtMs')
    if (type(ended) is not int
            or not plan['allocationStartWall']*1000<=ended<=plan['trainingStopWall']*1000):
        raise ValueError('actual sealed training stop missing or outside episode')
    return min(plan['artifactDeadlineWall'],ended/1000+plan['artifactAfterTrainingSeconds'])


def start_repair(directory,plan,now):
    """The new absolute repair clock starts at human authorization, not Pod boot."""
    validate(plan)
    if not plan['repairStartedAtWall']<=now<plan['repairDeadlineWall']:
        raise ValueError('cloud repair startup window expired')
    from .allocation import append,rows
    from .exploratory_contract import digest
    path=Path(directory)/'exploratory-recovery.jsonl'
    events=rows(path)
    if events:
        first=events[0]
        if (first.get('event')!='repair-started' or first.get('observedAt')!=plan['repairStartedAtWall']
                or first.get('episodeId')!=plan['episodeId'] or first.get('planSha256')!=digest(plan)):
            raise ValueError('cloud repair clock binding changed')
    else:append(path,{'event':'repair-started','observedAt':plan['repairStartedAtWall'],
        'episodeId':plan['episodeId'],'planSha256':digest(plan)})
