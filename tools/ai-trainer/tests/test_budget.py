import unittest
from unittest.mock import patch
from righelt_training.budget import Budget,effective_deadline

class BudgetWallClockTest(unittest.TestCase):
    def test_suspend_or_forward_wall_time_cannot_extend_allocation(self):
        budget=Budget(100,60,wall_deadline=1060)
        with patch('righelt_training.budget.time.time',return_value=1061):
            self.assertEqual(budget.remaining(110),0)
            self.assertFalse(budget.may_start(110,1))
    def test_backward_wall_time_cannot_extend_monotonic_deadline(self):
        budget=Budget(100,60,wall_deadline=1060)
        with patch('righelt_training.budget.time.time',return_value=900):self.assertEqual(budget.remaining(160),0)
    def test_child_uses_remaining_wall_allocation_without_mutating_runtime(self):
        runtime={'deadlineMonotonic':200,'deadlineWall':1060}
        with patch('righelt_training.budget.time.time',return_value=1055),patch('righelt_training.budget.time.monotonic',return_value=100):
            self.assertEqual(effective_deadline(runtime),105)
        self.assertEqual(runtime['deadlineMonotonic'],200)

if __name__=='__main__':unittest.main()
