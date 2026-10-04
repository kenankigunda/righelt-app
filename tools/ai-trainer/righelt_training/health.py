"""Audit experiment health from replay archives and recoverable model weights."""
from .budget import effective_deadline
from .fallback_report import add_game as add_fallback_game
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import time
import os
import signal
import subprocess
import threading
import torch
from .checkpoint import atomic_json, load_checkpoint,inspect_checkpoint
from .manifest import active_manifest,manifest_hashes
from .repair import resolved_failures
from .config import ROOT,CONFIG_SHA256
from .model import PolicyValueNet
from .replay import partition_for_family
from .runner import verify_game


def finite_tree(value):
    if isinstance(value, torch.Tensor):
        return bool(torch.isfinite(value).all())
    if isinstance(value, dict):
        return all(finite_tree(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return all(finite_tree(v) for v in value)
    if isinstance(value, float):
        return __import__('math').isfinite(value)
    return True


def check_attempt_history(directory):
    starts={};ends={}
    for line in (Path(directory)/'supervisor-attempts.jsonl').read_text().splitlines():
        row=json.loads(line)
        target=starts if row['event']=='started' else ends if row['event']=='finished' else None
        if target is None or row['id'] in target:raise ValueError('invalid supervisor attempt journal')
        target[row['id']]=row
    if not starts or not set(ends)<=set(starts):raise ValueError('incomplete supervisor attempt journal')
    resolved=resolved_failures(directory)
    unfinished=[]
    for identity,start in starts.items():
        end=ends.get(identity)
        if identity in resolved:continue
        if end is None:
            if start['phase']=='health' and start['pid']==os.getppid():continue
            raise ValueError('unresolved interrupted supervisor attempt')
        if end['reason'] in ('runner-failed','telemetry-failed','operation-timeout','interrupted','setup-failed'):raise ValueError('unresolved prior supervisor failure')
        if end['reason']=='validation-handoff-timeout':unfinished.append({'id':identity,'phase':start['phase'],'reason':end['reason']})
    return unfinished


def trained_export_proof(directory,latest,manifest):
    path=directory/'trained-export-parity.json'
    if not path.exists():return False
    proof=json.loads(path.read_text());runtime=json.loads((directory/'runtime.json').read_text())
    corpus=Path(runtime.get('parityCorpusPath',''))
    if not corpus.is_file():return False
    digest=hashlib.sha256(corpus.read_bytes()).hexdigest()
    errors=proof.get('maxAbsoluteError',[])
    return (proof.get('complete') is True and proof.get('numericPassed') is True
        and proof.get('trainedCheckpoint') is True and proof.get('referenceDevice')=='mps'
        and proof.get('heldoutStates',0)>=1000 and len(errors)==2 and finite_tree(errors)
        and all(type(value) in (float,int) and value>=0 for value in errors)
        and proof.get('atol')==1e-5 and proof.get('rtol')==1e-4
        and proof.get('checkpointSha256')==latest['sha256'] and proof.get('configSha256')==CONFIG_SHA256
        and proof.get('manifestSha256')==manifest['sha256']
        and proof.get('sourceRevision')==manifest['manifest']['sourceRevision']
        and proof.get('corpusSha256')==runtime.get('parityCorpusSha256')==digest)


def audit(directory, deadline, *, verifier=verify_game, clock=time.monotonic):
    directory=Path(directory).resolve()
    result={'schema':1,'terminalGames':0,'truncatedGames':0,'replayChecks':0,
            'distinctRecoverableTrainedCheckpoints':0,'finiteNonzeroUpdates':False,
            'unresolvedCorrectnessFailures':0,'complete':False,'progressReportPublished':False,
            'healthy':False,'productionPromotion':False,'failures':[],'checkpoints':[],
            'trainedExportParityPassed':False,'unfinishedAttempts':[]}
    try:
        result['unfinishedAttempts']=check_attempt_history(directory)
        latest=json.loads((directory/'latest.json').read_text())
        path=Path(latest['checkpoint']).resolve()
        if not path.is_relative_to(directory):raise ValueError('checkpoint outside run')
        allowed=manifest_hashes(directory)
        meta=json.loads(path.with_suffix('.json').read_text())
        if meta['manifestSha256'] not in allowed:raise ValueError('checkpoint source lineage not authorized')
        inspect_checkpoint(path,manifest_sha256=meta['manifestSha256'],require_recovery=True)
        companion=json.loads(path.with_suffix('.runner.json').read_text())
        if companion['checkpointSha256']!=latest['sha256'] or hashlib.sha256(path.read_bytes()).hexdigest()!=latest['sha256']:
            raise ValueError('latest checkpoint identity mismatch')
        state=companion['state'];seen=set()
        if state['updates']!=latest['updates']:raise ValueError('latest update count mismatch')
        manifest_record=active_manifest(directory)
        manifest=manifest_record['sha256']
        result['trainedExportParityPassed']=trained_export_proof(directory,latest,manifest_record)
        for name in state['archives']:
            if clock()>=deadline-5:raise TimeoutError('health replay audit unfinished within stage budget')
            archive=(directory/name).resolve()
            if not archive.is_relative_to(directory.parent):raise ValueError('archive outside experiment allocation')
            with gzip.open(archive,'rt') as stream:game=json.load(stream)
            if game['id'] in seen:raise ValueError('duplicate archived game')
            seen.add(game['id'])
            if game['partition']!='train' or partition_for_family(game['familyId'])!='train':raise ValueError('training split violation')
            verifier(game,min(deadline,clock()+20))
            if game['termination']=='terminal' and game['outcome']['status'] in ('p1_win','p2_win','draw'):
                result['terminalGames']+=1
            elif game['termination']=='truncated' and game['outcome']['status']=='ongoing':result['truncatedGames']+=1
            else:raise ValueError('invalid terminal/truncation record')
            result['replayChecks']+=1
            add_fallback_game(result.setdefault('fallbackReport',{}),game)
        weights=set()
        for checkpoint in [path]+[p for p in sorted((directory/'checkpoints').glob('*.pt'),reverse=True) if p!=path]:
            if clock()>=deadline-2:raise TimeoutError('checkpoint recovery audit unfinished within stage budget')
            meta=json.loads(checkpoint.with_suffix('.json').read_text())
            model=PolicyValueNet();optimizer=torch.optim.AdamW(model.parameters())
            if meta['manifestSha256'] not in allowed:raise ValueError('checkpoint source lineage not authorized')
            data=load_checkpoint(checkpoint,model,optimizer,manifest_sha256=meta['manifestSha256'],require_recovery=True)
            if data['updates']!=meta['updates'] or not finite_tree(data['model']) or not finite_tree(data['optimizer']):
                raise ValueError('invalid checkpoint parameters or optimizer state')
            if data['updates']<=0:continue
            optimizer_steps=[float(entry.get('step',0)) for entry in data['optimizer']['state'].values()]
            if not optimizer_steps or max(optimizer_steps)!=data['updates']:raise ValueError('optimizer update count mismatch')
            digest=hashlib.sha256()
            for name,tensor in sorted(model.state_dict().items()):
                digest.update(name.encode());digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
            weights.add(digest.hexdigest())
            result['checkpoints'].append({'path':str(checkpoint),'sha256':meta['sha256'],
                'weightsSha256':digest.hexdigest(),'updates':data['updates']})
            if len(weights)>=2:break
        result['distinctRecoverableTrainedCheckpoints']=len(weights)
        result['finiteNonzeroUpdates']=bool(weights) and state['updates']>0 and state['nonzeroUpdates']==state['updates']
        result['complete']=True
        result['healthy']=(result['terminalGames']>=100 and len(weights)>=2 and result['finiteNonzeroUpdates']
                           and result['trainedExportParityPassed'] and not result['unfinishedAttempts'])
    except (TimeoutError,subprocess.TimeoutExpired) as error:
        result['failures'].append(str(error))
    except (ValueError,KeyError,OSError,RuntimeError) as error:
        result['unresolvedCorrectnessFailures']+=1
        result['failures'].append(str(error))
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=Path,required=True);args=parser.parse_args()
    directory=args.run_dir.resolve()
    if not directory.is_relative_to((ROOT/'.ai-runs').resolve()):raise ValueError('expected supervised experiment directory')
    runtime=json.loads((directory/'runtime.json').read_text())
    import psutil
    if runtime['bootTime']!=psutil.boot_time():raise ValueError('cannot reuse deadline after reboot')
    if runtime.get('supervisorPid')!=os.getppid() or runtime.get('command')!='health' or os.getpgrp()!=os.getpid():
        raise ValueError('health must run inside the original external supervisor')
    signal.signal(signal.SIGUSR1,lambda *_:None)
    stopped=threading.Event()
    def heartbeat():
        while not stopped.is_set():
            amount=torch.mps.driver_allocated_memory() if torch.backends.mps.is_available() else 0
            atomic_json(directory/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':amount})
            stopped.wait(3)
    thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
    atomic_json(directory/'health-report.json',{'schema':1,'healthy':False,'complete':False,'reason':'audit-running'})
    torch.set_num_threads(1)
    try:result=audit(directory,effective_deadline(runtime))
    finally:stopped.set();thread.join(timeout=1)
    atomic_json(directory/'health-report.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
