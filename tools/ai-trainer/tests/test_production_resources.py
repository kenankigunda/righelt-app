"""The new policy is opt-in; historical allocation policy remains unchanged."""
import json
import os
import subprocess
import sys
import unittest


class ProductionResourcesTest(unittest.TestCase):
    def run_policy(self, body):
        script = '''
import json
from dataclasses import replace
from righelt_training.resources import AdaptivePolicy,Sample,GIB
from righelt_training.resource_policy import LIMITS,POLICY_ID
def sample(t=0,**kw):
 return replace(Sample(t,t,False,0,'normal',4*GIB,40*GIB,500*GIB,0,ramp_authorized=True),**kw)
''' + body
        result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True,
                                env={**os.environ, 'RIGHELT_RESOURCE_POLICY':'production-headroom-v3'}, check=True)
        return json.loads(result.stdout)

    def test_ambitious_ceiling_and_explicit_activity_pause(self):
        r=self.run_policy('''
p=AdaptivePolicy()
for t in range(0,601,5): a=p.decide(sample(t))
busy=p.decide(sample(605,development_active=True))
print(json.dumps([a.record(),busy.record(),dict(LIMITS)]))
''')
        self.assertEqual(r[0]['workers'],8)
        self.assertEqual(r[0]['memory_gib'],36)
        self.assertTrue(r[1]['paused']);self.assertEqual(r[1]['workers'],0)
        self.assertEqual(r[2]['pauseAvailableGiB'],6)

    def test_unknown_activity_and_critical_pressure_never_admit_compute(self):
        r=self.run_policy('''
unknown=AdaptivePolicy().decide(sample(activity_observed_at=None))
critical=AdaptivePolicy().decide(sample(memory_pressure='critical'))
print(json.dumps([unknown.record(),critical.record()]))
''')
        self.assertTrue(r[0]['paused']);self.assertEqual(r[0]['workers'],0)
        self.assertTrue(r[1]['stop']);self.assertEqual(r[1]['workers'],0)

    def test_pressure_recovery_and_observation_gaps(self):
        r=self.run_policy('''
p=AdaptivePolicy();p.decide(sample(available_bytes=5*GIB))
for t in range(5,125,5): a=p.decide(sample(t,available_bytes=10*GIB))
before=a.record();after=p.decide(sample(125,available_bytes=10*GIB)).record()
print(json.dumps([before,after]))
''')
        self.assertTrue(r[0]['paused']);self.assertFalse(r[1]['paused'])
        self.assertEqual(r[1]['workers'],2)

    def test_low_headroom_downshifts_without_revoking_existing_memory_ceiling(self):
        r=self.run_policy('''
p=AdaptivePolicy()
for t in range(0,601,5): p.decide(sample(t))
backoff=p.decide(sample(605,available_bytes=9*GIB,experiment_bytes=25*GIB))
pause=p.decide(sample(610,available_bytes=5*GIB,experiment_bytes=25*GIB))
print(json.dumps([backoff.record(),pause.record()]))
''')
        self.assertEqual(r[0]['workers'],7);self.assertFalse(r[0]['paused'])
        self.assertEqual(r[0]['memory_gib'],36)
        self.assertTrue(r[1]['paused']);self.assertEqual(r[1]['workers'],0)

    def test_legacy_critical_stop_contract_is_unchanged(self):
        script='''
import json
from righelt_training.resources import AdaptivePolicy,Sample,GIB
s=Sample(0,0,False,0,'critical',4*GIB,40*GIB,500*GIB,0)
print(json.dumps(AdaptivePolicy().decide(s).record()))
'''
        result=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,
                              env={**os.environ,'RIGHELT_RESOURCE_POLICY':'adaptive-headroom-v2'},check=True)
        value=json.loads(result.stdout)
        self.assertTrue(value['paused']);self.assertFalse(value['stop'])
        self.assertEqual(value['workers'],0)

    def test_initial_grant_cannot_silently_raise_pending_work_cap(self):
        r=self.run_policy('''
p=AdaptivePolicy()
for t in range(0,1001,5): a=p.decide(sample(t,ramp_authorized=False))
print(json.dumps(a.record()))
''')
        self.assertEqual(r['workers'],2);self.assertEqual(r['memory_gib'],16)
        self.assertEqual(r['reason'],'pending-work-cap')
