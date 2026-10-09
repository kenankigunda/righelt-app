import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from righelt_training.allocation import Allocation,append
from righelt_training.throughput import report,charged_seconds


class ThroughputTest(unittest.TestCase):
    def test_attempted_and_accepted_positions_remain_separate(self):
        events=[{'type':'decision-progress','gameId':game,'decision':{'id':f'{game}:{i}','policyMask':i!=1}}
                for game in ('accepted','verification-failed','unfinished','truncated') for i in range(3)]
        events += [events[0],  # Repeated observation is not additional useful data.
                   {'type':'generated-game','id':'accepted','valuePositions':3},
                   {'type':'generated-game','id':'verification-failed','valuePositions':3},
                   {'type':'generated-game','id':'truncated','valuePositions':0},
                   {'type':'game','id':'accepted','termination':'terminal','policyPositions':2,'valuePositions':3},
                   {'type':'game','id':'truncated','termination':'truncated','policyPositions':2,'valuePositions':0},
                   {'type':'unfinished-verification','id':'verification-failed'},
                   {'type':'unfinished','job':{'id':'unfinished'},'reason':'generation-bound'},
                   {'type':'admission-deferred','kind':'normal'},
                   {'type':'inference-batch','seconds':2}, {'type':'training-batch','seconds':1}]
        result=report(events,1800)
        self.assertEqual(result['observedAttemptedDecisions'],12)
        self.assertEqual(result['observedAttemptedPolicyPositions'],8)
        self.assertEqual(result['generatedValuePositionsBeforeReplay'],6)
        self.assertEqual(result['acceptedPolicyPositions'],4);self.assertEqual(result['acceptedValuePositions'],3)
        self.assertEqual(result['acceptedPolicyPositionsPerChargedHour'],8)
        self.assertEqual(result['acceptedValuePositionsPerChargedHour'],6)
        self.assertEqual(result['acceptedTerminalGamesPerChargedHour'],2)
        self.assertEqual(result['unfinishedGames'],2);self.assertEqual(result['deferralsByKind'],{'normal':1})
        self.assertEqual(result['measuredSeconds'],{'inference-batch':2,'training-batch':1})

    def test_missing_historical_counts_remain_explicit(self):
        result=report([{'type':'game','id':'old','termination':'terminal'}],0)
        self.assertEqual(result['legacyGamesWithoutPositionCounts'],['old'])
        self.assertEqual(result['acceptedPolicyPositions'],0)
        self.assertFalse(result['acceptedPositionCountsComplete'])
        self.assertIsNone(result['acceptedPolicyPositionsPerChargedHour'])
        with self.assertRaises(ValueError):report([],float('nan'))

    def test_charged_time_includes_uncertain_active_interval_not_repair_gap(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'run';allocation=Allocation(directory,target)
            allocation.create('initial')
            append(allocation.path,{'event':'started','allocation':allocation.key,'id':'one','wall':10,'monotonic':10,'boot':1})
            append(allocation.path,{'event':'finished','allocation':allocation.key,'id':'one','chargedSeconds':100})
            append(allocation.path,{'event':'started','allocation':allocation.key,'id':'two','wall':1000,'monotonic':2000,'boot':1})
            with patch('righelt_training.throughput.time.time',return_value=1060),patch('righelt_training.throughput.time.monotonic',return_value=2020),patch('righelt_training.throughput.psutil.boot_time',return_value=1):
                self.assertEqual(charged_seconds(target),160)


if __name__=='__main__':unittest.main()
