import hashlib,json,tempfile,unittest
from pathlib import Path
from righelt_training.allocation import Allocation,validate_continuation

class ContinuationTest(unittest.TestCase):
    def contract(self,root):
        checkpoint=root/'old.pt';checkpoint.write_bytes(b'historical checkpoint')
        proof=root/'diagnostic.json';proof.write_text(json.dumps({'workload':'restart-diagnostic-20-v1','diagnosticGatePassed':True,'allAttemptsAccounted':True,'terminalGames':16,'scheduledGames':20}))
        return {'sequenceId':'restart','phase':'six-hour','budgetSeconds':21600,'reserveSeconds':3600,
            'preserveState':True,'freshHealth':True,'recoveryCheckpoint':str(checkpoint),'recoverySha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
            'predecessorEvidence':str(proof),'predecessorEvidenceSha256':hashlib.sha256(proof.read_bytes()).hexdigest()}

    def test_authorization_and_recovery_are_distinct_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);contract=self.contract(root);run=root/'new';a=Allocation(root,run)
            first=a.create_continuation(contract);self.assertEqual(first,a.create_continuation(contract))
            self.assertEqual(first['seconds'],21600)
            self.assertEqual(validate_continuation(run,{'continuation':contract,'seconds':21600}),contract)
            with self.assertRaises(ValueError):Allocation(root,root/'duplicate').create_continuation(contract)
            with self.assertRaises(ValueError):validate_continuation(run,{'seconds':21600})
            changed={**contract,'budgetSeconds':43200}
            with self.assertRaises(ValueError):a.create_continuation(changed)
            Path(contract['recoveryCheckpoint']).write_bytes(b'changed')
            with self.assertRaises(ValueError):validate_continuation(run,{'continuation':contract,'seconds':21600})

    def test_failed_or_partial_predecessor_cannot_authorize(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);c=self.contract(root);path=Path(c['predecessorEvidence'])
            for field,value in [('terminalGames',15),('allAttemptsAccounted',False),('scheduledGames',19)]:
                data=json.loads(path.read_text());data[field]=value;path.write_text(json.dumps(data))
                c['predecessorEvidenceSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
                with self.assertRaises(ValueError):Allocation(root,root/'new').create_continuation(c)

    def test_overnight_requires_matching_audited_six_hour_handoff(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);c=self.contract(root);c.update(phase='twelve-hour',budgetSeconds=43200,reserveSeconds=7200)
            path=Path(c['predecessorEvidence'])
            data={'phase':'six-hour','sequenceId':c['sequenceId'],'advancementEligible':True,'health':{'healthy':True},'recoveryCheckpoint':c['recoveryCheckpoint'],'recoverySha256':c['recoverySha256']}
            path.write_text(json.dumps(data));c['predecessorEvidenceSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(Allocation(root,root/'overnight').create_continuation(c)['seconds'],43200)
            c['phase']='fourth'
            with self.assertRaises(ValueError):Allocation(root,root/'fourth').create_continuation(c)
