import unittest
from dataclasses import replace
from righelt_training.resources import AdaptivePolicy, Sample, GIB
from righelt_training.budget import Budget

class ResourcesTest(unittest.TestCase):
    def sample(self, t=0, **kw):
        return replace(Sample(t, t, False, 0, 'normal', 4*GIB, 40*GIB, 500*GIB, 0), **kw)

    def test_stale_unknown_or_active_cannot_ramp(self):
        for kw in [{'development_active':True}, {'development_active':None}, {'activity_observed_at':None}, {'activity_observed_at':-100}, {'activity_observed_at':10000}]:
            p=AdaptivePolicy()
            for t in range(0, 1000, 15):
                a=p.decide(self.sample(t, **kw))
                self.assertEqual(a.workers, 2)
                self.assertEqual(a.memory_gib,16)

    def test_gradual_ramp_then_immediate_backoff(self):
        p=AdaptivePolicy()
        self.assertEqual(p.decide(self.sample()).workers,2)
        self.assertEqual(p.decide(self.sample(119)).workers,2)
        self.assertEqual(p.decide(self.sample(120)).workers,3)
        self.assertEqual(p.decide(self.sample(121)).workers,3)
        for t in range(180,800,60): a=p.decide(self.sample(t))
        self.assertEqual(a.workers,8)
        a=p.decide(self.sample(800,development_active=True))
        self.assertEqual(a.workers,2)
        self.assertEqual(a.memory_gib,16)

    def test_memory_pressure_and_over_cap_pause(self):
        for kw in [{'memory_pressure':'critical'},{'memory_pressure':'unknown'}, {'experiment_bytes':33*GIB}, {'available_bytes':GIB}]:
            a=AdaptivePolicy().decide(self.sample(**kw))
            self.assertTrue(a.paused)
            self.assertEqual(a.workers,0)
        a=AdaptivePolicy().decide(self.sample(development_active=True,experiment_bytes=20*GIB))
        self.assertTrue(a.paused)

    def test_unknown_gpu_allocation_prevents_work_or_escalation(self):
        a=AdaptivePolicy().decide(self.sample(device_memory_known=False))
        self.assertTrue(a.paused)
        self.assertEqual(a.workers,0)
        self.assertEqual(a.reason,'device-memory-unknown')

    def test_disk_artifact_and_invalid_stop(self):
        for kw in [{'disk_free_bytes':GIB},{'artifact_bytes':100*GIB},{'external_cpu_percent':float('nan')}]:
            self.assertTrue(AdaptivePolicy().decide(self.sample(**kw)).stop)

    def test_paused_time_still_counts_and_batch_needs_headroom(self):
        b=Budget(10,100)
        self.assertTrue(b.may_start(80,20))
        self.assertFalse(b.may_start(81,20))
        self.assertEqual(b.remaining(110),0)
        self.assertFalse(b.may_start(111,1))
        with self.assertRaises(ValueError): b.may_start(10,float('nan'))

if __name__ == '__main__': unittest.main()
