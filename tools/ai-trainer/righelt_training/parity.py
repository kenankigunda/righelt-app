"""Held-out numeric parity. Does not claim tactical or browser proof."""
import argparse
import hashlib
import json
from pathlib import Path
import torch
from .config import CONFIG,CONFIG_SHA256
from .checkpoint import atomic_json,load_checkpoint
from .export import export_onnx,numeric_parity
from .model import PolicyValueNet
from .replay import partition_for_family


def verify_corpus(data):
    rows=data.get('states',[])
    if data.get('kind')!='export-validation' or len(rows)<1000:raise ValueError('requires 1000 held-out states')
    ids=set();hashes=set()
    for row in rows:
        if row['id'] in ids or row['hash'] in hashes:raise ValueError('duplicate parity state')
        ids.add(row['id']);hashes.add(row['hash'])
        if row['partition']!='validation' or partition_for_family(row['familyId'])!='validation':raise ValueError('parity corpus split violation')
        if len(row['encoded'])!=CONFIG['inputPlanes']*CONFIG['boardSize']**2 or not row['legal'] or len(row['legal'])!=len(set(row['legal'])):raise ValueError('invalid parity encoding or mask')
    return rows


def main():
    p=argparse.ArgumentParser();p.add_argument('--corpus',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--reference-output',type=Path);p.add_argument('--require-mps',action='store_true');p.add_argument('--checkpoint',type=Path);p.add_argument('--seed',type=int,default=107);args=p.parse_args()
    torch.set_num_threads(1);torch.manual_seed(args.seed)
    if args.require_mps and not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable')
    reference_device='mps' if args.require_mps else 'cpu'
    trained=False
    rows=verify_corpus(json.loads(args.corpus.read_text()));model=PolicyValueNet()
    if args.checkpoint:
        meta=json.loads(args.checkpoint.with_suffix('.json').read_text())
        load_checkpoint(args.checkpoint,model,manifest_sha256=meta['manifestSha256'])
        trained=meta['updates']>0
    args.output.mkdir(parents=True,exist_ok=True);asset=args.output/'model.onnx'
    metadata=export_onnx(model,asset)
    import numpy as np
    report=numeric_parity(model,asset,np.asarray([r['encoded'] for r in rows],dtype=np.float32).reshape(-1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize']),reference_device=reference_device)
    report.update(configSha256=CONFIG_SHA256,corpusSha256=hashlib.sha256(args.corpus.read_bytes()).hexdigest(),
                  heldoutStates=len(rows),export=metadata,trainedCheckpoint=trained,
                  legalMasksPassed=False,tacticalParityPassed=False,
                  remaining=['TypeScript legal-mask verification','tactical parity','browser WASM parity'])
    if args.reference_output:
        model=model.to(reference_device).eval();references=[]
        for row in rows:
            x=torch.tensor(row['encoded'],dtype=torch.float32,device=reference_device).reshape(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
            with torch.no_grad():policy,value=model(x)
            references.append({'id':row['id'],'policyLogits':policy[0].cpu().tolist(),'value':value[0].item(),'legal':row['legal']})
        atomic_json(args.reference_output,{'schema':1,'configSha256':CONFIG_SHA256,'corpusSha256':report['corpusSha256'],
                    'modelSha256':metadata['sha256'],'referenceDevice':reference_device,'states':references})
    atomic_json(args.output/'parity-report.json',report);print(json.dumps(report,indent=2))

if __name__=='__main__':main()
