"""Disposable supervised pipeline canary. Never production training or health data."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import random
import selectors
import signal
import subprocess
import time
import uuid
import numpy as np
import torch
from .budget import effective_deadline
from .checkpoint import atomic_json,save_checkpoint,load_checkpoint
from .config import ROOT,CONFIG
from .curriculum import family_for_root
from .export import export_onnx,numeric_parity
from .manifest import active_manifest
from .model import PolicyValueNet
from .parity import verify_corpus
from .replay import partition_for_family,ReplayBuffer,save_game
from .runner import stop_worker,verify_game,default_state
from .runner_monitor import RunnerMonitor
from .trainer import make_optimizer,train_round


def canary_roots():
    # Generated U-shaped enclosure with one open supply exit; never reads puzzles.
    for row in range(2,7):
        for col in range(2,7):
            positions=[(row-1,col-1),(row-1,col),(row,col-1),(row+1,col-1),
                       (row+1,col),(row+1,col+1),(row+1,col+2),(row,col+2)]
            pieces=[{'id':'C1' if i==0 else f'canary-unit-{i}','owner':'P1','kind':'commander' if i==0 else 'unit',
                     'position':{'row':r,'col':c},'supplied':True,'commanded':True} for i,(r,c) in enumerate(positions)]
            pieces.append({'id':'C2','owner':'P2','kind':'commander','position':{'row':row,'col':col},'supplied':True,'commanded':True})
            state={'boardSize':10,'sideToMove':'P1','turnIndex':0,'pieces':pieces,'continuation':None,'outcome':{'status':'ongoing'}}
            family=family_for_root(state)
            if partition_for_family(family)=='train':yield state,family


def selfplay(job,model,device,deadline,monitor):
    remaining=min(60,deadline-time.monotonic()-10)
    if remaining<=0:raise TimeoutError('canary self-play budget')
    process=subprocess.Popen(['node','--import','tsx',str(ROOT/'tools/ai-trainer/engine-worker.mjs')],cwd=ROOT,
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);buffer=b''
    end=time.monotonic()+remaining
    try:
        process.stdin.write((json.dumps({**job,'budgetMs':remaining*1000})+'\n').encode());process.stdin.flush()
        with monitor.operation('canary-selfplay',remaining):
            while time.monotonic()<end:
                for key,_ in selector.select(timeout=.1):
                    chunk=os.read(key.fd,65536)
                    if not chunk:raise RuntimeError('canary engine ended without result')
                    buffer+=chunk
                    while b'\n' in buffer:
                        raw,buffer=buffer.split(b'\n',1);message=json.loads(raw)
                        if message['type']=='evaluate':
                            with monitor.operation('canary-inference',30):
                                x=torch.tensor(message['input'],dtype=torch.float32,device=device).reshape(1,46,10,10)
                                with torch.inference_mode():policy,value=model(x)
                                if not torch.isfinite(policy).all() or not torch.isfinite(value).all():raise ValueError('nonfinite canary inference')
                                reply={'type':'evaluation','id':message['id'],'policyLogits':policy[0].cpu().tolist(),'value':value[0].item()}
                                process.stdin.write((json.dumps(reply,allow_nan=False)+'\n').encode());process.stdin.flush()
                        elif message['type']=='game':return message['game']
                        elif message['type'] in ('unfinished','unavailable-start'):raise TimeoutError('canary self-play unfinished')
                        else:raise RuntimeError(f'canary engine error: {message}')
            raise TimeoutError('canary self-play deadline')
    finally:selector.close();stop_worker(process)


def train_and_recover(directory,model,positions,archives,manifest_hash,device,deadline,monitor):
    optimizer=make_optimizer(model);updates=0;metrics=[]
    for step in range(2):
        result=train_round(model,optimizer,positions,device=device,seed=107+step,deadline=deadline,operation=monitor.operation)
        if result['updates']<1 or result['nonzeroUpdates']!=result['updates']:raise TimeoutError('canary minibatch incomplete')
        updates+=result['updates'];metrics.extend(result['batches'])
    state=default_state();state.update(updates=updates,nonzeroUpdates=updates,archives=archives)
    checkpoint=Path(directory)/'checkpoints'/'canary.pt'
    with monitor.operation('canary-checkpoint-recovery',120):
        digest=save_checkpoint(checkpoint,model,optimizer,round_index=0,updates=updates,replay_ids=archives,
                               manifest_sha256=manifest_hash,recovery_state=state)
        python_next=random.random();torch_next=torch.rand(4)
        mps_next=torch.rand(4,device='mps') if str(device)=='mps' else None
        restored=PolicyValueNet().to(device);restored_optimizer=make_optimizer(restored)
        data=load_checkpoint(checkpoint,restored,restored_optimizer,manifest_sha256=manifest_hash,require_recovery=True)
        if random.random()!=python_next or not torch.equal(torch.rand(4),torch_next):raise ValueError('canary RNG restoration mismatch')
        if mps_next is not None and not torch.equal(torch.rand(4,device='mps'),mps_next):raise ValueError('canary MPS RNG mismatch')
        if data['updates']!=updates or any(not torch.equal(a,b) for a,b in zip(model.parameters(),restored.parameters())):
            raise ValueError('canary weight restoration mismatch')
        if len(restored_optimizer.state)!=len(optimizer.state):raise ValueError('canary optimizer recovery mismatch')
        before,after=optimizer.state_dict(),restored_optimizer.state_dict()
        if before['param_groups']!=after['param_groups']:raise ValueError('canary optimizer groups mismatch')
        for key,values in before['state'].items():
            for name,value in values.items():
                recovered=after['state'][key][name]
                equal=torch.equal(value.cpu(),recovered.cpu()) if isinstance(value,torch.Tensor) else value==recovered
                if not equal:raise ValueError('canary optimizer tensor mismatch')
    return restored.eval(),{'updates':updates,'nonzeroUpdates':updates,'batches':metrics,'checkpointSha256':digest,'recoveryPassed':True}


def run(directory,corpus,*,device='mps',generator=selfplay,checker=numeric_parity):
    directory=Path(directory);runtime=json.loads((directory/'runtime.json').read_text())
    deadline=min(effective_deadline(runtime),time.monotonic()+600)
    report={'schema':1,'passed':False,'complete':False,'productionPromotion':False,'countsTowardHealth':False,
            'terminalGames':0,'replayChecks':0,'updates':0,'parityStates':0}
    output=directory/'canary-report.json';atomic_json(output,report)
    attempt=directory/'canaries'/uuid.uuid4().hex;attempt.mkdir(parents=True);report['artifacts']=str(attempt)
    try:
        with RunnerMonitor(directory) as monitor:
            if deadline-time.monotonic()<60:raise TimeoutError('insufficient canary allocation')
            if device=='mps' and not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable')
            def ready():
                while True:
                    monitor.check()
                    if deadline-time.monotonic()<45:raise TimeoutError('canary deadline')
                    allocation=json.loads((directory/'allocation.json').read_text())
                    if allocation.get('stop'):raise TimeoutError('canary resource stop')
                    if (not allocation.get('paused',True) and allocation.get('workers',0)>0
                        and allocation.get('reason')!='initial-conservative'):return
                    time.sleep(.1)
            ready();manifest=active_manifest(directory)
            with monitor.operation('canary-initialization',60):
                corpus_hash=hashlib.sha256(Path(corpus).read_bytes()).hexdigest()
                if corpus_hash!=runtime['parityCorpusSha256']:raise ValueError('canary corpus identity changed')
                rows=verify_corpus(json.loads(Path(corpus).read_text()))
                torch.manual_seed(107);random.seed(107);model=PolicyValueNet().to(device).eval();buffer=ReplayBuffer();archives=[]
            for i,(state,family) in enumerate(canary_roots()):
                if i>=2:break
                ready();job={'command':'generate','id':f'canary-{attempt.name}-{i}','familyId':family,'seed':107+i,
                            'partition':'train','kind':'simple','initialState':state,'modelVersion':'canary-untrained'}
                game=generator(job,model,device,deadline,monitor)
                with monitor.operation('canary-exact-replay',20):verify_game(game,min(deadline-10,time.monotonic()+20))
                if game['termination']!='terminal' or not game['decisions']:raise ValueError('canary needs genuine terminal self-play')
                path=save_game(attempt/'games',game);archives.append(str(path.relative_to(attempt)));buffer.append(game)
                report['terminalGames']+=1;report['replayChecks']+=1;atomic_json(output,report)
            ready();model,training=train_and_recover(attempt,model,list(buffer.positions),archives,manifest['sha256'],device,deadline,monitor)
            report.update(training);atomic_json(output,report)
            with monitor.operation('canary-export',60):
                asset=attempt/'model.onnx';export_onnx(model,asset)
            errors=[0.,0.]
            for offset in range(0,len(rows),32):
                ready()
                with monitor.operation('canary-export-parity',30):
                    inputs=np.asarray([r['encoded'] for r in rows[offset:offset+32]],dtype=np.float32).reshape(-1,46,10,10)
                    parity=checker(model,asset,inputs,reference_device=device)
                if parity.get('numericPassed') is not True or not np.isfinite(parity['maxAbsoluteError']).all():raise ValueError('canary numeric parity failed')
                errors=[max(a,b) for a,b in zip(errors,parity['maxAbsoluteError'])]
                report['parityStates']+=len(inputs);atomic_json(output,report)
            report.update(complete=True,passed=device=='mps' and report['terminalGames']>=2 and report['updates']>=2 and report['parityStates']>=1000,
                          referenceDevice=device,maxAbsoluteError=errors,corpusSha256=hashlib.sha256(Path(corpus).read_bytes()).hexdigest())
    except (TimeoutError,subprocess.TimeoutExpired) as error:report['reason']=str(error)
    except (ValueError,RuntimeError,OSError,KeyError) as error:report.update(reason=str(error),failed=True)
    atomic_json(output,report);return report


def main():
    p=argparse.ArgumentParser();p.add_argument('--run-dir',type=Path,required=True);p.add_argument('--corpus',type=Path,required=True);args=p.parse_args()
    runtime=json.loads((args.run_dir/'runtime.json').read_text())
    if runtime.get('command')!='canary' or runtime.get('supervisorPid')!=os.getppid() or os.getpgrp()!=os.getpid():raise ValueError('canary requires supervisor')
    signal.signal(signal.SIGUSR1,lambda *_:None);torch.set_num_threads(1)
    result=run(args.run_dir,args.corpus);print(json.dumps(result,indent=2))
    if result.get('failed'):raise SystemExit(1)

if __name__=='__main__':main()
