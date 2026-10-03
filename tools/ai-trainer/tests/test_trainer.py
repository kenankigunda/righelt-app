import time
import unittest
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

if __name__ == '__main__': unittest.main()
