import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
from types import SimpleNamespace
from righelt_training.telemetry import read_device_memory,Telemetry

class TelemetryTest(unittest.TestCase):
    def test_swap_counter_and_conservative_rss_plus_mps_reach_policy(self):
        from righelt_training.resources import AdaptivePolicy,GIB
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);device=root/'device.json';time_now=100
            device.write_text(json.dumps({'schema':1,'pid':42,'observedAt':time_now,'driverBytes':1234}))
            process=Mock(pid=99)
            process.children.return_value=[];process.cpu_percent.return_value=0
            process.memory_info.return_value=SimpleNamespace(rss=1024)
            with patch('righelt_training.telemetry.psutil.Process',return_value=process), \
                    patch('righelt_training.telemetry.psutil.cpu_percent',return_value=0), \
                    patch('righelt_training.telemetry.psutil.cpu_count',return_value=1), \
                    patch('righelt_training.telemetry.psutil.virtual_memory',return_value=SimpleNamespace(available=40*GIB)), \
                    patch('righelt_training.telemetry.psutil.disk_usage',return_value=SimpleNamespace(free=500*GIB)), \
                    patch('righelt_training.telemetry.subprocess.run',return_value=SimpleNamespace(stdout='1')), \
                    patch('righelt_training.telemetry.time.time',return_value=time_now), \
                    patch('righelt_training.telemetry.psutil.swap_memory',side_effect=[SimpleNamespace(sout=5*GIB,used=GIB),SimpleNamespace(sout=6*GIB,used=GIB),OSError('swap unavailable')]):
                telemetry=Telemetry(root,root/'activity.json',device,42)
                observed=telemetry.sample()
                self.assertEqual(observed.experiment_bytes,2258)
                self.assertEqual(observed.swap_used_bytes,GIB)
                self.assertTrue(observed.device_memory_known)
                policy=AdaptivePolicy();self.assertFalse(policy.decide(observed).paused)
                # Growing general page-outs with unchanged allocated swap is not
                # evidence that swapping has begun on this Darwin implementation.
                self.assertFalse(policy.decide(telemetry.sample()).paused)
                missing=telemetry.sample()
                self.assertIsNone(missing.swap_used_bytes)
                self.assertTrue(AdaptivePolicy().decide(missing).paused)

    def test_only_fresh_runner_owned_gpu_bytes_are_counted(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'device.json'
            self.assertEqual(read_device_memory(p,42,100),(0,False))
            p.write_text(json.dumps({'schema':1,'pid':42,'observedAt':100,'driverBytes':123456789}))
            self.assertEqual(read_device_memory(p,42,101),(123456789,True))
            self.assertEqual(read_device_memory(p,43,101),(0,False))
            self.assertEqual(read_device_memory(p,42,131),(0,False))
            self.assertEqual(read_device_memory(p,42,99),(0,False))

    def test_heartbeat_written_during_telemetry_collection_is_fresh(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'device.json'
            sample_started=100
            # CPU and sysctl sampling runs before the GPU file is read.
            path.write_text(json.dumps({'schema':1,'pid':42,'observedAt':100.003,'driverBytes':9125888}))
            self.assertEqual(read_device_memory(path,42,sample_started),(0,False))
            with patch('righelt_training.telemetry.time.time',return_value=100.004):
                self.assertEqual(read_device_memory(path,42),(9125888,True))
            with patch('righelt_training.telemetry.time.time',return_value=99):
                self.assertEqual(read_device_memory(path,42),(0,False))
            with patch('righelt_training.telemetry.time.time',return_value=131):
                self.assertEqual(read_device_memory(path,42),(0,False))

if __name__=='__main__':unittest.main()
