import unittest
from collections import Counter
from righelt_training.curriculum import Curriculum, simple_root, family_for_root
from righelt_training.replay import partition_for_family

class CurriculumTest(unittest.TestCase):
    def test_repeatable_mixed_starts_and_partition_isolation(self):
        a, b = Curriculum(31), Curriculum(31)
        counts = Counter()
        for index in range(1000):
            job = a.job(index, 'checkpoint')
            self.assertEqual(job, b.job(index, 'checkpoint'))
            self.assertEqual(partition_for_family(job['familyId']), 'train')
            if job['initialState']:
                self.assertEqual(job['familyId'], family_for_root(job['initialState']))
                ids = {p['id']: p['owner'] for p in job['initialState']['pieces']}
                self.assertEqual(ids['C1'], 'P1'); self.assertEqual(ids['C2'], 'P2')
            counts[job['kind']] += 1
        self.assertTrue(540 < counts['normal'] < 660)
        self.assertTrue(190 < counts['simple'] < 310)
        self.assertTrue(90 < counts['continuation'] < 210)

    def test_curriculum_switch_once_at_one_hour_on_health_counts(self):
        c = Curriculum(1)
        self.assertFalse(c.observe(3599, 0, 99, 99))
        self.assertTrue(c.observe(3600, 99, 0, 99))
        self.assertFalse(c.observe(4000, 1000, 0, 1000))
        c = Curriculum(1)
        self.assertFalse(c.observe(3600, 100, 400, 500))
        self.assertTrue(c.observe(3601, 100, 401, 501))

    def test_family_is_root_identity_not_descendant_seed_or_kind(self):
        root = simple_root(10)
        self.assertEqual(family_for_root(root), family_for_root(dict(reversed(list(root.items())))))
        root['sideToMove'] = 'P1' if root['sideToMove'] == 'P2' else 'P2'
        root['pieces'] = [p for p in root['pieces'] if p['kind'] == 'commander']
        self.assertEqual(family_for_root(root), family_for_root(simple_root(10)))

if __name__ == '__main__': unittest.main()
