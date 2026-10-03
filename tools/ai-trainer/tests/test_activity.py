import unittest
from righelt_training.activity import observation

class ActivityTest(unittest.TestCase):
    def snapshot(self,status='idle',complete=True):
        return {'observedAt':10,'sourcesComplete':complete,'threads':[{'id':'self','projectId':'p','status':'active'},{'id':'other','projectId':'p','status':status}]}
    def test_self_excluded_other_active_throttles(self):
        self.assertFalse(observation(self.snapshot(),'p','self')['developmentActive'])
        self.assertTrue(observation(self.snapshot('active'),'p','self')['developmentActive'])
    def test_missing_unknown_or_partial_is_never_idle(self):
        for snap in [self.snapshot('notLoaded'),self.snapshot(complete=False),{'observedAt':10,'sourcesComplete':True,'threads':[]}]:
            self.assertIsNone(observation(snap,'p','self')['developmentActive'])

if __name__=='__main__':unittest.main()
