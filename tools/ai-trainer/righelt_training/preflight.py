import argparse
import json
import platform
import tempfile
from pathlib import Path
import torch
from .model import PolicyValueNet
from .config import CONFIG
from .export import export_onnx,numeric_parity


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--require-mps',action='store_true');args=parser.parse_args()
    torch.manual_seed(107);torch.set_num_threads(1)
    model=PolicyValueNet();x=torch.randn(2,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
    mps=torch.backends.mps.is_available()
    if args.require_mps and not mps:raise RuntimeError('Apple MPS is unavailable')
    report={'python':platform.python_version(),'torch':torch.__version__,'mpsAvailable':mps,
            'parameters':sum(p.numel() for p in model.parameters()),'trainingExperimentStarted':False}
    if mps:
        model=model.to('mps');p,v=model(x.to('mps'));(p.square().mean()+v.square().mean()).backward();torch.mps.synchronize()
        if not all(t.grad is not None and torch.isfinite(t.grad).all() for t in model.parameters()):raise RuntimeError('invalid MPS gradients')
        report['mpsForwardBackwardPassed']=True
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'smoke.onnx';report['export']=export_onnx(model,path)
        report['numericSmoke']=numeric_parity(model,path,x.numpy())
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
