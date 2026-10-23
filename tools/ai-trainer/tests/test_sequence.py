import json,tempfile,time,unittest,fcntl,subprocess,sys
from unittest.mock import patch
from pathlib import Path
from righelt_training.sequence import Sequence,PREREQUISITE,digest,immutable,launch_ready
from righelt_training.allocation import Allocation,append
from righelt_training.activity import observation
from righelt_training import exploration_adoption as adoption
from exploration_fixture import publish_selection, receipt_fixture_validation

class SequenceTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(receipt_fixture_validation())

    def setup_sequence(self,root):
        root=root.resolve()
        control=root/'sequence';control.mkdir();a=root/'old.pt';a.write_bytes(b'942');b=root/'other.pt';b.write_bytes(b'842')
        diagnostic=root/'diagnostic';diagnostic.mkdir()
        allocation=Allocation(root,diagnostic)
        append(allocation.path,{'event':'created','allocation':allocation.key,'seconds':7200,'id':'evaluation','stage':'overnight'})
        config={'sequenceId':'approved','diagnosticDirectory':str(diagnostic),'sixHourDirectory':str(root/'six'),'twelveHourDirectory':str(root/'twelve'),
            'recoveryCheckpoint':str(a),'recoverySha256':digest(a),'opponentCheckpoint':str(b),'opponentSha256':digest(b),'diagnosticAllocationId':'evaluation'}
        immutable(control/'sequence.json',config)
        receipt={'threadId':PREREQUISITE,'completed':True,'evidence':'confirmed completed task turn','alertId':'alert-1','authorization':'sole prerequisite approved'}
        envelope={'observedAt':time.time(),'projectId':'righelt','excludedThreadId':'self','expectedThreadIds':[PREREQUISITE],
            'snapshot':{'threads':[{'id':PREREQUISITE,'kind':'codex','projectId':'righelt','status':'notLoaded'}]},'retiredTasks':{PREREQUISITE:receipt}}
        return Sequence(control),receipt,envelope

    def diagnostic(self,root,passed=True):
        path=root/'diagnostic'/'result.json';immutable(path,{'diagnosticGatePassed':passed,'allAttemptsAccounted':True,'terminalGames':16 if passed else 15,'scheduledGames':20,'workload':'restart-diagnostic-20-v1'})
        return path

    def health(self,sequence,phase,enabled=False):
        checkpoint=sequence.root/('six' if phase=='six-hour' else 'twelve')/'latest.pt';checkpoint.parent.mkdir(exist_ok=True);checkpoint.write_bytes(phase.encode())
        contract=json.loads((sequence.directory/'contracts'/f'{phase}.json').read_text())
        binding=publish_selection(Allocation(sequence.root,checkpoint.parent),enabled=enabled) if phase=='six-hour' else contract[adoption.FIELD]
        metadata={adoption.FIELD:binding,'trainingRecipe':adoption.read_binding(binding)['trainingRecipe']}
        path=checkpoint.parent/'stage-result.json';immutable(path,{**metadata,'advancementEligible':True,'sequenceId':'approved','phase':phase,
            'health':{'healthy':True,'freshHealthRequired':True,**metadata},'recoveryCheckpoint':str(checkpoint),'recoverySha256':digest(checkpoint)})
        return path

    def full_progression(self,enabled=False):
        with tempfile.TemporaryDirectory() as d:
            sequence,receipt,snapshot=self.setup_sequence(Path(d))
            self.assertEqual(sequence.claim(receipt,snapshot)['phase'],'diagnostic')
            sequence.complete('diagnostic',self.diagnostic(Path(d)))
            intent=sequence.mail('diagnostic','claim');sequence.mail('diagnostic','uncertain')
            with self.assertRaises(ValueError):sequence.mail('diagnostic','claim')
            six=sequence.claim(receipt,snapshot);self.assertEqual(six,sequence.claim(receipt,snapshot))
            self.assertEqual(Allocation(Path(d),six['runDirectory']).accounting()[0]['seconds'],21600)
            sequence.complete('six-hour',self.health(sequence,'six-hour',enabled))
            selected=json.loads(sequence.report_path('six-hour').read_text())
            self.assertEqual(selected['trainingRecipe']['id'],'root-dirichlet-v1' if enabled else 'baseline-v1')
            twelve=sequence.claim(receipt,snapshot)
            self.assertEqual(json.loads(Path(twelve['contract']).read_text())[adoption.FIELD],selected[adoption.FIELD])
            self.assertEqual(Allocation(Path(d),twelve['runDirectory']).accounting()[0]['seconds'],43200)
            sequence.complete('twelve-hour',self.health(sequence,'twelve-hour'))
            self.assertIsNone(sequence.next_phase());self.assertEqual(sequence.claim(receipt,snapshot)['action'],'finished-or-gate-unmet')
            sequence.mail('diagnostic','sent',{'notificationId':intent['id'],'messageId':'verified-connector-id'})
            self.assertEqual(sequence.mail('diagnostic','status')['status'],'sent')
            with self.assertRaises(ValueError):sequence.mail('diagnostic','claim')

    def test_full_progression_exact_caps_and_mail_failure_nonblocking(self):
        self.full_progression()

    def test_selected_exploration_continues_to_twelve_without_retuning(self):
        self.full_progression(enabled=True)

    def test_gate_failure_no_allocation_and_unrun_report_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e)
            evidence=self.diagnostic(Path(d),False);s.complete('diagnostic',evidence)
            self.assertIsNone(s.next_phase())
            with self.assertRaises(ValueError):s.complete('six-hour',evidence)
            self.assertFalse(Allocation(Path(d),Path(d)/'six').events())

    def test_failed_unselected_stage_reports_without_adopting_or_advancing(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)))
            claim=s.claim(r,e);path=Path(claim['runDirectory'])/'failed.json'
            immutable(path,{'phase':'six-hour','status':'inconclusive','reason':'screen gate unmet'})
            result=s.complete('six-hour',path)
            self.assertFalse(result['advancementEligible']);self.assertNotIn(adoption.FIELD,result)
            self.assertIsNone(s.next_phase());self.assertEqual(s.mail('six-hour','status')['status'],'pending')
            self.assertFalse((s.directory/'claims'/'twelve-hour.json').exists())

    def test_health_cannot_drop_the_selected_recipe(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)));s.claim(r,e)
            path=self.health(s,'six-hour');report=json.loads(path.read_text());report['health'].pop(adoption.FIELD)
            wrong=path.parent/'wrong.json';immutable(wrong,report)
            with self.assertRaisesRegex(ValueError,'health report'):s.complete('six-hour',wrong)
            self.assertFalse(s.report_path('six-hour').exists())

    def test_explicit_new_prerequisite_hold_prevents_any_stage_claim(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.config['launchHold']='Waiting for the additional task identity'
            with self.assertRaisesRegex(ValueError,'launch held'):s.claim(r,e)
            self.assertFalse((s.directory/'claims'/'diagnostic.json').exists())

    def test_every_added_task_requires_its_own_completion_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.prerequisites=[PREREQUISITE,'additional-task']
            with self.assertRaisesRegex(ValueError,'completion receipt'):s.claim(r,e)
            second={**r,'threadId':'additional-task','alertId':'second-alert'}
            with self.assertRaises(ValueError):s.claim({'receipts':[r,r]},e)
            self.assertEqual(s.claim({'receipts':[r,second]},e)['phase'],'diagnostic')

    def test_crash_after_report_reconciles_outbox_before_progression(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e)
            with patch.object(s,'ensure_mail_intent',side_effect=RuntimeError('power loss')):
                with self.assertRaises(RuntimeError):s.complete('diagnostic',self.diagnostic(Path(d)))
            self.assertTrue(s.report_path('diagnostic').exists())
            self.assertFalse((s.directory/'mail'/'diagnostic.json').exists())
            restored=Sequence(s.directory)
            self.assertEqual(restored.next_phase(),'six-hour')
            self.assertEqual(restored.mail('diagnostic','status')['status'],'pending')

    def test_historical_scope_does_not_hide_resumed_or_new_work(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));self.assertFalse(launch_ready(r,e)['developmentActive'])
            self.assertEqual(observation(e)['tasks'][PREREQUISITE],'notLoaded')
            e['snapshot']['threads'][0]['status']='active'
            with self.assertRaises(ValueError):s.claim(r,e)
            e['snapshot']['threads'][0]['status']='idle'
            e['snapshot']['threads'].append({'id':'new','kind':'codex','projectId':'righelt','status':'active'})
            with self.assertRaises(ValueError):s.claim(r,e)
            e['observedAt']=0
            with self.assertRaises(ValueError):s.claim(r,e)

    def test_new_development_between_stages_uses_adaptive_policy(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)))
            e['snapshot']['threads'][0]['status']='active'
            self.assertTrue(observation(e)['developmentActive'])
            self.assertEqual(s.claim(r,e)['phase'],'six-hour')

    def test_mail_cli_remains_usable_while_training_coordinator_is_locked(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)))
            with (s.root/'coordinator.lock').open('a+') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                for action in ('status','claim','uncertain'):
                    result=subprocess.run([sys.executable,'-m','righelt_training.sequence','--directory',str(s.directory),
                        'mail','--phase','diagnostic','--action',action],capture_output=True,text=True,timeout=10,check=True)
                    self.assertEqual(json.loads(result.stdout)['status'],{'claim':'sending'}.get(action,action if action!='status' else 'pending'))

    def test_email_uncertainty_requires_matching_reconciliation_and_no_changed_report(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)))
            intent=s.mail('diagnostic','claim')
            with self.assertRaises(ValueError):s.mail('diagnostic','confirmed-not-sent',{'matches':0})
            s.mail('diagnostic','confirmed-not-sent',{'notificationId':intent['id'],'searchedSentMail':True,'matches':0})
            s.mail('diagnostic','claim')
            Path(intent['report']).write_text('{}')
            with self.assertRaises(ValueError):s.mail('diagnostic','status')
