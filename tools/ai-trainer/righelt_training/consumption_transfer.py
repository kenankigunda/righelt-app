"""A closed run consumes job identities, never supplies new learning inputs."""
import hashlib
import json
import re
from .portable import read_bound


def verify(binding,data,*,seed,stage,checkpoint_sha256):
    from .cloud_launch import REPLACEMENT
    raw=read_bound(binding)
    if hashlib.sha256(raw).hexdigest()!=REPLACEMENT['consumptionEvidenceSha256']:
        raise ValueError('unreviewed closed-run consumption evidence')
    r=json.loads(raw);original=r['originalCheckpoint'];closed=r['closedCheckpoint']
    if (r.get('schema')!=1 or r.get('kind')!='closed-exploratory-consumed-work-floor'
            or r.get('episodeId')!=REPLACEMENT['episodeId'] or r.get('parentCampaignId')!=REPLACEMENT['consumedCampaignId']
            or r.get('seed')!=seed or r.get('stage')!=stage or r.get('parentGeneration')!=1
            or r.get('parentClosed') is not True or r.get('parentCleanupVerified') is not True
            or r['parentAttempt'].get('uncertain') is not False or type(r['parentAttempt'].get('endedAt')) is not int
            or r.get('sameAllocationResumes')!=0 or r.get('newGenerationFromOriginalCheckpoint') is not True
            or original['sha256']!=checkpoint_sha256 or original['recoverySha256']!=data['recoverySha256']
            or original['nextJob']!=data['recovery']['state']['nextJob'] or original['updates']!=data['updates']
            or closed['updates']!=data['updates'] or closed['freshOptimizerUpdates']!=0):
        raise ValueError('closed-run input, closure, or seed/stage differs')
    floor=r['minimumNextJob'];counter=r['allocationRecoveryLedger']
    parent_root=None;ids=[]
    for index,item in enumerate(r['consumedJobs'],start=original['nextJob']):
        expected=f'{stage}-game-{seed}-{index}';key=hashlib.sha256(('training:'+expected).encode()).hexdigest()
        launch=item['launch'];directory=launch['directory'];root=directory.rsplit('/',1)[0]
        if (item['jobId']!=expected or launch['jobId']!=expected or item['claimKey']!=key
                or r['controllerClaims'].get(key)!=item['claim'] or item['claim'].get('generation')!=r['parentGeneration']
                or item['claim'].get('phaseIndex')!=0 or not item['claim']['at']<=launch['claimedAt']*1000
                or launch['claimedAt']*1000>r['parentAttempt']['endedAt']
                or item['disposition'] not in ('terminal-evidence-only','unfinished-consumed')
                or not directory.endswith('/'+r['parentCampaignId']+'/run') or parent_root not in (None,root)):
            raise ValueError('closed-run consumed claim or launch differs')
        parent_root=root;ids.append(expected)
    counter_key=hashlib.sha256(f'{parent_root}:job:{stage}:{seed}'.encode()).hexdigest()
    checkpoint_counter_key=hashlib.sha256(f'{parent_root}:checkpoint:'.encode()).hexdigest()
    if (type(floor) is not int or floor<REPLACEMENT['minimumNextJob'] or floor!=original['nextJob']+len(ids)
            or closed['nextJob']!=floor or counter.get('jobs',{}).get(f'{stage}:{seed}')!=floor
            or r['controllerCounters'].get(counter_key)!=floor
            or r['controllerCounters'].get(checkpoint_counter_key)!=counter['checkpoints']):
        raise ValueError('closed-run counter floor differs')
    treatment=r['p3GameTreatment'];excluded=treatment['excludedGameHashes']
    if (treatment.get('replacementReplayIncluded') is not False or treatment.get('replacementFreshAccountingIncluded') is not False
            or treatment.get('preservedAsImmutableEvidence') is not True or len(excluded)!=2
            or any(not re.fullmatch('[a-f0-9]{64}',v) for v in excluded)
            or set(excluded)&set(data['recovery']['archives'].values())):
        raise ValueError('closed P3 games cannot enter replacement learning')
    return {'schema':1,'kind':'verified-consumption-floor','evidenceSha256':binding['sha256'],
            'seed':seed,'stage':stage,'minimumNextJob':floor,'parentCampaignId':r['parentCampaignId'],
            'closedCheckpointSha256':closed['sha256'],'consumedJobs':ids,'excludedGameHashes':excluded}


def apply(runner,data,checkpoint_sha256):
    plan=runner.manifest['manifest'].get('exploratoryWindow',{})
    binding=plan.get('consumedWorkTransfer')
    if not binding:return
    from .cloud_launch import REPLACEMENT
    if plan.get('launchAuthorityId')!=REPLACEMENT['id']:raise ValueError('consumption transfer needs replacement authority')
    proof=verify(binding,data,seed=runner.seed,stage=runner.stage,checkpoint_sha256=checkpoint_sha256)
    runner.ledger.seed_job_floor(runner.stage,runner.seed,proof['minimumNextJob'],proof)
    runner.state.update(nextJob=proof['minimumNextJob'],pendingGenerationJob=None,phase='generation',trainingBatch=0)
    runner.state['consumptionTransfer']=proof
