import json,tempfile,time,unittest
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

    def test_email_uncertainty_requires_matching_reconciliation_and_no_changed_report(self):
        with tempfile.TemporaryDirectory() as d:
            s,r,e=self.setup_sequence(Path(d));s.claim(r,e);s.complete('diagnostic',self.diagnostic(Path(d)))
            intent=s.mail('diagnostic','claim')
            with self.assertRaises(ValueError):s.mail('diagnostic','confirmed-not-sent',{'matches':0})
            s.mail('diagnostic','confirmed-not-sent',{'notificationId':intent['id'],'searchedSentMail':True,'matches':0})
            s.mail('diagnostic','claim')
            Path(intent['report']).write_text('{}')
            with self.assertRaises(ValueError):s.mail('diagnostic','status')
