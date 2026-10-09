import unittest
from righelt_training.evaluation import score_game,paired_report

class EvaluationTest(unittest.TestCase):
    def test_truncated_is_conservative_not_draw(self):
        self.assertEqual(score_game('truncated','P1'),0)
        self.assertEqual(score_game('draw','P1'),.5)
        with self.assertRaises(ValueError):score_game('ongoing','P1')

    def pairs(self):
        return [{'id':str(i),'kind':'normal' if i<50 else 'heldout','games':[{'candidateSeat':'P1','outcome':'p1_win'},{'candidateSeat':'P2','outcome':'p2_win'}]} for i in range(100)]

    def test_complete_pairs_pass_and_incomplete_never_pass(self):
        pairs=self.pairs()
        self.assertTrue(paired_report(pairs,42)['passed'])
        self.assertFalse(paired_report(pairs[:10],42)['passed'])
        with self.assertRaises(ValueError):paired_report(pairs+[pairs[0]],42)

    def test_truncation_cap_is_gate(self):
        pairs=self.pairs()
        for i in range(11):pairs[i]['games'][0]['outcome']='truncated'
        self.assertFalse(paired_report(pairs,42)['passed'])

if __name__=='__main__':unittest.main()
