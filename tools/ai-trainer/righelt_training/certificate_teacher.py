"""Bounded development teaching and exact-prefix public-search diagnostics."""
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import time
from .config import ROOT

PROFILE={'simulations':128,'temperature':0,'maxValueGap':0.01}


def bridge(job,seconds=30):
    result=subprocess.run(['node','--import','tsx',str(ROOT/'tools/ai-trainer/certificate-teacher.mjs')],
        cwd=ROOT,input=json.dumps(job,allow_nan=False),capture_output=True,text=True,timeout=seconds,check=True)
    return json.loads(result.stdout)


def diagnostic(runner,packet,guards,deadline):
    from .search_parity import search_reference,completed_search
    runner.model.eval();reports=[]
    for case in packet['cases']:
        state=case['rootState'];actions=[];status='UNKNOWN'
        try:
            for index in range(6):
                seconds=min(30,deadline-time.monotonic())
                if seconds<2:raise TimeoutError('diagnostic deadline')
                facts=bridge({'mode':'facts','state':state,'guards':guards},seconds)
                if not facts['legal']:break
                with runner.operation('certificate-public-search',seconds):
                    answer=search_reference(state,runner.model,runner.device,2026112407+index,PROFILE,seconds)
                if not completed_search(answer):break
                action=answer.get('action')
                if action is None:break
                actions.append(action)
                state=bridge({'mode':'step','state':state,'action':action,'guards':guards},seconds)['state']
                if state['outcome']['status']!='ongoing' or state['turnIndex']!=case['rootState']['turnIndex']:
                    if actions==case['knownDefensivePrefix']:status='certified-safe-complete-prefix'
                    elif actions==case['knownLosingPrefix'][:len(actions)]:status='known-losing-completed-turn'
                    break
        except (TimeoutError,subprocess.SubprocessError) as error:
            status='UNKNOWN';failure=type(error).__name__
        else:failure=None
        reports.append({'caseId':case['id'],'knownDeficient':case['knownDeficient'],'actions':actions,
            'disposition':status,'failure':failure,'scope':case['scope']})
    return {'schema':1,'profile':PROFILE,'seed':2026112407,'cases':reports,'strengthEstablished':False}


def accepted(before,after):
    old={r['caseId']:r for r in before['cases']}
    improved=any(r['knownDeficient'] and r['disposition']=='certified-safe-complete-prefix'
        and old[r['caseId']]['disposition']=='known-losing-completed-turn' for r in after['cases'])
    regressed=any(old[r['caseId']]['disposition']=='certified-safe-complete-prefix'
        and r['disposition']!='certified-safe-complete-prefix' for r in after['cases'])
    return improved and not regressed


def validate_packet(packet):
    if (packet.get('schema')!=1 or packet.get('kind')!='certificate-policy-demonstrations'
            or len(packet.get('rows',[]))!=7 or len(packet.get('proofs',[]))!=3
            or any(p['proof'].get('disposition')!='complete' for p in packet['proofs'])):
        raise ValueError('complete scoped certificate teaching proof required')
    for row in packet['rows']:
        if (row.get('terminalMask') is not False or row.get('policyMask') is not True
                or any(row.get('futureFacts',{}).get('mask',[])) or len(row.get('encoded',[]))!=4600
                or len(row.get('policy',[]))!=1 or row['policy'][0]['probability']!=1
                or row['policy'][0]['index'] not in row['legal']):
            raise ValueError('certificate row upgrades target scope')
    return packet


def policy_fit(runner,packet):
    import torch
    runner.model.eval()
    x=torch.tensor([r['encoded'] for r in packet['rows']],dtype=torch.float32,device=runner.device).reshape(-1,46,10,10)
    with torch.inference_mode():logits,_=runner.model(x)
    losses=[]
    for index,row in enumerate(packet['rows']):
        legal=row['legal'];target=legal.index(row['policy'][0]['index'])
        losses.append(float(-torch.log_softmax(logits[index,legal],dim=0)[target]))
    return sum(losses)/len(losses)


def train(runner,packet,guards,deadline):
    from .checkpoint import atomic_json
    from .trainer import train_round
    from . import fresh_health
    validate_packet(packet)
    packet_sha=hashlib.sha256(json.dumps(packet,sort_keys=True).encode()).hexdigest()
    input_checkpoint=json.loads((runner.directory/'latest.json').read_text())['checkpoint']
    def initialize(version,weight):
        value={'packetSha256':packet_sha,'updates':0,'correctionSamples':0,'version':version,'policyWeight':weight}
        runner.state['localCertificateTeaching']=value
        atomic_json(runner.directory/f'targeted-plan-{version}.json',{'packetSha256':packet_sha,'inputCheckpoint':input_checkpoint,
            'seed':2026112402,'batchSize':128,'correctionEvery':5,'policyWeight':weight,'maxUpdates':4096,
            'deadlineMonotonic':deadline,'valueAndFutureMasksPreserved':True})
        return value
    state=runner.state.get('localCertificateTeaching') or initialize(1,1)
    if state['packetSha256']!=packet_sha:raise ValueError('recovered teaching pool changed')
    before=diagnostic(runner,packet,guards,min(deadline,time.monotonic()+600))
    initial_fit=policy_fit(runner,packet)
    atomic_json(runner.directory/'targeted-before.json',{**before,'meanSelectedPolicyLoss':initial_fit})
    replay=list(runner.buffer.positions)
    if not replay:raise ValueError('targeted rehearsal lacks ordinary replay')
    attempts=[];revision_used=False;accepted_result=False;limit=512
    def sampler(cursor):
        rng=random.Random(2026112402)
        for slot in range(cursor):rng.randrange(len(packet['rows']) if (slot+1)%5==0 else len(replay))
        return rng
    rng=sampler(state['updates']*128);slot=state['updates']*128
    after=before
    while deadline-time.monotonic()>120:
        while state['updates']<limit and deadline-time.monotonic()>45:
            if runner.allocation().get('paused'):time.sleep(.25);continue
            batch=[];corrections=0
            for _ in range(128):
                slot+=1;correct=slot%5==0;pool=packet['rows'] if correct else replay
                batch.append(pool[rng.randrange(len(pool))]);corrections+=int(correct)
            result=train_round(runner.model,runner.optimizer,batch,device=runner.device,
                seed=2026112402+state['updates'],deadline=deadline,operation=runner.operation,
                evidence_game_ids=fresh_health.eligible_game_ids(runner.state),certificate_policy_weight=state['policyWeight'])
            if result['updates']!=1:break
            metrics=result['batches'][0]
            runner.state['updates']+=1;runner.state['nonzeroUpdates']+=1
            state['updates']+=1;state['correctionSamples']+=corrections
            fresh_health.record_batch(runner.state,metrics)
            runner.event('certificate-training-batch',**metrics,correctionSamples=corrections,packetSha256=packet_sha)
            runner.checkpoint()
        after=diagnostic(runner,packet,guards,min(deadline,time.monotonic()+600))
        fit=policy_fit(runner,packet);accepted_result=accepted(before,after)
        attempt={'version':state['version'],'updates':state['updates'],'policyWeight':state['policyWeight'],
            'meanSelectedPolicyLoss':fit,'accepted':accepted_result,'after':after}
        attempts.append(attempt);atomic_json(runner.directory/f'targeted-check-{len(attempts)}.json',attempt)
        solved_before={r['caseId'] for r in before['cases'] if r['disposition']=='certified-safe-complete-prefix'}
        regression=any(r['caseId'] in solved_before and r['disposition']!='certified-safe-complete-prefix' for r in after['cases'])
        if accepted_result or regression or state['updates']<limit:break
        if fit>=initial_fit and not revision_used and deadline-time.monotonic()>900:
            # One changed factor, restored to the identical broad endpoint.
            runner.restore(Path(input_checkpoint));revision_used=True;state=initialize(2,2)
            rng=sampler(0);slot=0;limit=512;continue
        if fit<initial_fit and limit<4096 and deadline-time.monotonic()>900:
            # Same admitted recipe, bounded extra dose justified by measured partial uptake.
            limit=min(4096,limit*2);continue
        break
    result={'schema':1,'accepted':accepted_result,'before':before,'after':after,'attempts':attempts,
        'newUpdatesInSelectedEndpoint':state['updates'],'correctionSamplesInSelectedEndpoint':state['correctionSamples'],
        'packetSha256':packet_sha,'revisionExperiment':'double-policy-weight' if revision_used else 'none',
        'surroundingStartAlternative':'No separately qualified generalization-start contrast in this seven-position packet',
        'strengthEstablished':False}
    atomic_json(runner.directory/'targeted-result.json',result)
    return result
