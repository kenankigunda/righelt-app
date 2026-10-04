import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
from righelt_training.admission import estimate,observe,restore_observations
from righelt_training.curriculum import Curriculum
from righelt_training.runner import Runner,default_state


class AdmissionTest(unittest.TestCase):
    def test_complete_and_censored_observations_bound_each_kind_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            state={}
            self.assertEqual(estimate(state,'normal')['requiredSeconds'],90)
            for seconds,censored in ((100,False),(1,False),(180,True)):
                observe(state,directory,job_id=str(seconds),kind='normal',phase='generation',seconds=seconds,censored=censored)
            observe(state,directory,job_id='replay',kind='normal',phase='replay',seconds=32,censored=False)
            self.assertEqual(estimate(state,'normal')['requiredSeconds'],275)
            self.assertEqual(estimate(state,'simple')['requiredSeconds'],90)
            self.assertEqual(state['admissionDurations']['normal:generation']['completedCount'],2)
            self.assertEqual(state['admissionDurations']['normal:generation']['censoredCount'],1)

    def test_journal_restores_uncheckpointed_evidence_once_after_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            state={};restore_observations(state,directory);checkpoint=copy.deepcopy(state)
            observe(state,directory,job_id='g',kind='normal',phase='generation',seconds=200,censored=True)
            restore_observations(checkpoint,directory);restore_observations(checkpoint,directory)
            self.assertEqual(state,checkpoint)
            self.assertEqual(checkpoint['admissionDurations']['normal:generation']['censoredCount'],1)
            Path(directory,'admission-durations.jsonl').write_text('')
            with self.assertRaisesRegex(ValueError,'truncated'):restore_observations(checkpoint,directory)

    def runner(self,directory):
        runner=Runner.__new__(Runner);runner.directory=Path(directory);runner.state=default_state()
        runner.seed=2;runner.stage='initial';runner.model_version='weights';runner.curriculum=Curriculum(2)
        runner.deadline=time.monotonic()+3600;runner.checkpoint=Mock()
        return runner

    def test_deferred_seed_and_kind_persist_then_launch_with_replay_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+30))
            pending=copy.deepcopy(runner.state['pendingGenerationJob'])
            self.assertEqual(runner.state['nextJob'],1);self.assertEqual(runner.state['generationLaunched'],0)
            runner.state=json.loads(json.dumps(runner.state))  # Checkpoint restoration.
            runner.curriculum=Mock(side_effect=AssertionError('cannot substitute a start'))
            runner.state['round']+=1
            job=runner.next_generation_job(time.monotonic()+120)
            self.assertEqual((job['id'],job['kind'],job['seed']),(pending['id'],pending['kind'],pending['seed']))
            self.assertIsNone(runner.state['pendingGenerationJob']);self.assertEqual(runner.state['nextJob'],1)
            self.assertEqual(runner.state['generationLaunched'],1)
            self.assertGreater(job['budgetMs'],80000);self.assertLess(job['budgetMs'],90001)
            self.assertEqual(runner.state['admissionDeferrals'],{pending['kind']:1})

    def test_unfinished_lower_bound_cannot_be_clipped_to_fit_fresh_round(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+30))
            pending=runner.state['pendingGenerationJob']
            observe(runner.state,directory,job_id='slow',kind=pending['kind'],phase='generation',seconds=500,censored=True)
            self.assertIsNone(runner.next_generation_job(time.monotonic()+600))
            self.assertEqual(runner.state['admissionStop'],'observed-game-bound-exceeds-round')
            self.assertEqual(runner.state['pendingGenerationJob'],pending)

    def test_rollback_to_deferred_checkpoint_cannot_relaunch_consumed_id(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory)
            runner.next_generation_job(time.monotonic()+30)
            checkpoint=copy.deepcopy(runner.state)
            launched=runner.next_generation_job(time.monotonic()+120)
            runner.state=checkpoint
            runner.restore_admission_claims()
            self.assertEqual(runner.state['admissionUnobservedClaims'],[launched['id']])
            resumed=runner.next_generation_job(time.monotonic()+120)
            self.assertNotEqual(resumed['id'],launched['id'])
            events=[json.loads(line) for line in Path(directory,'runner-events.jsonl').read_text().splitlines()]
            self.assertTrue(any(e['type']=='admission-pending-consumed' and e['id']==launched['id'] for e in events))
            self.assertNotIn('admissionDurations',runner.state)  # No invented duration or success.

    def test_recovered_completed_duration_is_not_reported_unobserved(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory);job=runner.next_generation_job(time.monotonic()+120)
            observe(runner.state,directory,job_id=job['id'],kind=job['kind'],phase='generation',seconds=5,censored=False)
            runner.restore_admission_claims()
            self.assertEqual(runner.state['admissionUnobservedClaims'],[])

    def test_global_runway_stops_and_checkpoint_overrun_does_not_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            runner=self.runner(directory);runner.deadline=time.monotonic()+70
            self.assertIsNone(runner.next_generation_job(runner.deadline-10))
            self.assertEqual(runner.state['admissionStop'],'insufficient-generation-runway')
            runner.deadline=1000
            with patch('righelt_training.runner.time.monotonic',side_effect=[100,125]):
                self.assertIsNone(runner.next_generation_job(200))
            self.assertEqual(runner.state['generationLaunched'],0)
            self.assertIsNotNone(runner.state['pendingGenerationJob'])

    def test_invalid_observation_never_appends(self):
        with tempfile.TemporaryDirectory() as directory:
            for seconds in (float('nan'),float('inf'),-1):
                with self.assertRaises(ValueError):
                    observe({},directory,job_id='x',kind='normal',phase='generation',seconds=seconds,censored=True)
            self.assertFalse(Path(directory,'admission-durations.jsonl').exists())


if __name__=='__main__':unittest.main()
