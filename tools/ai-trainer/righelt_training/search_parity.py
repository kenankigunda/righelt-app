"""Real model-guided search reference for cross-runtime tactical parity."""
import argparse
import hashlib
import json
from pathlib import Path
import selectors
import subprocess
import time
import torch
from .config import ROOT,CONFIG,CONFIG_SHA256
from .checkpoint import atomic_json,load_checkpoint
from .export import export_onnx
from .parity import verify_corpus
from .model import PolicyValueNet
from .runner import stop_worker


def search_reference(state,model,device,seed,profile,bound_seconds=10):
    p=subprocess.Popen(['node','--import','tsx',str(ROOT/'tools/ai-trainer/engine-worker.mjs')],cwd=ROOT,
                       stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
    deadline=time.monotonic()+bound_seconds;buffer=b''
    try:
        p.stdin.write((json.dumps({'command':'search','state':state,'seed':seed,'profile':profile,'budgetMs':(bound_seconds-1)*1000})+'\n').encode());p.stdin.flush()
        while time.monotonic()<deadline:
            for key,_ in selector.select(timeout=.1):
                chunk=__import__('os').read(key.fd,65536)
                if not chunk:raise RuntimeError('search process exited unexpectedly')
                buffer+=chunk
                while b'\n' in buffer:
                    raw,buffer=buffer.split(b'\n',1);message=json.loads(raw)
                    if message['type']=='searched':return message['result']
                    if message['type']!='evaluate':raise RuntimeError(str(message))
                    x=torch.tensor(message['input'],dtype=torch.float32,device=device).reshape(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
                    with torch.inference_mode():policy,value=model(x)
                    reply={'type':'evaluation','id':message['id'],'policyLogits':policy[0].cpu().tolist(),'value':value[0].item()}
                    p.stdin.write((json.dumps(reply,allow_nan=False)+'\n').encode());p.stdin.flush()
        raise TimeoutError('search parity budget exhausted')
    finally:selector.close();stop_worker(p)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--corpus',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--checkpoint',type=Path);parser.add_argument('--device',choices=['cpu','mps'],default='mps');parser.add_argument('--limit',type=int,default=1000);parser.add_argument('--seconds',type=float,default=1800);args=parser.parse_args()
    if not 0<args.limit<=1000 or not 0<args.seconds<=1800:raise ValueError('invalid proof bounds')
    if args.device=='mps' and not torch.backends.mps.is_available():raise RuntimeError('requires MPS')
    torch.set_num_threads(1);torch.manual_seed(107);device=args.device;model=PolicyValueNet().eval()
    if args.checkpoint:
        meta=json.loads(args.checkpoint.with_suffix('.json').read_text())
        load_checkpoint(args.checkpoint,model,manifest_sha256=meta['manifestSha256'])
    asset=export_onnx(model,args.output.with_suffix('.onnx'));model=model.to(device).eval()
    corpus=json.loads(args.corpus.read_text());verify_corpus(corpus);profile={'simulations':8,'temperature':0,'maxValueGap':0}
    result={'schema':1,'configSha256':CONFIG_SHA256,'referenceDevice':device,'modelSha256':asset['sha256'],'corpusSha256':hashlib.sha256(args.corpus.read_bytes()).hexdigest(),'profile':profile,'modelSeed':107,'states':[],
            'complete':False,'acceptancePassed':False}
    started=time.monotonic()
    for i,row in enumerate(corpus['states'][:args.limit]):
        if time.monotonic()-started>args.seconds-11:break
        try:answer=search_reference(row['state'],model,device,107+i,profile)
        except Exception as error:answer={'status':'failed','reason':str(error)}
        result['states'].append({'id':row['id'],'seed':107+i,'result':answer})
        if (i+1)%10==0:atomic_json(args.output,result)
    result['complete']=len(result['states'])==args.limit
    result['elapsedSeconds']=time.monotonic()-started
    atomic_json(args.output,result);print(json.dumps({'states':len(result['states']),'ready':sum(s['result']['status']=='ready' for s in result['states']),'elapsedSeconds':result['elapsedSeconds']}))

if __name__=='__main__':main()
