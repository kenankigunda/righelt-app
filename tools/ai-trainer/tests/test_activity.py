import unittest
from righelt_training.activity import observation


class ActivityTests(unittest.TestCase):
    def envelope(self,status='idle'):
        return {'observedAt':100,'projectId':'p','excludedThreadId':'self','expectedThreadIds':['other'],
                'snapshot':{'threads':[{'id':'other','kind':'codex','projectId':'p','status':status},
                                       {'id':'self','kind':'codex','projectId':'p','status':'active'}]}}

    def test_idle_and_busy(self):
        idle=observation(self.envelope(),120)
        self.assertFalse(idle['developmentActive']);self.assertEqual(idle['observedAt'],100)
        for status in ('active','notLoaded','waiting','unknown'):
            self.assertTrue(observation(self.envelope(status),120)['developmentActive'])

    def test_pinned_and_unavailable(self):
        e=self.envelope();e['snapshot']['pinnedThreads']=e['snapshot'].pop('threads')
        self.assertFalse(observation(e,120)['developmentActive'])
        e['snapshot']['unavailableHosts']=['local']
        self.assertTrue(observation(e,120)['developmentActive'])

    def test_missing_expected_and_new_task(self):
        e=self.envelope();e['snapshot']['threads']=[]
        self.assertTrue(observation(e,120)['developmentActive'])
        e=self.envelope();e['snapshot']['threads'].append({'id':'new','kind':'codex','projectId':'p','status':'active'})
        self.assertTrue(observation(e,120)['developmentActive'])

    def test_reject_stale_future_or_conflicting(self):
        for now in (99,161):
            with self.assertRaises(ValueError):observation(self.envelope(),now)
        e=self.envelope();e['snapshot']['pinnedThreads']=[{**e['snapshot']['threads'][0],'status':'active'}]
        with self.assertRaises(ValueError):observation(e,120)
