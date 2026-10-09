from contextlib import ExitStack, nullcontext
from pathlib import Path
import tempfile
import time
import sys
import unittest
from unittest.mock import Mock, patch

from righelt_training import bootstrap_worker
from righelt_training.checkpoint import atomic_json
from righelt_training.sequence import read


class BootstrapWorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.directory=self.root/'diagnostic';self.attempt=self.directory/'bootstrap'/'attempt'
        self.attempt.mkdir(parents=True)
        self.identity={'corpus':{'path':str(self.root/'corpus.json')},'checkpoint':{'path':str(self.root/'942.pt')}}
        atomic_json(self.root/'corpus.json',{})
        self.runtime={'command':'bootstrap-proof','supervisorPid':42,'allocationId':'existing','allocationInterval':'interval',
                      'deadlineMonotonic':time.monotonic()+1000}
        self.interval={'id':'interval','owner':{'pid':42}}
        atomic_json(self.attempt/'plan.json',{'runDirectory':str(self.directory),'runtime':self.runtime,
                    'identity':self.identity,'interval':self.interval,'remainingSeconds':1000})
        atomic_json(self.directory/'runtime.json',self.runtime)
        self.calls=[];self.monitor=Mock()
        self.monitor.__enter__=Mock(return_value=self.monitor);self.monitor.__exit__=Mock(return_value=False)
        self.monitor.operation=Mock(side_effect=lambda *args:nullcontext())
        self.numeric=Mock(side_effect=lambda:self.calls.append(list(sys.argv)))
        def search():
            self.calls.append(list(sys.argv));atomic_json(self.attempt/'native-search.json',{'complete':True})
        self.search=Mock(side_effect=search);self.process=Mock()
        stack=self.enterContext(ExitStack())
        for target,options in [
            ('righelt_training.bootstrap_worker.validate_identity',{'return_value':None}),
            ('righelt_training.bootstrap_worker.runtime_identity',{'return_value':{'fixture':True}}),
            ('righelt_training.bootstrap_worker.verify_corpus',{'return_value':[{}]*1000}),
            ('righelt_training.bootstrap_worker.Allocation.accounting',{'return_value':({'id':'existing'},0,[self.interval])}),
            ('righelt_training.bootstrap_worker.RunnerMonitor',{'return_value':self.monitor}),
            ('righelt_training.parity.main',{'new':self.numeric}),
            ('righelt_training.search_parity.main',{'new':self.search}),
            ('righelt_training.bootstrap_worker.subprocess.run',{'new':self.process}),
            ('os.getppid',{'return_value':42}),('os.getpid',{'return_value':43}),('os.getpgrp',{'return_value':43}),
        ]:stack.enter_context(patch(target,**options))

    def test_fixed_operations_select_mps_and_full_thousand_without_repair_cache(self):
        bootstrap_worker.run(self.attempt)
        self.assertTrue(read(self.attempt/'worker-complete.json')['complete'])
        self.assertIn('--require-mps',self.calls[0])
        search=self.calls[1]
        self.assertEqual(search[search.index('--limit')+1],'1000')
        self.assertEqual(search[search.index('--device')+1],'mps')
        self.assertNotIn('--repair-reference',search)
        commands=[call.args[0] for call in self.process.call_args_list]
        self.assertEqual(commands[0][-2:],[ 'corpus',str(self.attempt)])
        self.assertEqual(commands[2][-2:],[ 'browser',str(self.attempt)])
        self.assertTrue(all(call.kwargs['timeout']<=1000 for call in self.process.call_args_list))

    def test_unsupervised_worker_and_expired_or_partial_work_cannot_complete(self):
        with patch('os.getppid',return_value=99),self.assertRaisesRegex(ValueError,'external supervisor'):
            bootstrap_worker.run(self.attempt)
        self.numeric.assert_not_called()
        with patch.object(bootstrap_worker,'verify_corpus',return_value=[{}]*20),self.assertRaisesRegex(ValueError,'1000'):
            bootstrap_worker.run(self.attempt)
        self.search.side_effect=lambda:atomic_json(self.attempt/'native-search.json',{'complete':False})
        with self.assertRaisesRegex(ValueError,'incomplete'):bootstrap_worker.run(self.attempt)
        self.assertFalse((self.attempt/'worker-complete.json').exists())

    def test_closed_accounting_interval_cannot_start_worker(self):
        with patch.object(bootstrap_worker.Allocation,'accounting',return_value=({'id':'existing'},0,[])):
            with self.assertRaisesRegex(ValueError,'open charged interval'):bootstrap_worker.run(self.attempt)
        self.numeric.assert_not_called()


if __name__=='__main__':unittest.main()
