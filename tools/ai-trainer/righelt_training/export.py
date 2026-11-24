"""Export and numeric checks. Synthetic smoke checks are never acceptance proof."""
from pathlib import Path
import os
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")
import hashlib
import copy
import numpy as np
import torch
import onnx
import onnxruntime as ort
from .checkpoint import atomic_json
from .config import CONFIG,CONFIG_SHA256
from .architecture import BASELINE, model_architecture
from .arithmetic import arithmetic_record


def export_onnx(model, path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    model=copy.deepcopy(model).cpu().eval()
    example=torch.zeros(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])
    torch.onnx.export(model,example,str(path),input_names=['state'],output_names=['policy','value'],
                      dynamic_axes={'state':{0:'batch'},'policy':{0:'batch'},'value':{0:'batch'}},
                      opset_version=17,dynamo=False)
    onnx.checker.check_model(str(path))
    metadata={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,
            'configSha256':CONFIG_SHA256,'opset':17,'dtype':'float32'}
    architecture=model_architecture(model)
    if architecture['id']!=BASELINE:metadata['modelArchitecture']=architecture
    implementation=getattr(model,'inference_implementation','native-v1')
    if implementation!='native-v1':
        import inspect
        metadata.update(inferenceImplementation=implementation,
            implementationSourceSha256=hashlib.sha256(Path(inspect.getfile(type(model))).read_bytes()).hexdigest())
    return metadata


def output_metrics(reference, actual, expected_shapes):
    """Strict raw ABI and asymmetric NumPy allclose, a=Torch, b=baseline."""
    if len(reference)!=2 or len(actual)!=2:
        return {'passed':False, 'error':'exactly two outputs required',
                'referenceCount':len(reference), 'actualCount':len(actual), 'outputs':[]}
    outputs=[]
    for name,a,b,shape in zip(('policy','value'),reference,actual,expected_shapes):
        a=np.asarray(a);b=np.asarray(b)
        abi=a.shape==b.shape==shape and a.dtype==b.dtype==np.dtype('float32')
        finite=bool(np.isfinite(a).all() and np.isfinite(b).all())
        record={'name':name,'referenceShape':list(a.shape),'actualShape':list(b.shape),
                'referenceDtype':str(a.dtype),'actualDtype':str(b.dtype),
                'abiPassed':abi,'finite':finite,
                'referenceNonfinite':int(np.count_nonzero(~np.isfinite(a))),
                'actualNonfinite':int(np.count_nonzero(~np.isfinite(b)))}
        if abi and finite:
            # Float64 metrics do not change np.allclose's float32 acceptance.
            delta=np.abs(a.astype(np.float64)-b.astype(np.float64))
            ratio=delta/(1e-5+1e-4*np.abs(b.astype(np.float64)))
            record.update(maxAbsoluteError=float(delta.max()),maxToleranceRatio=float(ratio.max()),
                          exceedingCells=int(np.count_nonzero(~np.isclose(a,b,atol=1e-5,rtol=1e-4))),
                          cells=int(a.size))
        record['passed']=bool(abi and finite and np.allclose(a,b,atol=1e-5,rtol=1e-4))
        outputs.append(record)
    return {'passed':all(o['passed'] for o in outputs),'outputs':outputs}


class NumericParityError(ValueError):
    def __init__(self, report):
        super().__init__('export parity failed; retained numeric diagnostics required')
        self.report=report


def _forward(model, states, device):
    with torch.no_grad():
        return [t.cpu().numpy() for t in model.to(device)(torch.from_numpy(states).to(device))]


def numeric_parity(model, path, states, reference_device="cpu", *, report_path=None):
    states=np.asarray(states,dtype=np.float32)
    if states.ndim!=4 or not len(states) or states.shape[1:]!=(CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize']) or not np.isfinite(states).all():
        raise ValueError('invalid encoded states')
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    ort.disable_telemetry_events()
    session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
    # Keep caller weights/device/mode immutable. All boundaries use these same
    # snapshots and the original batch partition, including the combined check.
    cpu=copy.deepcopy(model).cpu().eval()
    device=torch.device(reference_device)
    target=copy.deepcopy(cpu) if device.type!='cpu' else cpu
    if any(p.dtype!=torch.float32 for p in cpu.parameters()):
        raise ValueError('float32 model required')
    from .checkpoint import weights_sha256
    report={'schema':2,'referenceDevice':str(reference_device),'states':len(states),
            'inputShape':list(states.shape),'inputDtype':str(states.dtype),'batchSize':32,
            'inputSha256':hashlib.sha256(states.tobytes()).hexdigest(),
            'onnxSha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            'weightsSha256':weights_sha256(cpu.state_dict()),
            'atol':1e-5,'rtol':1e-4,'arithmetic':arithmetic_record(),
            'onnxruntimeVersion':ort.__version__,'providers':session.get_providers(),'batches':[]}
    if device.type=='cuda':
        prop=torch.cuda.get_device_properties(device)
        report['gpu']={'name':prop.name,'computeCapability':[prop.major,prop.minor],'memoryBytes':prop.total_memory}
    for start in range(0,len(states),32):
        x=states[start:start+32]
        cpu_outputs=_forward(cpu,x,torch.device('cpu'))
        reference=_forward(target,x,device) if device.type!='cpu' else cpu_outputs
        actual=session.run(None,{'state':x})
        shapes=((len(x),CONFIG['actionCount']),(len(x),))
        comparisons={'torchCpuToOrtCpu':output_metrics(cpu_outputs,actual,shapes)}
        if device.type!='cpu':
            comparisons['torchReferenceToTorchCpu']=output_metrics(reference,cpu_outputs,shapes)
            comparisons['torchReferenceToOrtCpu']=output_metrics(reference,actual,shapes)
        report['batches'].append({'start':start,'count':len(x),'comparisons':comparisons})
    report['numericPassed']=all(c['passed'] for b in report['batches'] for c in b['comparisons'].values())
    report['maxAbsoluteError']=[max((c['outputs'][i].get('maxAbsoluteError',0.) for b in report['batches'] for c in b['comparisons'].values() if len(c['outputs'])==2),default=0.) for i in range(2)]
    report.update(acceptancePassed=False,remaining=['1000 held-out engine states','legal masks and tactical parity','browser WASM parity'])
    if report_path is not None:atomic_json(report_path,report)
    if not report['numericPassed']:raise NumericParityError(report)
    return report
