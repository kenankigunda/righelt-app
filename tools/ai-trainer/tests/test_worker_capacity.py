"""Pure capacity/pressure policy plus mocked lease controls; no model or host workload."""
import copy,json,unittest
from datetime import datetime,timezone
from dataclasses import replace
from righelt_training.coexistence import capacity_binding
from righelt_training.resources import AdaptivePolicy,Sample,GIB
import test_coexistence as lease_fixtures

def receipt(t,workers=4,**changes):
 return dict({'observedAt':datetime.fromtimestamp(t,timezone.utc).isoformat(),'subject':'model','coexistenceVerified':True,'exclusiveVerified':True,'decision':'continue','blockers':[],'modelBytes':4*GIB,'foreignRssBytes':0,'rootGrantId':'explicit-exclusive','exclusiveMaxWorkers':workers,'exclusiveMemoryGiB':16,'exclusiveRampAuthorized':workers>2},**changes)
def sample(t,**changes):return replace(Sample(t,None,None,20,'normal',4*GIB,24*GIB,500*GIB,0),**changes)
class CapacityTest(unittest.TestCase):
 def test_legacy_and_explicit_shapes(self):
  self.assertEqual(capacity_binding({},{}),{'maxWorkers':2,'maxMemoryGiB':16,'rampAuthorized':False})
  for count in (2,4,8):
   cap={'maxWorkers':count,'maxMemoryGiB':16,'rampAuthorized':count>2};self.assertEqual(capacity_binding({'mode':'exclusive','capacity':cap},{'capacity':cap}),cap)
 def test_malformed_mismatched_and_foreign_capacity_rejects(self):
  cap={'maxWorkers':4,'maxMemoryGiB':16,'rampAuthorized':True}
  for change in ({'maxWorkers':True},{'maxWorkers':9},{'maxMemoryGiB':36},{'rampAuthorized':False}):
   bad={**cap,**change}
   with self.assertRaises(ValueError):capacity_binding({'mode':'exclusive','capacity':bad},{'capacity':bad})
  with self.assertRaises(ValueError):capacity_binding({'mode':'coexistence','capacity':cap},{'capacity':cap})
  with self.assertRaises(ValueError):capacity_binding({'mode':'exclusive','capacity':cap},{})
 def test_four_then_eight_gradual_ceiling_with_unknown_activity_not_fake_idle(self):
  for ceiling in (4,8):
   policy=AdaptivePolicy();observed=[]
   for t in range(1000,1601,5):
    s=sample(t);a=policy.decide(s,coexistence=receipt(t,ceiling));self.assertIsNone(s.development_active);self.assertFalse(s.ramp_authorized);self.assertLessEqual(a.workers,ceiling);self.assertEqual(a.memory_gib,16);observed.append(a.workers)
   self.assertEqual(observed[0],2);self.assertEqual(observed[-1],ceiling);self.assertIn(3,observed)
 def test_legacy_exclusive_never_ramps(self):
  policy=AdaptivePolicy()
  for t in range(1000,1401,5):
   a=policy.decide(sample(t),coexistence=receipt(t,2));self.assertEqual((a.workers,a.memory_gib),(2,16))
 def test_stale_foreign_incomplete_or_oversize_never_admits_ramp(self):
  for changes in ({'blockers':['unknown-heavy']},{'observedAt':'1970-01-01T00:00:00+00:00'},{'exclusiveVerified':False,'foreignRssBytes':GIB},{'exclusiveMemoryGiB':36},{'exclusiveRampAuthorized':False}):
   a=AdaptivePolicy().decide(sample(1000),coexistence=receipt(1000,4,**changes));self.assertTrue(a.paused)
  a=AdaptivePolicy().decide(sample(1000,experiment_bytes=17*GIB),coexistence=receipt(1000));self.assertTrue(a.paused)
 def test_warning_backoff_and_critical_unknown_stop(self):
  for pressure in ('critical','unknown'):
   self.assertTrue(AdaptivePolicy().decide(sample(1000,memory_pressure=pressure),coexistence=receipt(1000)).stop)
  a=AdaptivePolicy().decide(sample(1000,memory_pressure='warning'),coexistence=receipt(1000));self.assertEqual((a.workers,a.memory_gib),(2,16))
  for available in (10,6,5):self.assertTrue(AdaptivePolicy().decide(sample(1000,available_bytes=available*GIB),coexistence=receipt(1000)).paused)
class CapacityLeaseTest(unittest.TestCase):
 def fixture(self):
  f=lease_fixtures.LeaseTest(methodName='runTest');f.setUp();self.addCleanup(f.doCleanups);cap={'maxWorkers':4,'maxMemoryGiB':16,'rampAuthorized':True};f.permit.update(mode='exclusive',capacity=cap);f.binding['capacity']=copy.deepcopy(cap);f.permit_path.write_text(json.dumps(f.permit));f.binding['permitSha256']=f.sha(f.permit_path);f.grant.update(cap,permitSha256=f.sha(f.permit_path));f.write_state();return f
 def test_root_grant_mismatch_or_revocation_prevents_next_admission(self):
  for change in ({'maxWorkers':8},{'active':False},{'rampAuthorized':False}):
   f=self.fixture();guard=f.guard();f.grant.update(change);f.write_state()
   with self.assertRaises(ValueError):guard.check()
 def test_handoff_still_preserves_active_ownership_and_cleanup_reserve(self):
  f=self.fixture();guard=f.guard();f.now=1140
  with self.assertRaises(ValueError):guard.check()
  guard.request_handoff('finite-lease');self.assertTrue(f.grant['active']);self.assertEqual(json.loads((f.root/'allocation.json').read_text())['workers'],0);f.now=1191;self.assertTrue(guard.cleanup_due())
if __name__=='__main__':unittest.main()
