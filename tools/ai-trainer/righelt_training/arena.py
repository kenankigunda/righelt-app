"""Paired model evaluation. Completed games only; no old search opponent."""
from .budget import effective_deadline
from .runner_monitor import RunnerMonitor
from contextlib import nullcontext
import argparse
import hashlib
import json
import gzip
import os
import signal
import fcntl
from pathlib import Path
import selectors
import subprocess
import time
import torch
from .config import CONFIG,ROOT,CONFIG_SHA256
from .checkpoint import atomic_json,load_checkpoint
from .evaluation import paired_report
from .model import PolicyValueNet
from .runner import stop_worker,verify_game,engine_command
from .replay import partition_for_family
from .curriculum import family_for_root


def partition_identities(plan):
    identities=set()
    for pair in plan['pairs']:
        family=f"normal:{pair['seed']}" if pair['kind']=='normal' else family_for_root(pair['initialState'])
        if pair.get('familyId')!=family or partition_for_family(family)!=plan['partition']:
            raise ValueError('opening family partition mismatch')
        identities.add('family:'+family)
        if pair['kind']=='heldout':
            if not pair.get('openingFingerprint'):raise ValueError('missing frozen opening fingerprint')
            identities.add('opening:'+pair['openingFingerprint'])
    return identities


def register_partition(plan,digest,*,consume=False,experiment_root=None):
    # One shared locked ledger, independent of plan path, profile, and model.
    root=Path(experiment_root) if experiment_root is not None else ROOT/'.ai-runs'
    root.mkdir(parents=True,exist_ok=True)
    path=root/'evaluation-partitions.json'
    with (root/'evaluation-partitions.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        ledger=json.loads(path.read_text()) if path.exists() else {'schema':1,'identities':{}}
        keys=partition_identities(plan)
        for key in keys:
            prior=ledger['identities'].get(key)
            if prior and prior['partition']!=plan['partition']:raise ValueError('opening reused across partitions')
            if consume and prior and prior.get('consumedBy'):raise FileExistsError('final family/opening already consumed')
        for key in keys:
            record=ledger['identities'].setdefault(key,{'partition':plan['partition']})
            if consume:record['consumedBy']=digest
        atomic_json(path,ledger)


def freeze_plan(path,plan,*,experiment_root=None,deadline=None,heartbeat=lambda:None):
    if plan.get('partition') not in ('validation','final') or plan.get('configSha256')!=CONFIG_SHA256:
        raise ValueError('invalid evaluation partition/configuration')
    if plan.get('purpose') not in ('difficulty','incumbent'):raise ValueError('invalid comparison purpose')
    if len(plan.get('pairs',[]))!=100:raise ValueError('requires 100 seat-swapped pairs')
    ids=set();seeds=set();openings=set();kinds={'normal':0,'heldout':0}
    for pair in plan['pairs']:
        if not isinstance(pair.get('id'),str) or type(pair.get('seed')) is not int or not 0<=pair['seed']<2**32:
            raise ValueError('invalid pair identity')
        if pair['id'] in ids or pair['seed'] in seeds:raise ValueError('duplicate evaluation pair or seed')
        ids.add(pair['id']);seeds.add(pair['seed'])
        if pair['kind'] not in kinds:raise ValueError('invalid start kind')
        family=f"normal:{pair['seed']}" if pair['kind']=='normal' else family_for_root(pair['initialState'])
        if partition_for_family(family)!=plan['partition']:
            raise ValueError('evaluation family belongs to another partition')
        pair['familyId']=family
        kinds[pair['kind']]+=1
        if pair['kind']=='heldout':
            if not pair.get('initialState') or not pair.get('openingActions'):raise ValueError('held-out opening trajectory missing')
            heartbeat()
            remaining=10 if deadline is None else min(10,deadline-time.monotonic()-5)
            if remaining<=0:raise TimeoutError('opening verification budget expired')
            proof=engine_command({'command':'validate-opening','state':pair['initialState'],'actions':pair['openingActions'],'budgetMs':remaining*1000},timeout=remaining)
            if pair.get('openingFingerprint',proof['fingerprint'])!=proof['fingerprint']:
                raise ValueError('opening fingerprint changed during preparation')
            if proof['initial'] or proof['fingerprint'] in openings:raise ValueError('opening is initial or duplicated')
            openings.add(proof['fingerprint'])
            pair['openingFingerprint']=proof['fingerprint']
    if kinds!={'normal':50,'heldout':50}:raise ValueError('incorrect opening mix')
    for who in ('candidate','opponent'):
        entry=plan[who]
        digest=entry.get('checkpointSha256','')
        if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest) or not entry.get('profileVersion') or not entry.get('profile'):
            raise ValueError('candidate and profiles must be frozen')
        profile=entry['profile']
        if (set(profile)!={'simulations','temperature','maxValueGap'} or type(profile['simulations']) is not int
            or not 1<=profile['simulations']<=CONFIG['search']['maxNodes']
            or not 0<=profile['temperature']<=1 or not 0<=profile['maxValueGap']<=2):
            raise ValueError('invalid frozen profile')
    digest=hashlib.sha256(json.dumps(plan,sort_keys=True,allow_nan=False).encode()).hexdigest()
    register_partition(plan,digest,experiment_root=experiment_root)
    path=Path(path)
    with path.open('x') as f:json.dump({'sha256':digest,'plan':plan},f,sort_keys=True,allow_nan=False)
    return digest


def open_plan(path,*,experiment_root=None):
    plan,digest=read_frozen_plan(path)
    if plan['partition']=='final':
        register_partition(plan,digest,consume=True,experiment_root=experiment_root)
    return plan,digest


def infer(model,encoded,device,monitor=None):
    # Include device transfers and synchronization inside the same hard bound.
    with monitor.operation('arena-inference',30) if monitor else nullcontext():
        x=torch.tensor(encoded,dtype=torch.float32,device=device).reshape(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
        with torch.inference_mode():policy,value=model(x)
        if not torch.isfinite(policy).all() or not torch.isfinite(value).all():raise ValueError('nonfinite arena inference')
        return policy[0].cpu().tolist(),value[0].item()


def play_game(job,models,deadline,device,*,allocation=lambda:{'paused':False,'workers':1},checkpoint=lambda:None,monitor=None):
    remaining=deadline-time.monotonic()
    if remaining<20:return {'status':'unfinished','reason':'budget'}
    game_deadline=min(deadline-10,time.monotonic()+600)
    job={**job,'command':'arena','budgetMs':max(1,(game_deadline-time.monotonic())*1000)}
    process=subprocess.Popen(['node','--import','tsx',str(ROOT/'tools/ai-trainer/engine-worker.mjs')],cwd=ROOT,
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
    buffered=b''
    try:
        process.stdin.write((json.dumps(job)+'\n').encode());process.stdin.flush()
        while time.monotonic()<game_deadline:
            assigned=allocation()
            if assigned.get('stop') or assigned['paused'] or assigned.get('workers',1)<1:return {'status':'unfinished','reason':'resource-pause'}
            checkpoint()
            for key,_ in selector.select(timeout=.25):
                chunk=__import__('os').read(key.fd,65536)
                if not chunk:raise RuntimeError('arena engine ended without result')
                buffered+=chunk
                while b'\n' in buffered:
                    raw,buffered=buffered.split(b'\n',1);message=json.loads(raw)
                    if message['type']=='evaluate':
                        if game_deadline-time.monotonic()<30:return {'status':'unfinished','reason':'inference-budget'}
                        if message.get('modelSeat') not in models:raise ValueError('invalid model seat')
                        model=models[message['modelSeat']]
                        policy,value=infer(model,message['input'],device,monitor)
                        response={'type':'evaluation','id':message['id'],'policyLogits':policy,'value':value}
                        process.stdin.write((json.dumps(response,allow_nan=False)+'\n').encode());process.stdin.flush()
                    elif message['type']=='game':
                        checkpoint()
                        # Keep blocking replay below the supervisor's telemetry age bound.
                        try:verify_game(message['game'],min(game_deadline,time.monotonic()+20))
                        except (TimeoutError,subprocess.TimeoutExpired):return {'status':'unfinished','reason':'verification-budget'}
                        return {'status':'completed','game':message['game']}
                    elif message['type']=='unfinished':
                        return {'status':'unfinished','reason':message.get('reason','engine-unfinished'),
                                'retryClass':'engine','protocol':message,'job':job}
                    else:raise RuntimeError(f'arena protocol error: {message}')
        return {'status':'unfinished','reason':'budget'}
    finally:selector.close();stop_worker(process)


def read_frozen_plan(path):
    data=json.loads(Path(path).read_text())
    digest=hashlib.sha256(json.dumps(data['plan'],sort_keys=True,allow_nan=False).encode()).hexdigest()
    if digest!=data['sha256'] or data['plan']['configSha256']!=CONFIG_SHA256:raise ValueError('frozen plan mismatch')
    if len(data['plan']['pairs'])!=100 or data['plan']['partition'] not in ('validation','final'):
        raise ValueError('invalid frozen workload')
    partition_identities(data['plan'])
    return data['plan'],digest


def load_frozen_models(plan,paths,device):
    models={}
    for who in ('candidate','opponent'):
        path=Path(paths[who]);digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest!=plan[who]['checkpointSha256']:raise ValueError('checkpoint differs from frozen candidate')
        metadata=json.loads(path.with_suffix('.json').read_text())
        model=PolicyValueNet().to(device)
        load_checkpoint(path,model,manifest_sha256=metadata['manifestSha256'])
        model.eval();models[who]=model
    return models


def make_job(plan,pair,candidate_seat,digest):
    seats={candidate_seat:'candidate',('P2' if candidate_seat=='P1' else 'P1'):'opponent'}
    return {'id':f"{digest}:{pair['id']}:{candidate_seat}",'familyId':pair['familyId'],
            'seed':pair['seed'],'partition':plan['partition'],'kind':'normal' if pair['kind']=='normal' else 'simple',
            'initialState':None if pair['kind']=='normal' else pair['initialState'],
            'modelVersion':digest,'profiles':{seat:plan[who]['profile'] for seat,who in seats.items()},
            'modelVersions':{seat:plan[who]['checkpointSha256'] for seat,who in seats.items()},
            'profileVersions':{seat:plan[who]['profileVersion'] for seat,who in seats.items()}}


def archive_game(directory,game):
    path=Path(directory)/(hashlib.sha256(game['id'].encode()).hexdigest()+'.json.gz')
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=gzip.compress(json.dumps(game,sort_keys=True,allow_nan=False).encode(),mtime=0)
    if path.exists():
        if path.read_bytes()!=raw:raise ValueError('conflicting immutable game archive')
        return path,hashlib.sha256(raw).hexdigest()
    with path.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    return path,hashlib.sha256(raw).hexdigest()


def preserve_diagnostic(output,job,result,attempt_number):
    payload={'schema':1,'job':job,'result':result}
    raw=json.dumps(payload,sort_keys=True,allow_nan=False).encode()
    digest=hashlib.sha256(raw).hexdigest()
    path=output/'diagnostics'/f'{attempt_number:06d}-{digest}.json'
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    return {'path':str(path.relative_to(output)),'sha256':digest}


def retry_qualification(directory,runtime,digest,job,prior):
    """Only an explicitly reviewed repair for this failed job permits a rerun."""
    if prior.get('retryClass')=='transient':return True
    if not prior.get('retryClass') and prior.get('reason') in ('resource-pause','inference-budget','verification-budget'):return True
    if prior.get('status')!='unfinished':return True
    from .allocation import rows
    reason=prior.get('reason') if prior.get('diagnostic') else 'legacy-missing-diagnostics'
    required={'planSha256':digest,'jobId':job['id'],'priorSourceManifest':prior.get('sourceManifest'),
              'diagnosticSha256':prior.get('diagnostic',{}).get('sha256'),'reason':reason}
    for amendment in rows(Path(directory)/'source-amendments.jsonl'):
        if (amendment.get('newManifest')==runtime['manifestSha256']
            and amendment.get('newManifest')!=prior.get('sourceManifest')
            and all(amendment.get(key) for key in ('cause','regressionEvidence','artifactDisposition','reviewEvidence'))
            and amendment.get('arenaRecovery')==required):
            for field in ('reviewEvidence','regressionEvidence'):
                evidence=amendment[field]
                if not isinstance(evidence,list) or not evidence:raise ValueError('repair evidence must contain hashed artifacts')
                for item in evidence:
                    if hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()!=item['sha256']:
                        raise ValueError('repair evidence changed')
            return True
    return False


def run_arena(plan_path,run_directory,models,device,*,clock=time.monotonic,player=play_game,experiment_root=None,monitor=None):
    directory=Path(run_directory)
    runtime=json.loads((directory/'runtime.json').read_text())
    deadline=effective_deadline(runtime)
    plan,digest=read_frozen_plan(plan_path)
    identity={'planSha256':digest,'allocationId':runtime.get('allocationId',runtime['manifestSha256']),'configSha256':CONFIG_SHA256}
    output=directory/'evaluations'/digest;output.mkdir(parents=True,exist_ok=True)
    state_path=output/'state.json'
    if state_path.exists():
        state=json.loads(state_path.read_text())
        if state['identity']!=identity:raise ValueError('evaluation allocation or frozen plan changed')
    else:state={'schema':1,'identity':identity,'records':{},'attempts':[]}
    expected={(pair['id'],seat):make_job(plan,pair,seat,digest) for pair in plan['pairs'] for seat in ('P1','P2')}
    for key,record in state['records'].items():
        pair_id,seat=record['pairId'],record['candidateSeat']
        if (pair_id,seat) not in expected:raise ValueError('unknown resumed pair')
        path=output/record['archive']
        if not path.resolve().is_relative_to(output.resolve()):raise ValueError('invalid archive path')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=record['sha256']:raise ValueError('evaluation archive changed')
        game=json.loads(gzip.decompress(raw))
        job=expected[(pair_id,seat)]
        outcome='truncated' if game['termination']=='truncated' else game['outcome']['status']
        if game['id']!=job['id'] or outcome!=record['outcome'] or key!=job['id']:raise ValueError('evaluation record mismatch')
    for attempt in state['attempts']:
        if attempt.get('diagnostic'):
            artifact=attempt['diagnostic'];path=output/artifact['path']
            if not path.resolve().is_relative_to(output.resolve()):raise ValueError('invalid diagnostic path')
            if hashlib.sha256(path.read_bytes()).hexdigest()!=artifact['sha256']:
                raise ValueError('evaluation diagnostic changed')
    def persist():atomic_json(state_path,state)
    def allocation():return json.loads((directory/'allocation.json').read_text())
    def heartbeat():
        if monitor is not None:
            monitor.check();return
        amount=torch.mps.driver_allocated_memory() if str(device)=='mps' else 0
        atomic_json(directory/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':amount})
    heartbeat();persist();reason='complete'
    # The supervisor first pauses until this process publishes fresh GPU memory.
    # Do not expose/consume a sealed workload until it grants usable resources.
    while True:
        assigned=allocation();heartbeat()
        if deadline-clock()<40:reason='budget';break
        if assigned.get('stop'):reason='resource-stop';break
        if (not assigned.get('paused',True) and assigned.get('workers',0)>0
            and assigned.get('reason')!='initial-conservative'
            and 0<=time.time()-assigned.get('observedAt',0)<=30):break
        time.sleep(.1)
    if reason=='complete' and plan['partition']=='final':open_plan(plan_path,experiment_root=experiment_root)
    for pair in plan['pairs']:
        if reason!='complete':break
        for seat in ('P1','P2'):
            job=expected[(pair['id'],seat)]
            if job['id'] in state['records']:continue
            prior=next((a for a in reversed(state['attempts']) if a['pairId']==pair['id'] and a['candidateSeat']==seat and a['status']=='unfinished'),None)
            if prior and not retry_qualification(directory,runtime,digest,job,prior):
                reason='engine-recovery-review-required';break
            assigned=allocation()
            if deadline-clock()<40:reason='budget';break
            if assigned.get('stop') or assigned['paused']:reason='resource-pause';break
            by_seat={seat:models['candidate'],('P2' if seat=='P1' else 'P1'):models['opponent']}
            attempt={'pairId':pair['id'],'candidateSeat':seat,'startedMonotonic':clock(),'status':'running','sourceManifest':runtime['manifestSha256'],'interval':runtime.get('allocationInterval')}
            state['attempts'].append(attempt);persist()
            orphan=output/'games'/(hashlib.sha256(job['id'].encode()).hexdigest()+'.json.gz')
            if orphan.exists():
                game=json.loads(gzip.decompress(orphan.read_bytes()))
                heartbeat()
                try:verify_game(game,min(deadline-10,clock()+20))
                except (TimeoutError,subprocess.TimeoutExpired):result={'status':'unfinished','reason':'verification-budget'}
                else:result={'status':'completed','game':game}
            else:
                with monitor.operation('arena-game',min(610,deadline-clock())) if monitor else nullcontext():
                    result=player(job,by_seat,deadline,device,allocation=allocation,checkpoint=heartbeat,monitor=monitor)
            attempt.update(status=result['status'],finishedMonotonic=clock(),reason=result.get('reason'))
            if result['status']!='completed':
                reason=result.get('reason','unfinished')
                # Only host-controlled budget/resource pauses are resumable unchanged.
                attempt['retryClass']=result.get('retryClass','transient' if reason in
                    ('budget','resource-pause','inference-budget','verification-budget') else 'engine')
                attempt['diagnostic']=preserve_diagnostic(output,job,result,len(state['attempts']))
                persist();break
            game=result['game']
            if (game['id']!=job['id'] or game['seed']!=job['seed'] or game['partition']!=plan['partition']
                or game.get('modelVersions')!=job['modelVersions'] or game.get('profileVersions')!=job['profileVersions']):
                raise ValueError('arena game identity mismatch')
            for decision in game['decisions']:
                controller=decision['controller']
                if (decision.get('modelVersion')!=job['modelVersions'][controller]
                    or decision.get('profileVersion')!=job['profileVersions'][controller]):raise ValueError('decision model identity mismatch')
            path,sha=archive_game(output/'games',game)
            state['records'][job['id']]={'pairId':pair['id'],'candidateSeat':seat,
                'outcome':'truncated' if game['termination']=='truncated' else game['outcome']['status'],
                'archive':str(path.relative_to(output)),'sha256':sha}
            persist();heartbeat()
        if reason!='complete':break
    pairs=[]
    for pair in plan['pairs']:
        games=[state['records'][expected[(pair['id'],seat)]['id']] for seat in ('P1','P2') if expected[(pair['id'],seat)]['id'] in state['records']]
        if len(games)==2:pairs.append({'id':pair['id'],'kind':pair['kind'],'games':games})
    complete=len(pairs)==len(plan['pairs'])
    statistics=paired_report(pairs,plan.get('bootstrapSeed',107),threshold=.6 if plan['purpose']=='difficulty' else .55) if pairs and deadline-clock()>2 else None
    report={'schema':1,'identity':identity,'partition':plan['partition'],'purpose':plan['purpose'],
            'status':'completed' if complete else 'inconclusive','reason':reason,'completePairs':len(pairs),
            'completedGames':len(state['records']),'statistics':statistics,'pairs':pairs,'productionPromotion':False}
    atomic_json(output/'report.json',report);return report


def main():
    p=argparse.ArgumentParser(description='Freeze evaluation plans or summarize completed pair records; model matches run under the experiment supervisor.')
    sub=p.add_subparsers(dest='command',required=True)
    freeze=sub.add_parser('freeze');freeze.add_argument('input',type=Path);freeze.add_argument('output',type=Path)
    report=sub.add_parser('report');report.add_argument('input',type=Path);report.add_argument('output',type=Path);report.add_argument('--seed',type=int,required=True);report.add_argument('--purpose',choices=['difficulty','incumbent'],required=True)
    run=sub.add_parser('run');run.add_argument('--run-dir',type=Path,required=True);run.add_argument('--plan',type=Path,required=True)
    run.add_argument('--candidate-checkpoint',type=Path,required=True);run.add_argument('--opponent-checkpoint',type=Path,required=True)
    args=p.parse_args()
    if args.command=='freeze':print(freeze_plan(args.output,json.loads(args.input.read_text())))
    elif args.command=='report':
        result=paired_report(json.loads(args.input.read_text())['pairs'],args.seed,threshold=.6 if args.purpose=='difficulty' else .55)
        atomic_json(args.output,result);print(json.dumps(result,indent=2))
    else:
        runtime=json.loads((args.run_dir/'runtime.json').read_text())
        if runtime.get('supervisorPid')!=os.getppid() or runtime.get('command')!='arena' or os.getpgrp()!=os.getpid():
            raise ValueError('arena must run inside the original external supervisor')
        if effective_deadline(runtime)-time.monotonic()<40:raise ValueError('original evaluation budget expired')
        plan,digest=read_frozen_plan(args.plan)
        if runtime.get('arenaPlanSha256')!=digest:raise ValueError('supervisor plan identity mismatch')
        if not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable for arena')
        signal.signal(signal.SIGUSR1,lambda *_:None)
        device=torch.device('mps');torch.set_num_threads(2)
        with RunnerMonitor(args.run_dir) as monitor:
            with monitor.operation('arena-model-restoration',min(300,effective_deadline(runtime)-time.monotonic())):
                models=load_frozen_models(plan,{'candidate':args.candidate_checkpoint,'opponent':args.opponent_checkpoint},device)
            with monitor.operation('arena-evaluation',effective_deadline(runtime)-time.monotonic()):
                result=run_arena(args.plan,args.run_dir,models,device,monitor=monitor)
        print(json.dumps({k:v for k,v in result.items() if k!='pairs'},indent=2))

if __name__=='__main__':main()
