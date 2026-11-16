import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np
import onnx
import torch
from righelt_training.arithmetic import ieee_fp32, arithmetic_record, hosted_arithmetic
from righelt_training.export import export_onnx, numeric_parity, output_metrics, NumericParityError
from righelt_training.model import PolicyValueNet


class NumericBoundariesTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(107)

    def test_actual_cpu_export_preserves_caller_and_checks_both_outputs(self):
        model=PolicyValueNet().train()
        before=copy.deepcopy(model.state_dict())
        with tempfile.TemporaryDirectory() as d, ieee_fp32():
            path=Path(d)/'model.onnx'
            export_onnx(model,path)
            states=np.random.default_rng(107).normal(size=(2,46,10,10)).astype(np.float32)
            report=numeric_parity(model,path,states,report_path=Path(d)/'numeric.json')
            self.assertTrue(report['numericPassed'])
            self.assertFalse(report['acceptancePassed'])
            self.assertEqual([o['name'] for o in report['batches'][0]['comparisons']['torchCpuToOrtCpu']['outputs']],['policy','value'])
            self.assertEqual(json.loads((Path(d)/'numeric.json').read_text()),report)
            # Change the actual exported weights, not the expected answer.
            graph=onnx.load(path)
            bias=next(t for t in graph.graph.initializer if t.name=='policy.bias')
            values=onnx.numpy_helper.to_array(bias).copy()+1
            bias.CopyFrom(onnx.numpy_helper.from_array(values,name=bias.name))
            onnx.save(graph,path)
            with self.assertRaises(NumericParityError):
                numeric_parity(model,path,states,report_path=Path(d)/'failed.json')
            failed=json.loads((Path(d)/'failed.json').read_text())
            outputs=failed['batches'][0]['comparisons']['torchCpuToOrtCpu']['outputs']
            self.assertFalse(failed['numericPassed'])
            self.assertGreater(outputs[0]['exceedingCells'],0)
            self.assertEqual(len(outputs),2)
        self.assertTrue(model.training)
        self.assertEqual(next(model.parameters()).device.type,'cpu')
        for name,tensor in model.state_dict().items():
            self.assertTrue(torch.equal(tensor,before[name]))

    def test_exact_abi_rejects_broadcast_missing_extra_dtype_and_nonfinite(self):
        good=[np.zeros((2,2801),np.float32),np.zeros((2,),np.float32)]
        shapes=((2,2801),(2,))
        for bad in (good[:1],good+[good[1]], [good[0][:1],good[1]],
                    [good[0].astype(np.float64),good[1]],
                    [good[0],np.array([np.nan,0],np.float32)]):
            self.assertFalse(output_metrics(good,bad,shapes)['passed'])

    def test_orchestration_keeps_combined_boundary_and_persists_all_outputs_before_failure(self):
        # CPU-only orchestration proof, not CUDA hardware qualification. Two
        # pairwise passes must never replace the direct combined comparison.
        model=PolicyValueNet()
        states=np.zeros((2,46,10,10),np.float32)
        def outputs(delta):return [np.full((2,2801),delta,np.float32),np.zeros(2,np.float32)]
        class Session:
            def get_providers(self):return ['CPUExecutionProvider']
            def run(self,*_):return outputs(9e-6)
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'model.onnx';path.write_bytes(b'unit-orchestration-not-real-onnx')
            with patch('righelt_training.export.ort.InferenceSession',return_value=Session()), \
                 patch('righelt_training.export._forward',side_effect=lambda m,x,device:outputs(-9e-6 if device.type=='cuda' else 0)), \
                 patch('torch.cuda.get_device_properties',return_value=SimpleNamespace(name='unit-only',major=12,minor=0,total_memory=1)):
                with self.assertRaises(NumericParityError):
                    numeric_parity(model,path,states,'cuda',report_path=Path(d)/'failed.json')
            report=json.loads((Path(d)/'failed.json').read_text())
            comparisons=report['batches'][0]['comparisons']
            self.assertTrue(comparisons['torchCpuToOrtCpu']['passed'])
            self.assertTrue(comparisons['torchReferenceToTorchCpu']['passed'])
            self.assertFalse(comparisons['torchReferenceToOrtCpu']['passed'])
            self.assertEqual(len(comparisons['torchReferenceToOrtCpu']['outputs']),2)
            self.assertGreater(comparisons['torchReferenceToOrtCpu']['outputs'][0]['maxToleranceRatio'],1)

    def test_common_hosted_context_reads_back_and_restores_on_failure_and_nesting(self):
        before=arithmetic_record()
        @hosted_arithmetic
        def operation():
            value=arithmetic_record()
            self.assertEqual(set(value['precision'].values()),{'ieee'})
            self.assertEqual(value['autocast'],{'cpu':False,'cuda':False})
            with ieee_fp32():self.assertEqual(arithmetic_record()['precision'],value['precision'])
            raise RuntimeError('injected failure')
        with patch.dict(os.environ,{'RIGHELT_HOSTED':'1'}):
            with self.assertRaisesRegex(RuntimeError,'injected failure'):operation()
        self.assertEqual(arithmetic_record(),before)


if __name__=='__main__':unittest.main()
