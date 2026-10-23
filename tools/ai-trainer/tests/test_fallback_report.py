import unittest
from righelt_training.fallback_report import observed_report

class FallbackReportTest(unittest.TestCase):
    def test_counts_decisions_in_unfinished_games_and_deduplicates_identity(self):
        def event(game,decision,fallback=None):
            return {'type':'decision-progress','gameId':game,'kind':'normal',
                    'decision':{'id':decision,'profileVersion':'hard','policyMask':not bool(fallback),'fallback':fallback}}
        first=event('a','a:0',{'reason':'safety-incomplete'})
        events=[first,first,event('a','a:1'),event('b','b:0'),{'type':'game','id':'b','termination':'terminal'},
                {'type':'unfinished','job':{'id':'a'},'reason':'generation-bound'}]
        report=observed_report(events);row=report['groups']['normal|hard']
        self.assertEqual(row['games'],2);self.assertEqual(row['decisions'],3)
        self.assertEqual(row['fallbackDecisions'],1);self.assertEqual(row['gameRate'],.5)
        self.assertAlmostEqual(row['decisionRate'],1/3);self.assertEqual(report['unfinishedGames'],1)
        conflict=event('a','a:0')
        with self.assertRaises(ValueError):observed_report([first,conflict])

if __name__=='__main__':unittest.main()
