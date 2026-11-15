"""Bounded operator report over private collected objects; never reruns players."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from .evaluation import paired_arm_report
from .prospective_durability import sha


class Objects:
    def __init__(self,root):
        self.root=Path(root).resolve(strict=True)
        if self.root.name!='.objects' or not self.root.is_dir():raise ValueError('private flat .objects directory required')
    def read(self,digest):
        if not isinstance(digest,str) or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('object SHA required')
        fd=os.open(self.root/digest,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size>64*1024*1024:raise ValueError('bounded regular object required')
            raw=stream.read(64*1024*1024+1)
        if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('object checksum mismatch')
        return json.loads(raw)


def arm_records(store,bindings):
    training=store.read(bindings['trainingResultSha256']);result=store.read(bindings['evaluationResultSha256'])
    plan=store.read(result['execution']['planSha256'])
    proof=store.read(next(a['sha256'] for a in result['artifacts'] if a['role']=='proof'))
    models=[a for a in training['artifacts'] if a['role']=='model']
    if len(models)!=1 or plan.get('candidateSha256')!=models[0]['sha256'] or plan.get('models',{}).get('candidate',{}).get('sha256')!=models[0]['sha256'] or plan.get('models',{}).get('opponent',{}).get('sha256')!='f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f':raise ValueError('validation requires exact actual arm output and original opponent')
    schedule=plan['schedule'];receipts=proof['workReceipts']
    if (result.get('kind')!='compute-result' or result.get('disposition')!='complete' or proof.get('kind')!='evaluation-proof'
            or proof['execution']!=result['execution'] or result['accountedWorkIds']!=[j['id'] for j in schedule]
            or [r['workId'] for r in receipts]!=[j['id'] for j in schedule]
            or any(j['partition']!='validation' for j in schedule)):raise ValueError('complete validation inventory required')
    artifacts={a['sha256'] for a in result['artifacts']};rows=[]
    for job,receipt in zip(schedule,receipts):
        if receipt['status']=='unstarted':continue
        if receipt.get('evidenceSha256') not in artifacts:raise ValueError('retained qualified attempt required')
        row=store.read(receipt['evidenceSha256'])
        keys=['pairId','candidateSeat','profile','familyId','sourceFamily','role','seed','startKind','startIdentity']
        if row.get('jobId')!=job['id'] or row.get('status')!=receipt['status'] or any(row.get(k)!=job.get(k) for k in keys):raise ValueError('attempt differs from frozen work')
        if row['status']=='complete':
            if any(row.get(k) not in artifacts for k in ['rawEvidenceSha256','verificationEvidenceSha256']):raise ValueError('raw and replay artifacts required')
            raw=store.read(row['rawEvidenceSha256']);verified=store.read(row['verificationEvidenceSha256'])
            if (row.get('engineReplayVerified') is not True or row.get('outcome') not in ('p1_win','p2_win','draw')
                    or raw.get('status')!='raw-complete' or row.get('game')!=raw.get('game') or row.get('gameSha256')!=sha(row['game'])
                    or verified.get('kind')!='prospective-replay-verification' or verified.get('engineReplayVerified') is not True
                    or verified.get('rawSha256')!=sha(raw) or verified.get('outcome')!=row['outcome']
                    or verified.get('startIdentity')!=job.get('startIdentity') or verified.get('verifier',{}).get('sourceRevision')!=result['execution']['sourceRevision']):raise ValueError('raw consumption alone is not scoring evidence')
        rows.append(row)
    return schedule,rows,training,result


def produce(request,objects):
    store=Objects(objects);comparison=store.read(request['comparisonSha256']);rules=store.read(request['rulesSha256'])
    selection=store.read(request['selectionRuleSha256'])
    if comparison['rulesSha256']!=request['rulesSha256'] or comparison['selectionRuleSha256']!=request['selectionRuleSha256'] or selection['rulesSha256']!=request['rulesSha256']:raise ValueError('frozen ancestry differs')
    arms={arm:arm_records(store,request['armResults'][arm]) for arm in ('control','treatment')}
    for arm,(schedule,rows,training,result) in arms.items():
        for source,stage in [(training,'training'),(result,'evaluation')]:
            campaign=next(c for c in comparison['campaigns'] if c['arm']==arm and c['stage']==stage)
            execution=source['execution']
            if (execution['campaign']!=campaign['id'] or execution['scientific']['experimentSha256']!=request['comparisonSha256']
                    or execution['scientific']['arm']!=arm or any(execution[k]!=comparison['commonStart'][k] for k in ('sourceRevision','dependencySha256'))):raise ValueError('unregistered arm result')
            if stage=='training' and execution['planSha256']!=campaign['phasePlanSha256']:raise ValueError('training plan differs')
        campaign=next(c for c in comparison['campaigns'] if c['arm']==arm and c['stage']=='evaluation')
        plan=store.read(result['execution']['planSha256'])
        if schedule!=store.read(campaign['scheduleSha256']) or plan.get('primaryScope')!=rules['primaryScope'] or plan.get('uncertainty')!=rules['uncertainty']:raise ValueError('validation schedule/scope/settings differs')
    paired=paired_arm_report(arms['control'][0],arms['control'][1],arms['treatment'][0],arms['treatment'][1],rules['primaryScope'],rules['uncertainty'])
    paired['uncertaintyClassification']='diagnostic-only-not-controller-recomputed'
    return {'schema':1,'kind':'executed-paired-arm-comparison',**{k:request[k] for k in ('comparisonSha256','rulesSha256','selectionRuleSha256','armResults')},
            **{k:comparison['commonStart'][k] for k in ('sourceRevision','dependencySha256')},'pairedReport':paired}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--objects',required=True);parser.add_argument('--request',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(produce(json.loads(args.request.read_bytes()),args.objects),sort_keys=True,allow_nan=False))
if __name__=='__main__':main()
