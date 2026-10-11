"""Supervised trained-checkpoint MPS/native-ORT parity; browser promotion stays separate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import threading
import time
import numpy as np
import torch
from .budget import effective_deadline
from .allocation import Allocation
from .resume import validate_reset_checkpoint
from .checkpoint import atomic_json,load_checkpoint
from .config import CONFIG,CONFIG_SHA256
from .export import export_onnx,numeric_parity
from .model import PolicyValueNet
from .manifest import active_manifest,manifest_hashes
from .parity import verify_corpus


def validate_parity_checkpoint(directory,checkpoint,runtime,meta,checkpoint_hash,gate_report):
    latest_path=directory/'latest.json'
    if latest_path.exists():
        latest=json.loads(latest_path.read_text())
        if checkpoint_hash!=latest['sha256']:raise ValueError('parity requires latest trained checkpoint')
        if meta['manifestSha256'] not in manifest_hashes(directory):raise ValueError('checkpoint lineage not authorized')
    else:
        # Evaluation-only allocations inherit audited state without publishing a
        # fictitious local latest checkpoint or copying predecessor manifests.
        if (not gate_report or runtime.get('parentCheckpoint')!=str(checkpoint.resolve())
            or runtime.get('parentCheckpointManifestSha256')!=meta['manifestSha256']):
            raise ValueError('parity requires audited parent checkpoint binding')
        creation,_,_=Allocation(directory.parent,directory).accounting()
        validate_reset_checkpoint(checkpoint,json.loads(Path(gate_report).read_text()),creation)
    if meta['updates']<=0:raise ValueError('parity requires latest trained checkpoint')


def evaluate(directory,checkpoint,corpus,deadline,*,clock=time.monotonic,checker=numeric_parity,gate_report=None,
             development_cases=None,development_collector=None):
    directory=Path(directory);checkpoint=Path(checkpoint);corpus=Path(corpus)
    result={'schema':1,'complete':False,'numericPassed':False,'trainedCheckpoint':False,
            'heldoutStates':0,'referenceDevice':'mps','configSha256':CONFIG_SHA256,
            'productionPromotion':False,'remaining':['trained browser WASM parity','promotion gates']}
    output=directory/'trained-export-parity.json';atomic_json(output,result)
    try:
        if deadline-clock()<30:raise TimeoutError('export parity budget insufficient')
        runtime=json.loads((directory/'runtime.json').read_text())
        manifest=active_manifest(directory)
        corpus_hash=hashlib.sha256(corpus.read_bytes()).hexdigest()
        if corpus_hash!=runtime['parityCorpusSha256']:raise ValueError('supervised parity corpus changed')
        meta=json.loads(checkpoint.with_suffix('.json').read_text())
        checkpoint_hash=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        validate_parity_checkpoint(directory,checkpoint,runtime,meta,checkpoint_hash,gate_report)
        rows=verify_corpus(json.loads(corpus.read_text()))
        if not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable for trained parity')
        model=PolicyValueNet();load_checkpoint(checkpoint,model,manifest_sha256=meta['manifestSha256'],require_recovery=True)
        asset=directory/'trained-export'/f'{checkpoint_hash}.onnx'
        metadata=export_onnx(model,asset)
        errors=[0.,0.]
        for offset in range(0,len(rows),32):
            if deadline-clock()<10:raise TimeoutError('trained export parity unfinished')
            allocation=json.loads((directory/'allocation.json').read_text())
            while allocation.get('paused',True) or allocation.get('workers',0)<1 or allocation.get('reason')=='initial-conservative':
                if deadline-clock()<10 or allocation.get('stop'):raise TimeoutError('parity resource/budget stop')
                time.sleep(.1);allocation=json.loads((directory/'allocation.json').read_text())
            if allocation.get('stop'):raise TimeoutError('parity resource stop')
            batch=np.asarray([row['encoded'] for row in rows[offset:offset+32]],dtype=np.float32).reshape(-1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
            report=checker(model,asset,batch,reference_device='mps')
            if report.get('numericPassed') is not True or not np.isfinite(report['maxAbsoluteError']).all():raise ValueError('nonfinite/failed parity report')
            errors=[max(a,b) for a,b in zip(errors,report['maxAbsoluteError'])]
            result['heldoutStates']+=len(batch)
            atomic_json(output,result)
        result.update(complete=True,numericPassed=True,trainedCheckpoint=True,checkpointSha256=checkpoint_hash,
                      corpusSha256=corpus_hash,manifestSha256=manifest['sha256'],sourceRevision=manifest['manifest']['sourceRevision'],
                      maxAbsoluteError=errors,atol=1e-5,rtol=1e-4,export=metadata)
    except TimeoutError as error:result.update(reason=str(error))
    except (ValueError,RuntimeError,KeyError,OSError) as error:result.update(reason=str(error),failed=True)
    atomic_json(output,result)
    if result['complete'] and development_cases:
        cases_hash=hashlib.sha256(Path(development_cases).read_bytes()).hexdigest()
        if cases_hash!=runtime.get('developmentCasesSha256'):
            raise ValueError('supervised development cases changed')
        if development_collector is None:
            from .development_collect import collect
            development_collector=collect
        def resource_check():
            allocation=json.loads((directory/'allocation.json').read_text())
            if (allocation.get('paused',True) or allocation.get('stop') or allocation.get('workers',0)<1
                    or allocation.get('reason')=='initial-conservative'):
                raise TimeoutError('development resource pause')
        development=development_collector(model,checkpoint,corpus,Path(development_cases),directory,deadline,
                                          clock=clock,resource_check=resource_check)
        # Native parity stays a separate completed artifact. The observational
        # sidecar may be incomplete and never participates in health thresholds.
        atomic_json(directory/'development-latest.json',{**development,'casesSha256':cases_hash,
                    'checkpointSha256':checkpoint_hash,'sourceRevision':result['sourceRevision'],
                    'proofSha256':hashlib.sha256(Path(development['proof']).read_bytes()).hexdigest(),
                    'reportSha256':hashlib.sha256(Path(development['report']).read_bytes()).hexdigest()})
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--run-dir',type=Path,required=True);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--corpus',type=Path,required=True);p.add_argument('--gate-report',type=Path);p.add_argument('--development-cases',type=Path);args=p.parse_args()
    runtime=json.loads((args.run_dir/'runtime.json').read_text())
    if runtime.get('command')!='export-parity' or runtime.get('supervisorPid')!=os.getppid() or os.getpgrp()!=os.getpid():raise ValueError('export parity requires original supervisor')
    signal.signal(signal.SIGUSR1,lambda *_:None);stopped=threading.Event()
    def heartbeat():
        while not stopped.is_set():
            amount=torch.mps.driver_allocated_memory() if torch.backends.mps.is_available() else 0
            atomic_json(args.run_dir/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':amount});stopped.wait(3)
    thread=threading.Thread(target=heartbeat,daemon=True);thread.start();torch.set_num_threads(1)
    try:result=evaluate(args.run_dir,args.checkpoint,args.corpus,effective_deadline(runtime),gate_report=args.gate_report,
                        development_cases=args.development_cases)
    finally:stopped.set();thread.join(timeout=1)
    print(json.dumps(result,indent=2))
    if result.get('failed'):raise SystemExit(1)

if __name__=='__main__':main()
