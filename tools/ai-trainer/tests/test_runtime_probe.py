"""Runtime-probe contract with an injected Torch device, never a GPU claim."""
import sys
import types
import unittest
from unittest.mock import patch
from righelt_training import runtime_probe


class Tensor:
    def __init__(self,value):self.value=value
    def add_(self,value):self.value+=value;return self
    def item(self):return self.value


class RuntimeProbeTest(unittest.TestCase):
    def torch(self,count=1):
        device=types.SimpleNamespace(name='Synthetic assigned GPU',major=9,minor=0,total_memory=24000000000)
        return types.SimpleNamespace(__version__='2.14.1+cu128',version=types.SimpleNamespace(cuda='12.8'),
            cuda=types.SimpleNamespace(is_available=lambda:True,device_count=lambda:count,get_device_properties=lambda _:device,synchronize=lambda:None),
            tensor=lambda values,device:Tensor(values[0]))

    def test_one_cuda_device_accepts_multiple_matching_driver_rows(self):
        with patch.dict(sys.modules,{'torch':self.torch()}),patch.object(runtime_probe.subprocess,'check_output',return_value='580.1\n580.1\n'):
            result=runtime_probe.probe()
        self.assertEqual(result['gpuCount'],1);self.assertEqual(result['driverVersion'],'580.1');self.assertTrue(result['kernelPassed'])

    def test_differing_empty_or_invalid_drivers_and_multiple_cuda_devices_reject(self):
        for text in ('','580.1\n581.0','580.1\n\n580.1','not-a-driver'):
            with self.subTest(text=text),patch.dict(sys.modules,{'torch':self.torch()}),patch.object(runtime_probe.subprocess,'check_output',return_value=text):
                with self.assertRaisesRegex(RuntimeError,'driver'):runtime_probe.probe()
        with patch.dict(sys.modules,{'torch':self.torch(2)}):
            with self.assertRaisesRegex(RuntimeError,'one available'):runtime_probe.probe()


if __name__=='__main__':unittest.main()
