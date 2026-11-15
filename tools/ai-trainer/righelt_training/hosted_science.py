"""Narrow hosted adapters for frozen prospective evaluation and policy refresh.

No method selection, final-family creation, checkpoint shopping or model
promotion occurs here. Plans and input hashes are supplied by the reviewed
launch package. Every scheduled item receives an honest retained disposition.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time

from .config import CONFIG, ROOT
from .portable import read_bound, resolve_reference


def digest(raw):return hashlib.sha256(raw).hexdigest()


def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(value,sort_keys=True,allow_nan=False)+'\n').encode()
    if path.exists():
        if path.read_bytes()!=raw:raise ValueError('immutable scientific output differs')
    else:
        with path.open('xb') as stream:stream.write(raw)
    return path


def artifact(path,role):
    path=Path(path).resolve();relative=path.relative_to(Path.cwd().resolve())
    raw=path.read_bytes()
    return {'name':digest(raw),'sha256':digest(raw),'bytes':len(raw),'path':str(relative),'role':role}


def emit_result(directory,kind,execution,receipts,evidence,fields,*,additional_artifacts=(),result_fields=None):
    directory=Path(directory)
    proof={'schema':1,'kind':kind+'-proof','execution':execution,'workReceipts':receipts,**fields}
    proof_path=write_json(directory/f"proof-{execution['generation']}.json",proof)
    artifacts=[artifact(path,'attempt') for path in evidence]+[artifact(proof_path,'proof')]+list(additional_artifacts)
    result={'schema':1,'kind':'compute-result','disposition':'complete','execution':execution,
            'accountedWorkIds':[r['workId'] for r in receipts],
            'completedWorkIds':[r['workId'] for r in receipts if r['status']=='complete'],
            'artifacts':artifacts,'allWorkComplete':all(r['status']=='complete' for r in receipts),
            'strengthEstablished':False,**(result_fields or {})}
    from .checkpoint import atomic_json
    atomic_json(directory/'result.json',result)
    return result


def validate_adapter_stage(execution,command,plan):
    stage=execution.get('scientific',{}).get('stage')
    allowed={'training':{'training','calibration'},'evaluation':{'evaluation','calibration'},'teacher':{'teacher-screen'}}
    if stage not in allowed[command]:raise ValueError('scientific stage and executed adapter differ')
    final_fields={'finalFamilies','finalConsumption','rawFinal','protectedFinal'}
    def carries_final(value):
        if isinstance(value,list):return any(carries_final(item) for item in value)
        if isinstance(value,dict):return bool(final_fields.intersection(value)) or value.get('partition')=='final' or any(carries_final(item) for item in value.values())
        return False
    final_bearing=carries_final(plan)
    if final_bearing and (command!='evaluation' or stage!='evaluation'):
        raise ValueError('final material requires locked evaluation-only adapter')


def frozen_context():
    value=json.loads(resolve_reference(os.environ['RIGHELT_EXECUTION_CONTEXT']).read_bytes())
    execution=value['execution'];science=execution.get('scientific')
    if not science:raise ValueError('explicit hosted scientific admission required')
    return execution,value['completedWorkIds']


def authoritative_profiles():
    return json.loads(subprocess.check_output(['node','--import','tsx','tools/ai-trainer/public-evaluation-profiles.mjs'],cwd=ROOT,text=True))


def validate_schedule(plan,profiles,work_ids,execution):
    schedule=plan.get('schedule',[])
    if (plan.get('schema')!=1 or plan.get('kind')!='prospective-public-profile-evaluation'
            or plan.get('profiles')!=profiles or plan.get('candidateSha256')!=execution['scientific'].get('candidateSha256')
            or [j.get('id') for j in schedule]!=work_ids or len(set(work_ids))!=len(work_ids)):
        raise ValueError('frozen prospective evaluation identity mismatch')
    binding=plan.get('familyInventory')
    if not isinstance(binding,dict) or binding.get('sha256')!=execution['scientific'].get('familyInventorySha256'):
        raise ValueError('frozen family inventory differs from execution')
    inventory=json.loads(read_bound(binding));families={};partitions={}
    if inventory.get('schema')!=1 or not isinstance(inventory.get('families'),list) or not inventory['families']:
        raise ValueError('complete source-family inventory required')
    for family in inventory['families']:
        if (not isinstance(family.get('id'),str) or not isinstance(family.get('sourceFamily'),str)
                or family.get('partition') not in ('train','validation','final') or family['id'] in families
                or family['sourceFamily'] in partitions and partitions[family['sourceFamily']]!=family['partition']):
            raise ValueError('source family split across partitions')
        families[family['id']]=family;partitions[family['sourceFamily']]=family['partition']
    groups={}
    for job in schedule:
        if (job.get('profile') not in profiles['profiles'] or job.get('candidateSeat') not in ('P1','P2')
                or job.get('role') not in ('candidate','baseline-diagnostic') or job.get('partition') not in ('validation','final')
                or not isinstance(job.get('familyId'),str) or not isinstance(job.get('pairId'),str)
                or type(job.get('seed'))is not int or not 0<=job['seed']<2**32
                or not isinstance(job.get('gameSeconds'),(int,float)) or not 0<job['gameSeconds']<=3600):
            raise ValueError('invalid frozen evaluation job')
        family=families.get(job['familyId'])
        if family is None or family['partition']!=job['partition'] or family['sourceFamily']!=job.get('sourceFamily'):
            raise ValueError('scheduled source-family membership differs from frozen inventory')
        groups.setdefault((job['pairId'],job['profile'],job['role']),[]).append(job)
    if any(len(jobs)!=2 or {j['candidateSeat'] for j in jobs}!={'P1','P2'} or len({(j['familyId'],j['seed']) for j in jobs})!=1 for jobs in groups.values()):
        raise ValueError('paired seats with fixed family and seed required')
    if {j['profile'] for j in schedule if j['role']=='candidate'}!={'babs','tau','horus'}:
        raise ValueError('all public profiles required')
    if any(j['partition']=='final' for j in schedule):
        receipt=json.loads(read_bound(plan.get('finalConsumption')))
        if (receipt.get('schema')!=1 or receipt.get('kind')!='locked-final-consumption'
                or receipt.get('candidateSha256')!=plan['candidateSha256']
                or receipt.get('experimentSha256')!=execution['scientific']['experimentSha256']
                or receipt.get('familyIds')!=sorted({j['familyId'] for j in schedule if j['partition']=='final'})
                or receipt.get('consumed') is not True):raise ValueError('locked final consumption receipt required')
    return schedule


def evaluate(plan,directory,execution,work_ids,*,seconds,player=None):
    validate_adapter_stage(execution,'evaluation',plan)
    started=time.monotonic()
    from . import hosted_receipts
    from .arena import play_game, verify_game
    from .evaluation import prospective_report
    from .export_runtime import ExportedModel
    schedule=validate_schedule(plan,authoritative_profiles(),work_ids,execution)
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    models={};device='cpu-onnxruntime'
    for role in ('candidate','opponent'):
        models[role]=ExportedModel(plan['models'][role])
    if plan['models']['candidate']['sha256']!=plan['candidateSha256']:raise ValueError('evaluation candidate differs from lock')
    deadline=started+seconds;records=[];receipts=[];paths=[]
    namespace='prospective:'+execution['manifestSha256']+':'+execution['phase']
    profile_artifact=digest(json.dumps(plan['profiles'],sort_keys=True,allow_nan=False).encode())
    for job in schedule:
        seat=job['candidateSeat'];other='P2' if seat=='P1' else 'P1'
        profile=plan['profiles']['profiles'][job['profile']]
        model_versions={seat:plan['models']['candidate']['sha256'],other:plan['models']['opponent']['sha256']}
        if job['role']=='baseline-diagnostic':model_versions={seat:plan['models']['opponent']['sha256'],other:plan['models']['opponent']['sha256']}
        profile_versions={'P1':profile['version'],'P2':profile['version']}
        raw={'jobId':job['id'],'pairId':job['pairId'],'candidateSeat':job['candidateSeat'],
            'profile':job['profile'],'familyId':job['familyId'],'sourceFamily':job['sourceFamily'],'role':job['role'],'receiptId':execution['manifestSha256']+':'+job['id']}
        claim=hosted_receipts.evaluation_claim(namespace,job['id'],create=time.monotonic()<deadline-20)
        if claim.get('unclaimed'):raw.update(status='unstarted',reason='original-budget')
        elif not claim['created']:
            retained=claim.get('result')
            if retained is None:raw.update(status='unfinished',reason='consumed-without-settlement')
            else:
                if any(retained.get(k)!=raw[k] for k in ('jobId','pairId','candidateSeat','profile','familyId','sourceFamily','role')):
                    raise ValueError('recovered prospective receipt identity mismatch')
                raw=retained
                if raw['status']=='complete':
                    game=raw['game']
                    if (raw.get('engineReplayVerified') is not True
                            or raw.get('gameSha256')!=digest(json.dumps(game,sort_keys=True,allow_nan=False).encode())
                            or game.get('id')!=job['id'] or game.get('seed')!=job['seed'] or game.get('familyId')!=job['familyId']
                            or game.get('partition')!=job['partition'] or game.get('modelVersions')!=model_versions or game.get('profileVersions')!=profile_versions
                            or raw.get('outcome')!=game.get('outcome',{}).get('status')):
                        raise ValueError('recovered evaluation lacks original bound replay proof')
        else:
            engine_job={**job,'prospectiveEvaluation':True,'evaluationProfile':{'name':job['profile'],'sourceSha256':plan['profiles']['sourceSha256'],
                'definition':profile,'artifactSha256':profile_artifact},'profiles':{'P1':profile,'P2':profile},
                'modelVersions':{seat:plan['models']['candidate']['sha256'],other:plan['models']['opponent']['sha256']},
                'profileVersions':{'P1':profile['version'],'P2':profile['version']}}
            by_seat={seat:models['candidate'],other:models['opponent']}
            if job['role']=='baseline-diagnostic':
                by_seat={seat:models['opponent'],other:models['opponent']}
                engine_job['modelVersions']={seat:plan['models']['opponent']['sha256'],other:plan['models']['opponent']['sha256']}
            result=(player or play_game)(engine_job,by_seat,min(deadline,time.monotonic()+job['gameSeconds']+10),device)
            if result.get('status')=='completed':
                game=result['game'];verify_game(game,deadline)
                if (game.get('id')!=job['id'] or game.get('seed')!=job['seed'] or game.get('familyId')!=job['familyId']
                        or game.get('modelVersions')!=engine_job['modelVersions'] or game.get('profileVersions')!=engine_job['profileVersions']):
                    raise ValueError('executed evaluation identity mismatch')
                terminal=game['outcome']['status'] in ('p1_win','p2_win','draw')
                raw.update(status='complete' if terminal else 'unfinished',outcome=game['outcome']['status'],game=game,engineReplayVerified=True,
                    gameSha256=digest(json.dumps(game,sort_keys=True,allow_nan=False).encode()))
                if not terminal:raw['reason']='truncated:'+str(game.get('truncationReason','unknown'))
            elif result.get('status')=='unfinished':raw.update(status='unfinished',reason=result.get('reason','unknown'))
            else:raise ValueError('evaluation correctness failure')
            hosted_receipts.settle(namespace,job['id'],raw)
        path=write_json(directory/'attempts'/str(execution['generation'])/(hashlib.sha256(job['id'].encode()).hexdigest()+'.json'),raw)
        paths.append(path);records.append(raw)
        receipts.append({'workId':job['id'],'status':raw['status'],**({'evidenceSha256':digest(path.read_bytes())} if raw['status']!='unstarted' else {})})
    report=prospective_report(schedule,[r for r in records if r['status']!='unstarted'])
    report['lineageFamilies']=sorted({job['sourceFamily'] for job in schedule})
    paths.append(write_json(directory/f"prospective-report-{execution['generation']}.json",report))
    return emit_result(directory,'evaluation',execution,receipts,paths,{'candidateSha256':plan['candidateSha256'],
        'unfinishedIsDraw':False,'prospective':True,'reportSha256':digest(paths[-1].read_bytes()),
        'inferenceRuntime':{role:model.runtime for role,model in models.items()},'browserWasmQualified':False})


def refreshed_policy(position,answer,profile):
    """Policy-only replacement for fresh, eligible self-play examples."""
    identity=answer.get('searchIdentity',{})
    if (position.get('targetOrigin')!='fresh-self-play' or position.get('partition')!='train'
            or position.get('policyMask') is not True or len(position.get('legal',[]))<2
            or answer.get('status')!='ready' or answer.get('stopped')!='complete' or answer.get('fallback') is not None
            or answer.get('policyMask') is not True or answer.get('legality',{}).get('complete') is not True
            or answer['legality'].get('indices')!=position['legal'] or answer.get('simulations',0)<profile['simulations']
            or identity.get('requestedProfile')!=profile or identity.get('stateHash')!=position.get('stateHash')
            or identity.get('controller')!=position.get('controller') or identity.get('valuePerspective')!='P1'):
        raise ValueError('completed eligible offline policy search required')
    policy=answer.get('policy',[]);indices=[p['index'] for p in policy]
    if (not policy or len(set(indices))!=len(indices) or any(i not in position['legal'] for i in indices)
            or any(not isinstance(p.get('probability'),(int,float)) or not math.isfinite(p['probability']) or p['probability']<0 for p in policy)
            or abs(sum(p['probability'] for p in policy)-1)>1e-5):raise ValueError('invalid searched policy target')
    result=copy.deepcopy(position)
    result['originalPolicy']=copy.deepcopy(position['policy'])
    result['policy']=copy.deepcopy(policy)
    result['teacherEstimatedValue']=answer.get('value')
    result['teacherEvidence']={'requestedProfile':profile,'completedSimulations':answer['simulations'],
        'nodes':answer.get('nodes'),'engineBudget':answer.get('engineBudget'),'stopped':answer['stopped']}
    return result


def verify_screen_answer(row,answer,profile):
    identity=answer.get('searchIdentity',{})
    if (answer.get('status')!='ready' or answer.get('stopped')!='complete' or answer.get('simulations',0)<profile['simulations']
            or identity.get('stateHash')!=row.get('stateHash') or identity.get('controller')!=row.get('controller')
            or identity.get('requestedProfile')!=profile or identity.get('valuePerspective')!='P1'
            or answer.get('legality',{}).get('complete') is not True or answer['legality'].get('indices')!=row.get('legal')):
        raise ValueError('teacher screen lacks completed bound root/search work')


def apply_policy_refresh(positions,binding,*,require_all=False,annotate=False):
    """Keep sampling order and all observed labels, replacing only named policy."""
    replacements=json.loads(read_bound(binding))
    by_id={row['id']:row for row in replacements}
    if len(by_id)!=len(replacements):raise ValueError('duplicate policy refresh identity')
    output=[];matched=set()
    for position in positions:
        replacement=by_id.get(position['id'])
        if replacement is None:output.append(position);continue
        matched.add(position['id'])
        if (replacement.get('originalPolicy')!=position['policy']
                or replacement.get('policyMask')!=position.get('policyMask',True)
                or replacement.get('terminalMask')!=position['terminalMask']
                or replacement.get('terminalValue')!=position['terminalValue']
                or replacement.get('legal')!=position['legal']
                or list(replacement.get('encoded',[]))!=list(position['encoded'])
                or replacement.get('gameId')!=position.get('gameId')):
            raise ValueError('policy refresh changes source, observed label or mask')
        output.append({**position,'policy':copy.deepcopy(replacement['policy']),**({'_policyRefreshId':position['id']} if annotate else {})})
    if require_all and (not by_id or matched!=set(by_id)):raise ValueError('scheduled policy replacements absent from shared starting replay')
    return output


def recovered_adoption(recovered_state,live_state):
    retained=recovered_state.get('policyRefreshAdoption')
    if retained!=live_state.get('policyRefreshAdoption'):
        raise ValueError('recovered policy adoption differs from executed minibatches')
    return retained


def qualify_refresh_start(state,positions,binding,input_checkpoint_sha256,*,resume=False):
    replacements=json.loads(read_bound(binding))
    expected={'inputCheckpointSha256':input_checkpoint_sha256,'bindingSha256':binding['sha256'],
              'ids':[row['id'] for row in replacements]}
    if resume:
        if state.get('policyRefreshInputQualified')!=expected:raise ValueError('recovery lacks original shared-replay policy qualification')
    else:
        apply_policy_refresh(positions,binding,require_all=True)
        state['policyRefreshInputQualified']=expected
    return expected


def teacher(plan,directory,execution,work_ids,*,seconds):
    validate_adapter_stage(execution,'teacher',plan)
    started=time.monotonic();deadline=started+seconds
    from . import hosted_receipts
    from .search_parity import search_reference
    from .model import model_from_record
    from .checkpoint import load_checkpoint
    from .device import selected_device
    mode=plan.get('mode','refresh')
    inventories={}
    if mode=='refresh':
        from .policy_pool import prepare_pool
        from .execution_recipe import verify_runtime
        recipe=verify_runtime()
        if not recipe or not recipe['settings'].get('attentionMethod'):raise ValueError('policy pool requires audited incumbent execution recipe')
        rows,inventories=prepare_pool(plan.get('pool'),execution,work_ids,
            guard_sha256=recipe['settings']['attentionMethod']['guardsSha256'],deadline=deadline)
    else:rows=json.loads(read_bound(plan['rows']))
    if plan.get('kind')!='policy-only-teacher-refresh' or [r.get('workId',r['id']) for r in rows]!=work_ids:
        raise ValueError('frozen teacher work inventory mismatch')
    if mode not in ('screen','refresh') or any(row.get('partition') not in ('train','validation') for row in rows):
        raise ValueError('final or unknown rows cannot enter teacher search')
    if mode=='refresh' and any(row.get('partition')!='train' or row.get('targetOrigin')!='fresh-self-play' or row.get('policyMask') is not True or len(row.get('legal',[]))<2 for row in rows):
        raise ValueError('only eligible fresh training policies may be refreshed')
    path=resolve_reference(plan['teacher']['path'],expected_sha256=plan['teacher']['sha256'])
    meta=json.loads(resolve_reference(path.with_suffix('.json')).read_bytes());model=model_from_record(meta)
    load_checkpoint(path,model,manifest_sha256=meta['manifestSha256'])
    device=selected_device();model=model.to(device).eval()
    refreshed=[];receipts=[];paths=[]
    for game_sha,proof in inventories.items():paths.append(write_json(Path(directory)/'source-inventories'/(game_sha+'.json'),proof))
    for row in rows:
        work_identity=row.get('workId',row['id'])
        raw={'id':row['id'],'teacherSha256':plan['teacher']['sha256'],'sourceRevision':execution['sourceRevision'],'requestedProfile':plan['profile'],'mode':mode}
        namespace='policy-refresh:'+execution['manifestSha256']+':'+execution['phase']
        claim=hosted_receipts.evaluation_claim(namespace,work_identity,create=deadline-time.monotonic()>=2)
        if claim.get('unclaimed'):raw.update(status='unstarted',reason='original-budget')
        elif not claim['created']:
            retained=claim.get('result')
            if retained is None:raw.update(status='unfinished',reason='consumed-without-settlement')
            else:
                if (retained.get('id')!=row['id'] or retained.get('teacherSha256')!=plan['teacher']['sha256']
                        or retained.get('requestedProfile')!=plan['profile'] or retained.get('mode')!=mode
                        or retained.get('sourceRevision')!=execution['sourceRevision']):
                    raise ValueError('teacher recovery identity mismatch')
                raw=retained
                if raw['status']=='complete':
                    if mode=='refresh':refreshed.append(refreshed_policy(row,raw['answer'],plan['profile']))
                    else:verify_screen_answer(row,raw['answer'],plan['profile'])
            path=write_json(Path(directory)/'attempts'/str(execution['generation'])/(hashlib.sha256(row['id'].encode()).hexdigest()+'.json'),raw);paths.append(path)
            receipts.append({'workId':work_identity,'status':raw['status'],'evidenceSha256':digest(path.read_bytes())})
            continue
        else:
            try:
                answer=search_reference(row['state'],model,device,row['seed'],plan['profile'],bound_seconds=min(plan['searchSeconds'],deadline-time.monotonic()))
                raw['answer']=answer
                if mode=='refresh':refreshed.append(refreshed_policy(row,answer,plan['profile']))
                else:verify_screen_answer(row,answer,plan['profile'])
                raw['status']='complete'
            except (TimeoutError,ValueError) as error:raw.update(status='unfinished',reason=str(error))
            hosted_receipts.settle(namespace,work_identity,raw)
        path=write_json(Path(directory)/'attempts'/str(execution['generation'])/(hashlib.sha256(row['id'].encode()).hexdigest()+'.json'),raw);paths.append(path)
        receipts.append({'workId':work_identity,'status':raw['status'],**({'evidenceSha256':digest(path.read_bytes())} if raw['status']!='unstarted' else {})})
    paths.append(write_json(Path(directory)/f"refreshed-policy-{execution['generation']}.json",refreshed))
    refresh_sha=digest(paths[-1].read_bytes()) if mode=='refresh' else None
    changed=any(row['policy']!=row['originalPolicy'] for row in refreshed)
    return emit_result(directory,'teacher',execution,receipts,paths,{'policyOnly':True,'observedValuesUnchanged':True,
        'originalMasksUnchanged':True,'actualSearchEvidence':True,'publicSearchBudgetsUnchanged':True,
        'mode':mode,'policyRefreshSha256':refresh_sha},result_fields={'policyRefreshSha256':refresh_sha,
        'policyTargetsChanged':changed,'interventionReady':mode=='refresh' and changed and all(r['status']=='complete' for r in receipts)})


def training(plan,directory,execution,work_ids,*,seconds,resume=False):
    """Run the audited ordinary attention method under a new fixed allocation."""
    validate_adapter_stage(execution,'training',plan)
    started=time.monotonic()
    from .runner import Runner
    from .checkpoint import atomic_json,load_checkpoint,weights_sha256,inspect_checkpoint
    from .export import export_onnx,numeric_parity
    from .model import model_from_record
    import numpy as np
    import torch
    if (plan.get('kind')!='attention-ordinary-training-stage' or len(work_ids)!=1
            or plan.get('sourceRevision')!=execution['sourceRevision'] or plan.get('seed')!=execution['seed']
            or not isinstance(plan.get('deadlineWall'),(int,float)) or plan['deadlineWall']<=time.time()):
        raise ValueError('fixed attention training allocation required')
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    native=plan['nativeManifest']
    if (native.get('sourceRevision')!=execution['sourceRevision'] or native.get('seed')!=plan['seed']
            or native.get('stage')!=plan['stage'] or native.get('warmStart',{}).get('sha256')!=plan['checkpoint']['sha256']):
        raise ValueError('native source, seed, stage or warm start differs from hosted execution')
    from .resource_policy import LIMITS
    workers=plan.get('workers')
    if type(workers)is not int or not 1<=workers<=LIMITS['maxWorkers']:raise ValueError('explicit bounded native worker allocation required')
    native_sha=hashlib.sha256(json.dumps(native,sort_keys=True,allow_nan=False).encode()).hexdigest()
    write_json(directory/'manifest.json',{'sha256':native_sha,'manifest':native})
    atomic_json(directory/'allocation.json',{'workers':workers,'paused':False,'stop':False})
    now=time.monotonic();remaining=min(seconds-(now-started),plan['deadlineWall']-time.time())
    if remaining<=20:raise ValueError('no training runway')
    # Wall expiry is immutable across hosts. Only the local monotonic anchor is
    # reconstructed. The external worker/controller enforce the same envelope.
    atomic_json(directory/'runtime.json',{'schema':2,'seed':plan['seed'],'stage':plan['stage'],
        'manifestSha256':native_sha,'command':'training','startedMonotonic':now,'deadlineMonotonic':now+remaining,
        'deadlineWall':plan['deadlineWall'],'reserveSeconds':min(60,remaining/6)})
    checkpoint=plan['checkpoint']
    original=resolve_reference(checkpoint['path'],expected_sha256=checkpoint['sha256'])
    original_meta=json.loads(resolve_reference(original.with_suffix('.json')).read_bytes())
    initial=inspect_checkpoint(original,manifest_sha256=original_meta['manifestSha256'],require_recovery=True)
    if checkpoint['sha256']!=execution['inputCheckpointSha256']:raise ValueError('training input incumbent differs')
    if resume:
        latest=json.loads((directory/'latest.json').read_bytes());checkpoint={'path':latest['checkpoint'],'sha256':latest['sha256']}
    checkpoint_path=resolve_reference(checkpoint['path'],expected_sha256=checkpoint['sha256'])
    runner=Runner(directory,plan['seed'],plan['stage'],resume=str(checkpoint_path))
    from .execution_recipe import verify_runtime
    execution_recipe=verify_runtime()
    refresh=execution_recipe['settings'].get('policyRefresh')
    if execution['scientific']['arm']=='treatment' and not refresh:raise ValueError('policy treatment has no frozen replacement input')
    if refresh:qualify_refresh_start(runner.state,list(runner.buffer.positions),refresh,execution['inputCheckpointSha256'],resume=resume)
    before=initial['model']
    initial_updates=initial['updates']
    runner.run()
    latest=json.loads((directory/'latest.json').read_bytes())
    saved=resolve_reference(latest['checkpoint'],expected_sha256=latest['sha256'])
    restored=model_from_record(native).to(runner.device)
    restored_optimizer=torch.optim.AdamW(restored.parameters())
    recovered=load_checkpoint(saved,restored,restored_optimizer,manifest_sha256=native_sha,require_recovery=True)
    if weights_sha256(restored.state_dict())!=weights_sha256(runner.model.state_dict()):raise ValueError('recovered model differs')
    # Exercise full replay reconstruction and original supplemental insertion age.
    from .attention_method import reconstruct_replay
    from .replay import ReplayBuffer
    buffer=ReplayBuffer(protected_encoding_hashes=runner.buffer.protected_encoding_hashes,
        protected_family_ids=runner.buffer.protected_family_ids)
    reconstruct_replay(buffer,recovered,runner.attention_method,base=saved.parent.parent)
    if recovered['replayIds']!=runner.state['archives'] or recovered['updates']!=runner.state['updates']:
        raise ValueError('recovered cursor differs')
    delta=sum(float((value.detach().cpu()-before[key]).abs().sum()) for key,value in runner.model.state_dict().items())
    updates=runner.state['updates']-initial_updates
    if updates<=0 or not math.isfinite(delta) or delta<=0:raise ValueError('training stage has no actual new update')
    adoption=recovered_adoption(recovered['recovery']['state'],runner.state)
    if recovered['recovery']['state'].get('policyRefreshInputQualified')!=runner.state.get('policyRefreshInputQualified'):
        raise ValueError('recovered policy source qualification differs')
    if refresh:
        replacements=json.loads(read_bound(refresh));expected={row['id'] for row in replacements}
        if (not adoption or adoption.get('bindingSha256')!=refresh['sha256'] or set(adoption.get('ids',[]))!=expected
                or adoption.get('positions',0)<=0):raise ValueError('treatment has zero or missing scheduled policy adoption')
        adoption={**adoption,'complete':True,'missing':[]}
    model_path=directory/'model.onnx';export_onnx(restored,model_path)
    positions=list(buffer.positions)[:32]
    if not positions:raise ValueError('numeric parity needs actual recovered replay states')
    states=np.asarray([p['encoded'] for p in positions],dtype=np.float32).reshape(-1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
    parity=numeric_parity(restored,model_path,states,reference_device=str(runner.device))
    model_record=artifact(model_path,'model');cp_record=artifact(saved,'checkpoint')
    report_path=directory/'runner-result.json'
    report=json.loads(report_path.read_bytes())
    if report.get('status')!='stopped' or report.get('reason') not in ('budget-or-resource-stop','insufficient-generation-runway'):
        raise ValueError('training did not reach its fixed allocation endpoint')
    receipts=[{'workId':work_ids[0],'status':'complete','evidenceSha256':digest(report_path.read_bytes())}]
    endpoint={'calibrationEndpoint':{'rule':'latest-durable-at-fixed-allocation-end','deadlineWall':plan['deadlineWall'],
        'planSha256':execution['planSha256'],'checkpointSha256':cp_record['sha256'],
        'runnerResultSha256':digest(report_path.read_bytes())}} if execution['scientific']['stage']=='calibration' else {}
    return emit_result(directory,'training',execution,receipts,[report_path],
        {'checkpointSha256':cp_record['sha256'],'modelSha256':model_record['sha256'],
         'recoveryPassed':True,'numericParityPassed':parity['numericPassed'],**({'policyRefreshAdoption':adoption,
         'policyRefreshInputQualified':recovered['recovery']['state']['policyRefreshInputQualified']} if adoption else {}),**endpoint},
        additional_artifacts=[model_record,cp_record],result_fields={'updates':updates,'parameterDelta':delta})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['evaluation','teacher','training'])
    parser.add_argument('--plan',required=True);parser.add_argument('--run-dir',required=True)
    parser.add_argument('--seconds',type=float,required=True)
    parser.add_argument('--resume',action='store_true')
    args=parser.parse_args()
    if not 0<args.seconds<=86400:raise ValueError('bounded stage runtime required')
    execution,ids=frozen_context();raw=resolve_reference(args.plan).read_bytes()
    if digest(raw)!=execution.get('planSha256'):raise ValueError('scientific plan differs from execution binding')
    plan=json.loads(raw)
    function={'evaluation':evaluate,'teacher':teacher,'training':training}[args.command]
    function(plan,args.run_dir,execution,ids,seconds=args.seconds,**({'resume':args.resume} if args.command=='training' else {}))


if __name__=='__main__':main()
