"""Pinned CPU ONNX Runtime inference over the actual frozen exported artifact."""
import numpy as np
import onnxruntime as ort
from .config import CONFIG
from .portable import resolve_reference


class ExportedModel:
    def __init__(self,binding):
        path=resolve_reference(binding['path'],expected_sha256=binding['sha256'])
        options=ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        ort.disable_telemetry_events()
        self.session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
        if [x.name for x in self.session.get_inputs()]!=['state'] or [x.name for x in self.session.get_outputs()]!=['policy','value']:
            raise ValueError('exported model ABI differs')
        self.runtime={'kind':'exported-onnx','onnxruntime':ort.__version__,'providers':self.session.get_providers(),
                      'artifactSha256':binding['sha256'],'inferenceDevice':'cpu','hostedGpuUsedForInference':False}

    def infer_export(self,encoded):
        x=np.asarray(encoded,dtype=np.float32)
        if x.size!=CONFIG['inputPlanes']*CONFIG['boardSize']**2 or not np.isfinite(x).all():
            raise ValueError('invalid exported inference input')
        policy,value=self.session.run(['policy','value'],{'state':x.reshape(1,CONFIG['inputPlanes'],CONFIG['boardSize'],CONFIG['boardSize'])})
        if policy.shape!=(1,CONFIG['actionCount']) or value.shape!=(1,) or not np.isfinite(policy).all() or not np.isfinite(value).all() or abs(float(value[0]))>1:
            raise ValueError('invalid exported inference output')
        return policy[0].tolist(),float(value[0])
