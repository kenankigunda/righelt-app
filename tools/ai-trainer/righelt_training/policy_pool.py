"""Prepare policy rows from executed shared calibration, never archive flags."""
import gzip
import hashlib
import json
import time
from .portable import read_bound,resolve_reference
from .replay import ReplayBuffer,encoding_hash


def work_id(archive_sha256,index):
    return 'policy-'+hashlib.sha256((archive_sha256+':'+str(index)).encode()).hexdigest()[:32]


def validate_sampled_counts(adoption):
    counts=adoption.get('sampledCounts')
    ids=adoption.get('ids')
    if (not isinstance(counts,dict) or not isinstance(ids,list) or len(set(ids))!=len(ids)
            or set(counts)!=set(ids) or any(not isinstance(k,str) or not k or type(v)is not int or v<=0 for k,v in counts.items())
            or type(adoption.get('positions'))is not int or sum(counts.values())!=adoption['positions']):
        raise ValueError('policy refresh sampled counts differ from executed adoption')
    return counts


def add_sampled_counts(adoption, actual_ids):
    if not isinstance(actual_ids,list) or any(not isinstance(i,str) or not i for i in actual_ids):
        raise ValueError('actual sampled policy IDs required')
    prior=dict(adoption)
    if 'sampledCounts' not in prior and prior.get('positions')==0 and prior.get('ids')==[]:prior['sampledCounts']={}
    counts=dict(validate_sampled_counts(prior))
    for identity in actual_ids:counts[identity]=counts.get(identity,0)+1
    return {**adoption,'sampledCounts':counts,'ids':sorted(counts),'positions':sum(counts.values())}


def policy_refresh_dose(adoption,replacements,phase):
    counts=validate_sampled_counts(adoption)
    if not isinstance(phase,str) or not phase:raise ValueError('policy refresh phase required')
    rows={r['id']:r for r in replacements}
    if len(rows)!=len(replacements) or set(rows)!=set(counts):raise ValueError('policy refresh dose lacks scheduled IDs')
    groups={}
    for identity,count in counts.items():
        source=rows[identity].get('sourceQualification',{})
        family,ancestor=source.get('familyId'),source.get('sourceFamily')
        if (source.get('kind')!='executed-shared-calibration-row' or not isinstance(family,str) or not family
                or not isinstance(ancestor,str) or not ancestor):raise ValueError('policy refresh dose lacks executed source family')
        group=groups.setdefault((family,ancestor),{'familyId':family,'sourceFamily':ancestor,'sampledPositions':0,'uniquePositions':0})
        group['sampledPositions']+=count;group['uniquePositions']+=1
    return {'schema':1,'phase':phase,'byFamily':[groups[k] for k in sorted(groups)],'totalPositions':sum(counts.values())}


def prepare_pool(pool,execution,work_ids,*,guard_sha256,inventory=None,deadline=None):
    from .checkpoint import inspect_checkpoint
    from .runner import engine_command
    from . import hosted_receipts
    if not isinstance(pool,dict) or pool.get('schema')!=1 or pool.get('kind')!='shared-calibration-policy-pool':
        raise ValueError('executed shared calibration pool required, not hand-labelled rows')
    cp_binding=pool['sourceCheckpoint'];source=json.loads(read_bound(pool['sourceResult']))
    if (cp_binding['sha256']!=execution['inputCheckpointSha256'] or source.get('kind')!='compute-result'
            or source.get('disposition')!='complete' or source.get('allWorkComplete') is not True
            or source.get('execution',{}).get('sourceRevision')!=execution['sourceRevision']
            or source.get('execution',{}).get('scientific',{}).get('stage')!='calibration'
            or source['execution']['scientific'].get('arm')!='shared'
            or not any(a.get('role')=='checkpoint' and a.get('sha256')==cp_binding['sha256'] for a in source.get('artifacts',[]))):
        raise ValueError('source pool differs from actual shared checkpoint execution')
    proof_ref=next((a for a in source['artifacts'] if a.get('role')=='proof'),None)
    proof=json.loads(read_bound(proof_ref))
    if (proof.get('execution')!=source['execution'] or proof.get('kind')!='training-proof'
            or proof.get('checkpointSha256')!=cp_binding['sha256'] or proof.get('recoveryPassed') is not True):
        raise ValueError('shared source lacks bound executed training proof')
    cp=resolve_reference(cp_binding['path'],expected_sha256=cp_binding['sha256'])
    meta=json.loads(resolve_reference(cp.with_suffix('.json')).read_bytes())
    data=inspect_checkpoint(cp,manifest_sha256=meta['manifestSha256'],require_recovery=True)
    state=data['recovery']['state'];count=state.get('inheritedBoundary',{}).get('inheritedReplayCount')
    if type(count)is not int or not 0<=count<len(data['replayIds']):raise ValueError('source has no independently identified fresh calibration games')
    fresh=set(data['replayIds'][count:]);expected=data['recovery']['archives']
    selected=pool.get('selections',[])
    if not selected or [row.get('workId') for row in selected]!=work_ids or len(set(work_ids))!=len(work_ids):
        raise ValueError('frozen selected pool work identities required')
    seconds=pool.get('inventorySeconds')
    if not isinstance(seconds,(int,float)) or not 0<seconds<=600:raise ValueError('bounded replay inventory time required')
    if pool['guards']['sha256']!=guard_sha256:raise ValueError('policy pool differs from frozen method guards')
    guards=json.loads(read_bound(pool['guards']));protected=set(guards['encodingHashes']);families=set(guards['familyIds'])
    grouped={}
    for selection in selected:
        reference=selection.get('archiveReference');index=selection.get('index')
        if reference not in fresh or type(index)is not int or index<0 or selection['workId']!=work_id(expected[reference],index):
            raise ValueError('selected row is not fresh shared computer generation')
        grouped.setdefault(reference,[]).append(index)
    rows_by_work={};inventories={}
    for reference,indices in grouped.items():
        path=resolve_reference(reference,base=cp.parent.parent,expected_sha256=expected[reference])
        with gzip.open(path,'rt') as stream:game=json.load(stream)
        if game.get('schema')!=1 or game.get('partition')!='train' or not isinstance(game.get('modelVersion'),str) or not game['modelVersion']:
            raise ValueError('actual computer-generated training game required')
        if not isinstance(game.get('familyId'),str) or not game['familyId'] or not isinstance(game.get('sourceFamily',game['familyId']),str) or not game.get('sourceFamily',game['familyId']):
            raise ValueError('executed source game family required')
        if len(indices)>32 or len(set(indices))!=len(indices) or any(i>=len(game.get('decisions',[])) for i in indices):
            raise ValueError('bounded unique native decision inventory required')
        remaining=seconds if deadline is None else min(seconds,deadline-time.monotonic())
        namespace='policy-source-inventory:'+execution['manifestSha256']+':'+execution['phase']
        claim=hosted_receipts.evaluation_claim(namespace,expected[reference],create=remaining>0)
        cache_identity={'schema':1,'kind':'executed-policy-source-inventory','manifestSha256':execution['manifestSha256'],
            'phase':execution['phase'],'checkpointSha256':cp_binding['sha256'],'sourceResultSha256':pool['sourceResult']['sha256'],
            'archiveSha256':expected[reference],'guardsSha256':guard_sha256,'indices':indices}
        if claim.get('result') is not None:
            cached=claim['result']
            if any(cached.get(key)!=value for key,value in cache_identity.items()):raise ValueError('source inventory recovery identity mismatch')
            result=cached['result']
        elif claim.get('unclaimed'):raise TimeoutError('source inventory exhausted original stage budget')
        elif not claim['created']:raise ValueError('source inventory consumed without durable verification, requires repair')
        else:
            result=(inventory or engine_command)({'command':'inventory','game':game,'indices':indices,'budgetMs':remaining*1000},timeout=remaining)
            if result.get('type')!='inventoried' or result.get('hash')!=game.get('finalHash'):
                raise ValueError('source game inventory incomplete or mismatched')
            hosted_receipts.settle(namespace,expected[reference],{**cache_identity,'result':result})
        if result.get('type')!='inventoried' or result.get('hash')!=game.get('finalHash'):
            raise ValueError('source game inventory incomplete or mismatched')
        snapshots={row['index']:row for row in result['states']}
        if set(snapshots)!=set(indices):raise ValueError('source inventory omitted selected decisions')
        buffer=ReplayBuffer(protected_encoding_hashes=protected,protected_family_ids=families);buffer.append(game)
        positions={row['id']:row for row in buffer.positions}
        inventories[expected[reference]]=result
        inventory_sha=hashlib.sha256(json.dumps(result,sort_keys=True,allow_nan=False).encode()).hexdigest()
        for index in indices:
            record=game['decisions'][index];snapshot=snapshots[index];position=positions.get(record['id'])
            if (position is None or snapshot['decisionId']!=record['id'] or snapshot['hash']!=record['beforeHash']
                    or snapshot['controller']!=record['controller'] or position.get('policyMask',True) is not True
                    or len(position.get('legal',[]))<2 or snapshot['state'].get('outcome',{}).get('status')!='ongoing'
                    or encoding_hash(position['encoded']) in protected):
                raise ValueError('source row is protected, forced, incomplete or not the executed decision')
            identity=work_id(expected[reference],index)
            rows_by_work[identity]={**position,'encoded':list(position['encoded']),'workId':identity,
                'partition':'train','state':snapshot['state'],'stateHash':snapshot['hash'],'controller':snapshot['controller'],
                'seed':record['seed'],'targetOrigin':'fresh-self-play',
                'sourceQualification':{'kind':'executed-shared-calibration-row','checkpointSha256':cp_binding['sha256'],
                    'familyId':game['familyId'],'sourceFamily':game.get('sourceFamily',game['familyId']),
                    'sourceFamilyBasis':'game-field' if 'sourceFamily' in game else 'game-familyId-fallback',
                    'sourceResultSha256':pool['sourceResult']['sha256'],'archiveSha256':expected[reference],
                    'decisionIndex':index,'inventorySha256':inventory_sha,'guardsSha256':guard_sha256}}
    return [rows_by_work[identity] for identity in work_ids],inventories
