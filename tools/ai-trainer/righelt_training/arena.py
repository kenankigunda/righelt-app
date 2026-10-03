"""Paired model evaluation. Completed games only; no old search opponent."""
import argparse
import hashlib
import json
import gzip
import os
import signal
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


def freeze_plan(path,plan):
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
        if partition_for_family(f"normal:{pair['seed']}")!=plan['partition']:
            raise ValueError('evaluation family belongs to another partition')
        kinds[pair['kind']]+=1
        if pair['kind']=='heldout':
            if not pair.get('initialState') or not pair.get('openingActions'):raise ValueError('held-out opening trajectory missing')
            proof=engine_command({'command':'validate-opening','state':pair['initialState'],'actions':pair['openingActions']},timeout=10)
            if proof['initial'] or proof['fingerprint'] in openings:raise ValueError('opening is initial or duplicated')
            openings.add(proof['fingerprint'])
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
    path=Path(path)
    with path.open('x') as f:json.dump({'sha256':digest,'plan':plan},f,sort_keys=True,allow_nan=False)
    return digest


def open_plan(path):
    path=Path(path);data=json.loads(path.read_text());plan=data['plan']
    digest=hashlib.sha256(json.dumps(plan,sort_keys=True,allow_nan=False).encode()).hexdigest()
    if digest!=data['sha256']:raise ValueError('frozen evaluation plan was altered')
    if plan['partition']=='final':
        # A crash or an incomplete budget still consumes this sealed partition.
        # Retests require a documented harness defect handled outside this command.
        with path.with_suffix(path.suffix+'.opened').open('x') as f:f.write(digest+'\n')
    return plan,digest


def play_game(job,models,deadline,device,*,allocation=lambda:{'paused':False,'workers':1},checkpoint=lambda:None):
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
                        x=torch.tensor(message['input'],dtype=torch.float32,device=device).reshape(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
                        with torch.inference_mode():policy,value=model(x)
                        if not torch.isfinite(policy).all() or not torch.isfinite(value).all():raise ValueError('nonfinite arena inference')
                        response={'type':'evaluation','id':message['id'],'policyLogits':policy[0].cpu().tolist(),'value':value[0].item()}
                        process.stdin.write((json.dumps(response,allow_nan=False)+'\n').encode());process.stdin.flush()
                    elif message['type']=='game':
                        checkpoint()
                        # Keep blocking replay below the supervisor's telemetry age bound.
                        try:verify_game(message['game'],min(game_deadline,time.monotonic()+20))
                        except (TimeoutError,subprocess.TimeoutExpired):return {'status':'unfinished','reason':'verification-budget'}
                        return {'status':'completed','game':message['game']}
                    elif message['type']=='unfinished':return {'status':'unfinished','reason':'budget'}
                    else:raise RuntimeError(f'arena protocol error: {message}')
        return {'status':'unfinished','reason':'budget'}
    finally:selector.close();stop_worker(process)


def read_frozen_plan(path):
    data=json.loads(Path(path).read_text())
    digest=hashlib.sha256(json.dumps(data['plan'],sort_keys=True,allow_nan=False).encode()).hexdigest()
    if digest!=data['sha256'] or data['plan']['configSha256']!=CONFIG_SHA256:raise ValueError('frozen plan mismatch')
    if len(data['plan']['pairs'])!=100 or data['plan']['partition'] not in ('validation','final'):
        raise ValueError('invalid frozen workload')
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
    return {'id':f"{digest}:{pair['id']}:{candidate_seat}",'familyId':f"normal:{pair['seed']}",
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


def run_arena(plan_path,run_directory,models,device,*,clock=time.monotonic,player=play_game):
    directory=Path(run_directory)
    runtime=json.loads((directory/'runtime.json').read_text())
    deadline=runtime['deadlineMonotonic']
    plan,digest=read_frozen_plan(plan_path)
    identity={'planSha256':digest,'manifestSha256':runtime['manifestSha256'],
              'startedMonotonic':runtime['startedMonotonic'],'deadlineMonotonic':deadline}
    output=directory/'evaluations'/digest;output.mkdir(parents=True,exist_ok=True)
    state_path=output/'state.json'
    # Final partitions are one-shot, even if the earlier attempt was interrupted.
    if plan['partition']=='final':open_plan(plan_path)
    if state_path.exists():
        state=json.loads(state_path.read_text())
        if state['identity']!=identity:raise ValueError('evaluation resume identity or original deadline changed')
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
    def persist():atomic_json(state_path,state)
    def allocation():return json.loads((directory/'allocation.json').read_text())
    def heartbeat():
        amount=torch.mps.driver_allocated_memory() if str(device)=='mps' else 0
        atomic_json(directory/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':amount})
    heartbeat();persist();reason='complete'
    for pair in plan['pairs']:
        for seat in ('P1','P2'):
            job=expected[(pair['id'],seat)]
            if job['id'] in state['records']:continue
            assigned=allocation()
            if deadline-clock()<40:reason='budget';break
            if assigned.get('stop') or assigned['paused']:reason='resource-pause';break
            by_seat={seat:models['candidate'],('P2' if seat=='P1' else 'P1'):models['opponent']}
            attempt={'pairId':pair['id'],'candidateSeat':seat,'startedMonotonic':clock(),'status':'running'}
            state['attempts'].append(attempt);persist()
            orphan=output/'games'/(hashlib.sha256(job['id'].encode()).hexdigest()+'.json.gz')
            if orphan.exists():
                game=json.loads(gzip.decompress(orphan.read_bytes()))
                heartbeat()
                try:verify_game(game,min(deadline-10,clock()+20))
                except (TimeoutError,subprocess.TimeoutExpired):result={'status':'unfinished','reason':'verification-budget'}
                else:result={'status':'completed','game':game}
            else:result=player(job,by_seat,deadline,device,allocation=allocation,checkpoint=heartbeat)
            attempt.update(status=result['status'],finishedMonotonic=clock(),reason=result.get('reason'))
            if result['status']!='completed':reason=result.get('reason','unfinished');persist();break
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
        if runtime['deadlineMonotonic']-time.monotonic()<40:raise ValueError('original evaluation budget expired')
        plan,digest=read_frozen_plan(args.plan)
        if runtime.get('arenaPlanSha256')!=digest:raise ValueError('supervisor plan identity mismatch')
        if not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable for arena')
        signal.signal(signal.SIGUSR1,lambda *_:None)
        device=torch.device('mps');torch.set_num_threads(2)
        models=load_frozen_models(plan,{'candidate':args.candidate_checkpoint,'opponent':args.opponent_checkpoint},device)
        result=run_arena(args.plan,args.run_dir,models,device)
        print(json.dumps({k:v for k,v in result.items() if k!='pairs'},indent=2))

if __name__=='__main__':main()
