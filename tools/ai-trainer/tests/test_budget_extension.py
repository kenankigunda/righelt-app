"""Additive authority/recovery fixtures. No model computation or extra allocation."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

from righelt_training import budget_extension as extension, continuation_policy as policy
from righelt_training.allocation import Allocation, append, contract_hash, validate_continuation
from righelt_training.budget import Budget, validation_boundary
from righelt_training.exploration_adoption import for_allocation
from righelt_training.exploration_receipt import ScreenBudget
from righelt_training.fresh_health import allocation_record
from righelt_training.sequence import immutable, read
from righelt_training.stage import remaining_budget
from exploration_fixture import publish_selection, receipt_fixture_validation
from test_eight_hour import setup


class BudgetExtensionTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(receipt_fixture_validation())
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.sequence, receipt, snapshot, amendment = setup(self.root)
        policy.register(self.sequence.directory, amendment)
        self.claim = self.sequence.claim(receipt, snapshot)
        self.run = Path(self.claim['runDirectory'])
        self.allocation = Allocation(self.root, self.run)
        self.adoption = publish_selection(self.allocation)
        with patch('time.time', return_value=2000), patch('time.monotonic', return_value=100):
            interval, _, _ = self.allocation.begin('training')
        with patch('time.time', return_value=2200), patch('time.monotonic', return_value=300):
            self.allocation.finish(interval['id'], reason='completed')
        self.before = self.allocation.events()
        self.creation, self.charged, _ = self.allocation.accounting()
        self.contract = read(self.claim['contract'])
        self.authority = self.root/'extension-authority.json'
        immutable(self.authority, {'verifiedHumanInstruction': True, 'threadId': 'human-thread',
            'instruction': 'Add an hour to training', 'allocationId': self.creation['id'],
            'originalBudgetSeconds': 28800, 'additionalTrainingSeconds': 3600, 'newBudgetSeconds': 32400,
            'reserveSeconds': 3600, 'sameExperiment': True, 'preserveHistoricalCharges': True})
        self.value = {'schema': 1, 'kind': extension.KIND, 'allocationId': self.creation['id'],
            'runDirectory': str(self.run), 'sequenceId': self.contract['sequenceId'],
            'originalBudgetSeconds': 28800, 'additionalTrainingSeconds': 3600, 'newBudgetSeconds': 32400,
            'reserveSeconds': 3600, 'sameExperiment': True, 'preserveHistoricalCharges': True, 'stopAfter': True,
            'originalContractSha256': contract_hash(self.contract),
            'accountingBeforeSha256': policy.accounting_hash(self.before),
            'chargedSecondsBefore': self.charged, 'authority': policy.reference(self.authority)}
        self.evidence = self.root/'extension.json'; immutable(self.evidence, self.value)

    def apply(self): return extension.apply_extension(self.allocation, self.evidence)

    def test_exactly_one_hour_preserves_originals_and_adoption(self):
        originals = {p: p.read_bytes() for p in (Path(self.claim['contract']), self.sequence.path,
                     policy.registry_path(self.root, self.contract['sequenceId']))}
        fresh_identity = allocation_record(self.run)
        event = self.apply()
        self.assertEqual(event, self.apply())
        creation, charged, pending = self.allocation.accounting()
        self.assertEqual((creation['seconds'], creation['originalSeconds'], charged, pending), (32400, 28800, self.charged, []))
        self.assertEqual(self.allocation.events()[:-1], self.before)
        self.assertEqual(allocation_record(self.run), fresh_identity)
        self.assertEqual(for_allocation(self.run, self.contract), self.adoption)
        validate_continuation(self.run, {'continuation': self.contract, 'seconds': 28800})
        with self.assertRaises(ValueError):
            validate_continuation(self.run, {'continuation': self.contract, 'seconds': 32400})
        self.assertEqual(remaining_budget(self.run), 32400-self.charged)
        for p, data in originals.items(): self.assertEqual(p.read_bytes(), data)
        self.assertEqual(sum(r['event']=='created' for r in self.allocation.events()), 1)

    def test_restart_and_later_intervals_use_extended_deadline_keep_reserve(self):
        self.apply(); allocation = Allocation(self.root, self.run)
        with patch('time.time', return_value=10000), patch('time.monotonic', return_value=1000):
            interval, remaining, charged = allocation.begin('training')
            runtime = {'startedMonotonic': 1000-charged, 'deadlineMonotonic': 1000+remaining,
                       'deadlineWall': 10000+remaining, 'reserveSeconds': 3600}
            self.assertEqual(validation_boundary(runtime,1000), 1000+remaining-3600)
            budget = Budget(1000-charged, allocation.accounting()[0]['seconds'], 10000+remaining)
            self.assertEqual(budget.remaining(1000), remaining)
        with patch('time.time', return_value=10100), patch('time.monotonic', return_value=1100):
            allocation.finish(interval['id'], reason='completed')
        self.assertEqual(allocation.accounting()[1], self.charged+100)
        for phase in ('export-parity', 'health', 'prepare-arena', 'arena'):
            interval, _, _ = allocation.begin(phase); allocation.finish(interval['id'], reason='completed')
        self.assertEqual(allocation.accounting()[0]['seconds'], 32400)

    def test_extra_hour_cannot_repeat_exploration_or_change_screen_history(self):
        plan = read(self.run/'exploration-screen/plan.json')
        before = ScreenBudget(self.allocation, plan).remaining()
        self.apply()
        self.assertEqual(ScreenBudget(self.allocation, plan).remaining(), before)
        for phase in ('exploration-screen', 'canary', 'diagnostic'):
            with self.assertRaisesRegex(ValueError, 'cannot repeat'): self.allocation.begin(phase)

    def test_tampered_authority_evidence_and_prefix_fail_closed(self):
        self.apply()
        for path in (self.authority, self.evidence):
            before = path.read_bytes(); path.write_text('{}')
            with self.assertRaises((ValueError,KeyError)): self.allocation.accounting()
            path.write_bytes(before)
        before = self.allocation.path.read_bytes()
        rows = [json.loads(line) for line in before.decode().splitlines()]
        next(r for r in rows if r.get('allocation')==str(self.run) and r['event']=='finished')['chargedSeconds'] += 1
        self.allocation.path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        with self.assertRaises(ValueError): self.allocation.accounting()

    def test_reject_changed_amount_reserve_identity_or_frozen_authority(self):
        for key, wrong in [('additionalTrainingSeconds',7200),('newBudgetSeconds',36000),('reserveSeconds',0),
                           ('allocationId','foreign'),('runDirectory',str(self.root/'other')),('stopAfter',False)]:
            self.evidence.write_text(json.dumps({**self.value,key:wrong}))
            with self.assertRaises(ValueError): self.apply()
        self.evidence.write_text(json.dumps(self.value)); self.apply()
        other = self.root/'different.json'; immutable(other,self.value)
        with self.assertRaisesRegex(ValueError,'already frozen'): extension.apply_extension(self.allocation,other)
        append(self.allocation.path,self.allocation.events()[-1])
        with self.assertRaisesRegex(ValueError,'only one'): self.allocation.accounting()

    def test_no_live_unsettled_finished_or_late_registration(self):
        interval,_,_=self.allocation.begin('training')
        with self.assertRaisesRegex(ValueError,'settle'): self.apply()
        self.allocation.finish(interval['id'],reason='completed')
        self.value['accountingBeforeSha256']=policy.accounting_hash(self.allocation.events())
        self.value['chargedSecondsBefore']=self.allocation.accounting()[1]
        self.evidence.write_text(json.dumps(self.value))
        ownership=self.run/'process-ownership.jsonl';append(ownership,{'pid':1,'created':1})
        with patch.object(extension,'owned_compute_absent',return_value=False):
            with self.assertRaisesRegex(ValueError,'owned compute'):self.apply()
        ownership.unlink()
        receipt=self.run/'phase-receipts/training.json';immutable(receipt,{})
        with self.assertRaisesRegex(ValueError,'finalized'):self.apply()
        receipt.unlink()
        immutable(self.run/'experiment-finished.json',{})
        with self.assertRaisesRegex(ValueError,'finished'):self.apply()
        (self.run/'experiment-finished.json').unlink()
        interval,_,_=self.allocation.begin('export-parity');self.allocation.finish(interval['id'],reason='completed')
        self.value['accountingBeforeSha256']=policy.accounting_hash(self.allocation.events())
        self.evidence.write_text(json.dumps(self.value))
        with self.assertRaisesRegex(ValueError,'before final audits'):self.apply()

    def test_cli_cannot_race_coordinator_or_supervisor(self):
        for name in ('coordinator.lock','supervisor.lock'):
            with (self.root/name).open('a+') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                result=subprocess.run([sys.executable,'-m','righelt_training.budget_extension',
                    '--archive',str(self.root),'--target',str(self.run),'--evidence',str(self.evidence)],
                    capture_output=True,text=True,timeout=15)
                self.assertNotEqual(result.returncode,0)
            self.assertEqual(self.allocation.events(),self.before)

    def test_detached_owned_descendant_after_leader_exit_blocks_extension(self):
        append(self.run/'process-ownership.jsonl',{'pid':123,'created':1,'group':123,'groupToken':'owned'})
        child=Mock(pid=456)
        child.create_time.return_value=2
        child.uids.return_value.real=extension.os.getuid()
        child.status.return_value='sleeping'
        child.environ.return_value={'RIGHELT_COMPUTE_GROUP_TOKEN':'owned'}
        with patch.object(extension.psutil,'process_iter',return_value=[child]):
            with self.assertRaisesRegex(ValueError,'owned compute'):self.apply()
            child.environ.return_value={}
            self.assertTrue(extension.owned_compute_absent(self.run))
            child.environ.side_effect=extension.psutil.AccessDenied(pid=456)
            with patch.object(extension.os,'getpgid',return_value=123):
                with self.assertRaises(extension.psutil.AccessDenied):self.apply()

    def test_final_report_uses_effective_budget_and_no_next_phase(self):
        self.apply()
        proof=self.run/'result.json'
        immutable(proof,{'experimentComplete':True,'health':{'healthy':False},
            'sequenceId':self.contract['sequenceId'],'phase':'eight-hour',
            'explorationAdoption':self.adoption,'trainingRecipe':read(self.adoption['path'])['trainingRecipe']})
        report=self.sequence.complete('eight-hour',proof)
        self.assertEqual((report['budgetSeconds'],report['originalBudgetSeconds']),(32400,28800))
        self.assertEqual(report['budgetExtension'],policy.reference(self.evidence))
        self.assertFalse(report['advancementEligible']);self.assertFalse(report['continuationAllowed'])
        self.assertIsNone(self.sequence.next_phase())
        with self.assertRaisesRegex(ValueError,'finished'):self.allocation.begin('training')


if __name__=='__main__':unittest.main()
