import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from righelt_training.manifest import write_manifest,active_manifest,amend_manifest,manifest_hashes,dependency_inventory
from righelt_training.repair import resolved_failures
from righelt_training.health import check_attempt_history
from righelt_training.allocation import append

class RepairTests(unittest.TestCase):
    def test_source_epochs_preserve_original_and_contract(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original={'sourceRevision':'old','configSha256':'config','seed':107,'stage':'initial','seconds':21600}
            digest=write_manifest(root/'manifest.json',original);before=(root/'manifest.json').read_bytes()
            repair={'cause':'race','regressionEvidence':'passing regression','reviewEvidence':'independent review','artifactDisposition':'compatible'}
            newer=amend_manifest(root,{**original,'sourceRevision':'new'},repair)
            self.assertEqual((root/'manifest.json').read_bytes(),before)
            self.assertEqual(manifest_hashes(root),{digest,newer['sha256']})
            (root/'active-manifest.json').unlink() # Publication interrupted after durable amendment.
            self.assertEqual(active_manifest(root),newer)
            with self.assertRaises(ValueError):amend_manifest(root,{**original,'seconds':22000},repair)

    def test_failure_resolution_requires_later_recovery_and_unchanged_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);journal=root/'supervisor-attempts.jsonl'
            for row in [dict(event='started',id='old',phase='training',observedAt=1,pid=0),dict(event='finished',id='old',reason='runner-failed'),dict(event='started',id='new',phase='training',observedAt=2,pid=0),dict(event='finished',id='new',reason='completed')]:append(journal,row)
            with self.assertRaises(ValueError):check_attempt_history(root)
            proof=root/'proof';proof.write_text('verified')
            evidence=[{'path':str(proof),'sha256':hashlib.sha256(proof.read_bytes()).hexdigest()}]
            append(root/'failure-resolutions.jsonl',dict(failedAttempt='old',recoveryAttempt='new',cause='fixedrace',fixRevision='new',artifactDisposition='compatible',reviewEvidence=evidence,regressionEvidence=evidence))
            self.assertEqual(resolved_failures(root),{'old'});self.assertEqual(check_attempt_history(root),[])
            self.assertIn('runner-failed',journal.read_text())
            proof.write_text('changed')
            with self.assertRaises(ValueError):resolved_failures(root)

    def test_missing_dependency_path_never_means_unchanged(self):
        with patch('righelt_training.manifest.PROOF_PATHS',('packages/engine/src',)):
            with self.assertRaises(ValueError):dependency_inventory()
