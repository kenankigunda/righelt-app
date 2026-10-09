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
        for t in range(0,120,5):
            assigned=p.decide(self.sample(t))
            self.assertEqual(assigned.workers,2);self.assertEqual(assigned.memory_gib,16)
        assigned=p.decide(self.sample(120))
        self.assertEqual(assigned.workers,3);self.assertEqual(assigned.memory_gib,24)
        self.assertEqual(p.decide(self.sample(121)).workers,3)
        for t in range(125,800,5): a=p.decide(self.sample(t))
        self.assertEqual(a.workers,4)
        self.assertEqual(a.memory_gib,24)
        a=p.decide(self.sample(800,development_active=True))
        self.assertEqual(a.workers,2)
        self.assertEqual(a.memory_gib,16)

    def test_memory_pressure_and_over_cap_pause(self):
        for kw in [{'memory_pressure':'critical'},{'memory_pressure':'unknown'}, {'experiment_bytes':24*GIB+1}, {'available_bytes':GIB}]:
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

    def test_exact_headroom_and_ceiling_boundaries(self):
        for available in (8*GIB,12*GIB-1):
            policy=AdaptivePolicy()
            for t in range(0,300,5):
                assigned=policy.decide(self.sample(t,available_bytes=available))
                self.assertFalse(assigned.paused)
                self.assertEqual(assigned.workers,2);self.assertEqual(assigned.memory_gib,16)
        self.assertTrue(AdaptivePolicy().decide(self.sample(available_bytes=8*GIB-1)).paused)
        self.assertFalse(AdaptivePolicy().decide(self.sample(experiment_bytes=16*GIB)).paused)
        self.assertTrue(AdaptivePolicy().decide(self.sample(experiment_bytes=16*GIB+1)).paused)
        self.assertTrue(AdaptivePolicy().decide(self.sample(experiment_bytes=24*GIB+1)).paused)
        policy=AdaptivePolicy()
        for t in range(0,121,5):assigned=policy.decide(self.sample(t,available_bytes=12*GIB))
        self.assertEqual(assigned.workers,3)
        self.assertFalse(policy.decide(self.sample(125,experiment_bytes=24*GIB)).paused)
        self.assertTrue(policy.decide(self.sample(130,experiment_bytes=24*GIB+1)).paused)

    def test_over_ceiling_cannot_escape_pressure_by_ramping(self):
        policy=AdaptivePolicy()
        for t in range(0,120,5):policy.decide(self.sample(t))
        assigned=policy.decide(self.sample(120,experiment_bytes=16*GIB+1))
        self.assertTrue(assigned.paused);self.assertEqual(assigned.workers,0)
        self.assertEqual(assigned.memory_gib,16)

    def test_resume_needs_two_minutes_continuously_above_recovery_threshold(self):
        policy=AdaptivePolicy()
        self.assertTrue(policy.decide(self.sample(available_bytes=7*GIB)).paused)
        for t in range(5,65,5):self.assertTrue(policy.decide(self.sample(t)).paused)
        self.assertTrue(policy.decide(self.sample(65,available_bytes=12*GIB-1)).paused)
        for t in range(70,190,5):self.assertTrue(policy.decide(self.sample(t,available_bytes=12*GIB)).paused)
        resumed=policy.decide(self.sample(190,available_bytes=12*GIB))
        self.assertFalse(resumed.paused);self.assertEqual(resumed.workers,2)
        self.assertEqual(resumed.memory_gib,16)
        # Recovery itself is not permission to jump back to peak concurrency.
        for t in range(195,310,5):self.assertEqual(policy.decide(self.sample(t)).workers,2)
        self.assertEqual(policy.decide(self.sample(310)).workers,3)

    def test_pressure_and_observation_gaps_restart_recovery(self):
        for interruption in ({'memory_pressure':'warning'},{'memory_pressure':'unknown'},
                             {'device_memory_known':False},{'swap_used_bytes':None}):
            with self.subTest(interruption=interruption):
                policy=AdaptivePolicy();policy.decide(self.sample(available_bytes=7*GIB))
                for t in range(5,120,5):self.assertTrue(policy.decide(self.sample(t)).paused)
                self.assertTrue(policy.decide(self.sample(120,**interruption)).paused)
                for t in range(125,245,5):self.assertTrue(policy.decide(self.sample(t)).paused)
                self.assertFalse(policy.decide(self.sample(245)).paused)
        policy=AdaptivePolicy();policy.decide(self.sample(available_bytes=7*GIB))
        policy.decide(self.sample(5))
        self.assertTrue(policy.decide(self.sample(500)).paused)
        for t in range(505,620,5):self.assertTrue(policy.decide(self.sample(t)).paused)
        self.assertFalse(policy.decide(self.sample(620)).paused)

    def test_initial_heartbeat_gap_does_not_start_memory_cooldown(self):
        policy=AdaptivePolicy()
        self.assertEqual(policy.decide(self.sample(device_memory_known=False)).reason,'device-memory-unknown')
        self.assertFalse(policy.decide(self.sample(5)).paused)
        # Actual host pressure still latches, even before a device heartbeat.
        policy=AdaptivePolicy()
        self.assertEqual(policy.decide(self.sample(device_memory_known=False,available_bytes=7*GIB)).reason,'memory-pressure')
        self.assertTrue(policy.decide(self.sample(5)).paused)

    def test_cpu_gating_and_sparse_observations_cannot_accumulate_quiet_time(self):
        for cpu in (50.01,150):
            policy=AdaptivePolicy()
            for t in range(0,250,5):self.assertEqual(policy.decide(self.sample(t,external_cpu_percent=cpu)).workers,2)
        policy=AdaptivePolicy()
        for t in (0,120,240,360):self.assertEqual(policy.decide(self.sample(t)).workers,2)
        for t in range(365,481,5):assigned=policy.decide(self.sample(t,external_cpu_percent=50))
        self.assertEqual(assigned.workers,3)

    def test_swap_growth_pauses_but_historical_usage_can_recover(self):
        policy=AdaptivePolicy()
        self.assertFalse(policy.decide(self.sample(swap_used_bytes=8*GIB)).paused)
        self.assertEqual(policy.decide(self.sample(5,swap_used_bytes=8*GIB+1)).reason,'swap-growth')
        for t in range(10,130,5):
            self.assertTrue(policy.decide(self.sample(t,swap_used_bytes=8*GIB+1)).paused)
        self.assertFalse(policy.decide(self.sample(130,swap_used_bytes=8*GIB+1)).paused)
        for value in (None,-1,True,float('nan')):
            self.assertTrue(AdaptivePolicy().decide(self.sample(swap_used_bytes=value)).paused)

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
