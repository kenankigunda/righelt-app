import unittest
import tempfile
import gzip
import json
from righelt_training.replay import ReplayBuffer,partition_for_family,save_game

class ReplayTest(unittest.TestCase):
    def game(self,partition='train'):
        family=next(str(i) for i in range(1000) if partition_for_family(str(i))==partition)
        return {'id':'game-1','familyId':family,'partition':partition,'termination':'truncated','outcome':{'status':'ongoing'},'decisions':[{'id':'d1'}]}
    def test_truncations_have_no_value_target_and_archive_is_complete(self):
        g=self.game();b=ReplayBuffer();b.append(g)
        self.assertFalse(b.positions[0]['terminalMask'])
        with tempfile.TemporaryDirectory() as d:
            p=save_game(d,g)
            with gzip.open(p,'rt') as f:self.assertEqual(json.load(f),g)
            with self.assertRaises(ValueError):save_game(d,g)
    def test_sealed_families_and_duplicate_games_rejected(self):
        b=ReplayBuffer()
        for partition in ['validation','final']:
            with self.assertRaises(ValueError):b.append(self.game(partition))
        b.append(self.game())
        with self.assertRaises(ValueError):b.append(self.game())

if __name__=='__main__':unittest.main()
