import json,tempfile,time,unittest,fcntl,subprocess,sys
from unittest.mock import patch
from pathlib import Path
from righelt_training.sequence import Sequence,PREREQUISITE,digest,immutable,launch_ready
from righelt_training.allocation import Allocation,append
from righelt_training.activity import observation

class SequenceTest(unittest.TestCase):
    def setup_sequence(self,root):
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

    def health(self,sequence,phase):
        checkpoint=sequence.root/('six' if phase=='six-hour' else 'twelve')/'latest.pt';checkpoint.parent.mkdir(exist_ok=True);checkpoint.write_bytes(phase.encode())
        path=checkpoint.parent/'stage-result.json';immutable(path,{'advancementEligible':True,'sequenceId':'approved','phase':phase,
            'health':{'healthy':True,'freshHealthRequired':True},'recoveryCheckpoint':str(checkpoint),'recoverySha256':digest(checkpoint)})
        return path

    def test_full_progression_exact_caps_and_mail_failure_nonblocking(self):
        with tempfile.TemporaryDirectory() as d:
            sequence,receipt,snapshot=self.setup_sequence(Path(d))
            self.assertEqual(sequence.claim(receipt,snapshot)['phase'],'diagnostic')
            sequence.complete('diagnostic',self.diagnostic(Path(d)))
            intent=sequence.mail('diagnostic','claim');sequence.mail('diagnostic','uncertain')
            with self.assertRaises(ValueError):sequence.mail('diagnostic','claim')
            six=sequence.claim(receipt,snapshot);self.assertEqual(six,sequence.claim(receipt,snapshot))
            self.assertEqual(Allocation(Path(d),six['runDirectory']).accounting()[0]['seconds'],21600)
            sequence.complete('six-hour',self.health(sequence,'six-hour'))
            twelve=sequence.claim(receipt,snapshot)
            self.assertEqual(Allocation(Path(d),twelve['runDirectory']).accounting()[0]['seconds'],43200)
            sequence.complete('twelve-hour',self.health(sequence,'twelve-hour'))
            self.assertIsNone(sequence.next_phase());self.assertEqual(sequence.claim(receipt,snapshot)['action'],'finished-or-gate-unmet')
            sequence.mail('diagnostic','sent',{'notificationId':intent['id'],'messageId':'verified-connector-id'})
            self.assertEqual(sequence.mail('diagnostic','status')['status'],'sent')
            with self.assertRaises(ValueError):sequence.mail('diagnostic','claim')

    def test_gate_failure_no_allocation_and_unrun_report_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e)
            evidence=self.diagnostic(Path(d),False);s.complete('diagnostic',evidence)
            self.assertIsNone(s.next_phase())
            with self.assertRaises(ValueError):s.complete('six-hour',evidence)
            self.assertFalse(Allocation(Path(d),Path(d)/'six').events())

    def test_explicit_new_prerequisite_hold_prevents_any_stage_claim(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.config['launchHold']='Waiting for the additional task identity'
            with self.assertRaisesRegex(ValueError,'launch held'):s.claim(r,e)
            self.assertFalse((s.directory/'claims'/'diagnostic.json').exists())

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
