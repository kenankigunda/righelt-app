"""Export and numeric checks. Synthetic smoke checks are never acceptance proof."""
from pathlib import Path
import hashlib
import numpy as np
import torch
import onnx
import onnxruntime as ort
from .checkpoint import atomic_json
from .config import CONFIG_SHA256


def export_onnx(model, path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    model=model.cpu().eval()
    example=torch.zeros(1,46,10,10)
    torch.onnx.export(model,example,str(path),input_names=['state'],output_names=['policy','value'],
                      dynamic_axes={'state':{0:'batch'},'policy':{0:'batch'},'value':{0:'batch'}},
                      opset_version=17,dynamo=False)
    onnx.checker.check_model(str(path))
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,
            'configSha256':CONFIG_SHA256,'opset':17,'dtype':'float32'}


def numeric_parity(model, path, states):
    states=np.asarray(states,dtype=np.float32)
    if states.ndim!=4 or states.shape[1:]!=(46,10,10) or not np.isfinite(states).all():
        raise ValueError('invalid encoded states')
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    ort.disable_telemetry_events()
    session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
    max_error=[0.,0.]
    for start in range(0,len(states),32):
        x=states[start:start+32]
        with torch.no_grad(): reference=[t.numpy() for t in model.cpu().eval()(torch.from_numpy(x))]
        actual=session.run(None,{'state':x})
        for i,(a,b) in enumerate(zip(reference,actual)):
            if not np.isfinite(b).all() or not np.allclose(a,b,atol=1e-5,rtol=1e-4):
                raise ValueError(f'export parity failed: output {i}')
            max_error[i]=max(max_error[i],float(np.max(np.abs(a-b))))
    return {'states':len(states),'atol':1e-5,'rtol':1e-4,'maxAbsoluteError':max_error,
            'numericPassed':True,'acceptancePassed':False,
            'remaining':['1000 held-out engine states','legal masks and tactical parity','browser WASM parity']}
