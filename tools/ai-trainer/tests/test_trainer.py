import time
import unittest
from contextlib import contextmanager
import torch
from array import array
from righelt_training.model import PolicyValueNet
from righelt_training.trainer import tensor_batch, train_round, make_optimizer


def position(index=0):
    return {'id': str(index), 'encoded': [0.] * 4600, 'legal': [0, 2800],
            'policy': [{'index': 0, 'probability': 1.}], 'terminalValue': 0., 'terminalMask': False}


class TrainerTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(7)

    def test_finite_nonzero_update_masks_truncated_value(self):
        model = PolicyValueNet()
        metrics = []
        compact = position(0); compact['encoded'] = array('f', compact['encoded'])
        result = train_round(model, make_optimizer(model), [compact, position(1)],
                             device='cpu', seed=3, deadline=time.monotonic()+60, on_batch=metrics.append)
        self.assertEqual(result['updates'], 1)
        self.assertEqual(result['nonzeroUpdates'], 1)
        self.assertEqual(metrics[0]['valueLoss'], 0)
        self.assertGreater(metrics[0]['parameterDelta'], 0)
        self.assertFalse(model.training)

    def test_budget_pause_and_restart_cursor_do_not_repeat_updates(self):
        for options in ({'deadline': time.monotonic()+1},
                        {'deadline': time.monotonic()+60, 'should_pause': lambda: True},
                        {'deadline': time.monotonic()+60, 'start_batch': 1}):
            model = PolicyValueNet()
            result = train_round(model, make_optimizer(model), [position()], device='cpu', seed=3, **options)
            self.assertEqual(result['updates'], 0)

    def test_invalid_targets_and_inputs_rejected(self):
        bad = position(); bad['legal'] = [0, 0]
        with self.assertRaises(ValueError): tensor_batch([bad], 'cpu')
        bad = position(); bad['encoded'][0] = float('nan')
        with self.assertRaises(ValueError): tensor_batch([bad], 'cpu')
        bad = position(); bad['policy'][0]['probability'] = float('inf')
        with self.assertRaises(ValueError): tensor_batch([bad], 'cpu')

    def test_actual_sampled_game_counts_preserve_loss_masks(self):
        first = position(); first.update(gameId='old', terminalMask=True, terminalValue=1.)
        second = position(1); second.update(gameId='new', policyMask=False, policy=[])
        third = position(2); third.update(gameId='new', terminalMask=True, terminalValue=-1.)
        model = PolicyValueNet(); metrics = []
        train_round(model, make_optimizer(model), [first, second, third], device='cpu', seed=3,
                    deadline=time.monotonic()+60, on_batch=metrics.append)
        self.assertEqual(metrics[0]['sampledGames'], [
            {'gameId': 'new', 'positions': 2, 'policyPositions': 1, 'valuePositions': 1},
            {'gameId': 'old', 'positions': 1, 'policyPositions': 1, 'valuePositions': 1}])
        self.assertEqual(metrics[0]['policyPositions'], 2)
        self.assertEqual(metrics[0]['valuePositions'], 2)

    def test_batch_watchdog_excludes_checkpoint_callback_and_propagates_timeout(self):
        active=[];bounds=[];callbacks=[]
        @contextmanager
        def operation(name,seconds):
            active.append(name);bounds.append(seconds)
            try:yield
            finally:active.pop()
        def checkpoint(metrics):
            self.assertEqual(active,[]);callbacks.append(metrics)
        model=PolicyValueNet()
        result=train_round(model,make_optimizer(model),[position()],device='cpu',seed=3,
            deadline=time.monotonic()+60,operation=operation,on_batch=checkpoint)
        self.assertEqual(bounds,[30.]);self.assertEqual(len(callbacks),1);self.assertEqual(result['updates'],1)
        @contextmanager
        def expired(name,seconds):
            raise TimeoutError('operation watchdog');yield
        before=model.stem.weight.detach().clone()
        with self.assertRaises(TimeoutError):
            train_round(model,make_optimizer(model),[position()],device='cpu',seed=3,
                deadline=time.monotonic()+60,operation=expired,on_batch=checkpoint)
        self.assertTrue(torch.equal(before,model.stem.weight));self.assertEqual(len(callbacks),1)

if __name__ == '__main__': unittest.main()
