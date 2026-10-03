import json
import tempfile
import time
from pathlib import Path
import unittest
import torch
from righelt_training.checkpoint import save_checkpoint,atomic_json
from righelt_training.health import audit
from righelt_training.model import PolicyValueNet

class HealthTest(unittest.TestCase):
    def setUp(self):torch.set_num_threads(1)
    def fixture(self,directory,change):
        model=PolicyValueNet();optimizer=torch.optim.AdamW(model.parameters());updates=0
        atomic_json(directory/'manifest.json',{'sha256':'test'})
        for index in (1,2):
            if index==1 or change:
                optimizer.zero_grad();model(torch.ones(1,46,10,10))[0].sum().backward();optimizer.step();updates+=1
            path=directory/'checkpoints'/f'checkpoint-{index:06d}.pt'
            digest=save_checkpoint(path,model,optimizer,round_index=index,updates=updates,replay_ids=[],manifest_sha256='test')
            atomic_json(path.with_suffix('.runner.json'),{'checkpointSha256':digest,'state':{'archives':[],'updates':updates,'nonzeroUpdates':updates}})
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

if __name__=='__main__':unittest.main()
