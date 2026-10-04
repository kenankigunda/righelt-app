import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from righelt_training.allocation import Allocation

class AllocationTests(unittest.TestCase):
    def setUp(self):
        for target,value in [('righelt_training.allocation.psutil.boot_time',1),('righelt_training.allocation.identity',{'pid':1,'created':1})]:
            patcher=patch(target,return_value=value);patcher.start();self.addCleanup(patcher.stop)

    def test_repairs_excluded_active_pauses_charged_no_reset(self):
        with tempfile.TemporaryDirectory() as d:
            a=Allocation(d,Path(d)/'run');a.create('initial')
            with patch('righelt_training.allocation.time.time',return_value=100),patch('righelt_training.allocation.time.monotonic',return_value=20):first,remaining,used=a.begin('training')
            with patch('righelt_training.allocation.time.time',return_value=160),patch('righelt_training.allocation.time.monotonic',return_value=50):a.finish(first['id'],reason='repair')
            self.assertEqual(a.accounting()[1],60)
            with patch('righelt_training.allocation.time.time',return_value=1000):
                self.assertEqual(a.accounting()[1],60)
                _,remaining,used=a.begin('training')
                self.assertEqual(remaining,21540)
            with self.assertRaises(ValueError):Allocation(d,Path(d)/'other').create('initial')

    def test_explicit_reset_retains_prior_and_uncertain_time_is_charged(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);old=root/'old';old.mkdir()
            (root/'budget-ledger.json').write_text(json.dumps({'stages':{'initial':str(old)}}))
            a=Allocation(root,root/'new');a.create('initial',reset_from=old,reason='User explicitly reset initial six-hour budget')
            first,_,_=a.begin('training')
            with patch('righelt_training.allocation.alive',return_value=True):
                with self.assertRaises(ValueError):a.recover_abandoned(lambda _:None)
            with patch('righelt_training.allocation.alive',return_value=False):a.recover_abandoned(lambda _:None)
            self.assertFalse(a.accounting()[2]);self.assertGreater(a.accounting()[1],0)
            self.assertEqual(a.events()[0]['resetFrom'],str(old.resolve()))

    def test_short_evaluation_allocation_cannot_expand_to_overnight_default(self):
        from righelt_training.allocation import append
        from righelt_training.budget import Budget
        with tempfile.TemporaryDirectory() as d:
            a=Allocation(d,Path(d)/'evaluation')
            append(a.path,{'event':'created','allocation':a.key,'stage':'overnight','seconds':7200,'id':'evaluation','authorization':'User approved two hours evaluation only'})
            self.assertEqual(a.create('overnight')['seconds'],7200)
            with patch('righelt_training.allocation.time.time',return_value=100),patch('righelt_training.allocation.time.monotonic',return_value=20):
                first,_,_=a.begin('export-parity')
            with patch('righelt_training.allocation.time.time',return_value=200),patch('righelt_training.allocation.time.monotonic',return_value=120):
                a.finish(first['id'],reason='completed')
                _,remaining,charged=a.begin('arena')
            self.assertEqual((remaining,charged),(7100,100))
            budget=Budget(120-charged,a.accounting()[0]['seconds'],200+remaining)
            self.assertEqual(budget.seconds,7200)
            with patch('righelt_training.budget.time.time',return_value=7300):
                self.assertEqual(budget.remaining(200),0)
