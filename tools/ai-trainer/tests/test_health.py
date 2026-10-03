import json
import tempfile
import time
from pathlib import Path
import unittest
import torch
from unittest.mock import patch
import psutil
from righelt_training import health
from righelt_training.checkpoint import save_checkpoint,atomic_json
from righelt_training.health import audit,check_attempt_history
from righelt_training.model import PolicyValueNet

class HealthTest(unittest.TestCase):
    def setUp(self):torch.set_num_threads(1)
    def fixture(self,directory,change):
        model=PolicyValueNet();optimizer=torch.optim.AdamW(model.parameters());updates=0
        atomic_json(directory/'manifest.json',{'sha256':'test'})
        (directory/'supervisor-attempts.jsonl').write_text(json.dumps({'event':'started','id':'training','phase':'training','pid':0})+'\n'+json.dumps({'event':'finished','id':'training','phase':'training','reason':'completed'})+'\n')
        for index in (1,2):
            if index==1 or change:
                optimizer.zero_grad();model(torch.ones(1,46,10,10))[0].sum().backward();optimizer.step();updates+=1
            path=directory/'checkpoints'/f'checkpoint-{index:06d}.pt'
            digest=save_checkpoint(path,model,optimizer,round_index=index,updates=updates,replay_ids=[],manifest_sha256='test',recovery_state={'round':index,'archives':[],'updates':updates,'nonzeroUpdates':updates})
        atomic_json(directory/'latest.json',{'checkpoint':str(path),'sha256':digest,'updates':updates})
        return path
    def test_repeated_checkpoint_bytes_do_not_count_as_distinct_trained_models(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);self.fixture(directory,False)
            result=audit(directory,time.monotonic()+30)
            self.assertTrue(result['complete']);self.assertFalse(result['healthy'])
            self.assertEqual(result['distinctRecoverableTrainedCheckpoints'],1)
    def test_recovery_corruption_and_budget_are_not_health_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);path=self.fixture(directory,True)
            result=audit(directory,time.monotonic()+30)
            self.assertEqual(result['distinctRecoverableTrainedCheckpoints'],2)
            self.assertTrue(result['finiteNonzeroUpdates']);self.assertFalse(result['healthy'])
            self.assertFalse(audit(directory,time.monotonic()-1)['complete'])
            path.write_bytes(path.read_bytes()+b'corrupt')
            result=audit(directory,time.monotonic()+30)
            self.assertEqual(result['unresolvedCorrectnessFailures'],1)
            self.assertFalse(result['healthy'])

    def test_later_success_does_not_erase_unresolved_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);self.fixture(directory,True)
            path=directory/'supervisor-attempts.jsonl'
            with path.open('a') as stream:
                for row in [
                    {'event':'started','id':'bad','phase':'training','pid':0},
                    {'event':'finished','id':'bad','phase':'training','reason':'runner-failed'},
                    {'event':'started','id':'arena','phase':'arena','pid':0},
                    {'event':'finished','id':'arena','phase':'arena','reason':'completed'}]:stream.write(json.dumps(row)+'\n')
            atomic_json(directory/'supervisor-result.json',{'reason':'completed'})
            with self.assertRaisesRegex(ValueError,'prior supervisor failure'):check_attempt_history(directory)
            self.assertEqual(audit(directory,time.monotonic()+30)['unresolvedCorrectnessFailures'],1)

    def test_health_cli_refuses_unsupervised_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);directory=root/'.ai-runs'/'initial';directory.mkdir(parents=True)
            atomic_json(directory/'runtime.json',{'bootTime':123,'supervisorPid':-1,'command':'health'})
            with patch.object(health,'ROOT',root),patch('psutil.boot_time',return_value=123),patch('sys.argv',['health','--run-dir',str(directory)]),patch.object(health,'audit') as audit_mock:
                with self.assertRaisesRegex(ValueError,'external supervisor'):health.main()
                audit_mock.assert_not_called()

    def test_handoff_timeout_stays_visible_while_checkpoint_recovery_is_audited(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);self.fixture(directory,True)
            path=directory/'supervisor-attempts.jsonl'
            path.write_text(path.read_text().replace('"reason": "completed"','"reason": "validation-handoff-timeout"'))
            result=audit(directory,time.monotonic()+30)
            self.assertTrue(result['complete']);self.assertFalse(result['healthy'])
            self.assertEqual(result['distinctRecoverableTrainedCheckpoints'],2)
            self.assertEqual(result['unfinishedAttempts'][0]['reason'],'validation-handoff-timeout')
            self.assertFalse(result['trainedExportParityPassed'])

if __name__=='__main__':unittest.main()
