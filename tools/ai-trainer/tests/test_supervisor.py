import tempfile
import sys
import time
from pathlib import Path
import unittest
from righelt_training.supervisor import supervise,validate_gate_report
from righelt_training.processes import start_group
from righelt_training.budget import Budget
from righelt_training.resources import AdaptivePolicy,Sample,GIB
from righelt_training.config import CONFIG_SHA256

class QuietTelemetry:
    def sample(self):
        now=time.time()
        return Sample(now,None,None,0,'normal',GIB,40*GIB,500*GIB,0)

class SupervisorTest(unittest.TestCase):
    def test_deadline_kills_noncooperative_child(self):
        with tempfile.TemporaryDirectory() as d:
            process=start_group([sys.executable,'-c','while True: pass'])
            begin=time.monotonic()
            result=supervise(process,Budget(begin,.1),AdaptivePolicy(),QuietTelemetry(),Path(d),sample_seconds=.05)
            self.assertEqual(result,'budget-expired')
            self.assertIsNotNone(process.returncode)
            self.assertLess(time.monotonic()-begin,2)

    def test_unknown_activity_stays_conservative(self):
        with tempfile.TemporaryDirectory() as d:
            process=start_group([sys.executable,'-c','import time; time.sleep(.1)'])
            result=supervise(process,Budget(time.monotonic(),2),AdaptivePolicy(),QuietTelemetry(),Path(d))
            self.assertEqual(result,'completed')
            import json
            allocation=json.loads((Path(d)/'allocation.json').read_text())
            self.assertEqual(allocation['workers'],2)
            self.assertEqual(allocation['memory_gib'],16)

    def test_stale_or_smoke_only_gate_report_rejected(self):
        report={'sourceRevision':'rev','configSha256':CONFIG_SHA256,'checks':{k:{'passed':True,'evidence':'test'} for k in ('coreTests','trainerTests','exactReplay','exportParity')}}
        with self.assertRaises(ValueError):validate_gate_report(report,'rev','initial')
        report['checks']['exportParity'].update(heldoutStates=1000,legalMasksPassed=True,tacticalParityPassed=True)
        validate_gate_report(report,'rev','initial')
        with self.assertRaises(ValueError):validate_gate_report(report,'changed','initial')
        with self.assertRaises(ValueError):validate_gate_report(report,'rev','overnight')

if __name__=='__main__':unittest.main()
