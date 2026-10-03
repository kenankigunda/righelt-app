import json
import tempfile
from pathlib import Path
import unittest
from righelt_training.telemetry import read_device_memory

class TelemetryTest(unittest.TestCase):
    def test_only_fresh_runner_owned_gpu_bytes_are_counted(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'device.json'
            self.assertEqual(read_device_memory(p,42,100),(0,False))
            p.write_text(json.dumps({'schema':1,'pid':42,'observedAt':100,'driverBytes':123456789}))
            self.assertEqual(read_device_memory(p,42,101),(123456789,True))
            self.assertEqual(read_device_memory(p,43,101),(0,False))
            self.assertEqual(read_device_memory(p,42,131),(0,False))
            self.assertEqual(read_device_memory(p,42,99),(0,False))

if __name__=='__main__':unittest.main()
