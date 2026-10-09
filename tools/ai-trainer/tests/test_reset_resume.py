import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training.resume import validate_reset_checkpoint


class ResetResumeTest(unittest.TestCase):
    def test_reset_binds_authorized_predecessor_checkpoint_audit_and_recovery(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d).resolve()/'prior';(source/'checkpoints').mkdir(parents=True)
            checkpoint=source/'checkpoints'/'trained.pt';checkpoint.write_bytes(b'trained')
            digest=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            checkpoint.with_suffix('.json').write_text(json.dumps({'manifestSha256':'manifest'}))
            audit=Path(d)/'audit.json';audit.write_text(json.dumps({'passed':True,'sha256':digest,'updates':42}))
            gate={'resumeCheckpoint':{'checkpoint':str(checkpoint),'sha256':digest,'auditPath':str(audit),
                  'auditSha256':hashlib.sha256(audit.read_bytes()).hexdigest()}}
            creation={'resetFrom':str(source),'authorization':'User approved fresh12hours'}
            with patch('righelt_training.resume.manifest_hashes',return_value={'manifest'}),patch('righelt_training.resume.inspect_checkpoint',return_value={'updates':42,'optimizer':{'state':'bound'}}) as inspect:
                self.assertEqual(validate_reset_checkpoint(checkpoint,gate,creation)['updates'],42)
                inspect.assert_called_once_with(checkpoint,manifest_sha256='manifest',require_recovery=True)
                for bad in ({}, {'resetFrom':str(Path(d)/'unrelated'),'authorization':'approved'}):
                    with self.assertRaises(ValueError):validate_reset_checkpoint(checkpoint,gate,bad)
                with self.assertRaises(ValueError):validate_reset_checkpoint(None,gate,creation)
                with patch('righelt_training.resume.inspect_checkpoint',return_value={'updates':0,'optimizer':{}}):
                    with self.assertRaises(ValueError):validate_reset_checkpoint(checkpoint,gate,creation)
                audit.write_text('{}')
                with self.assertRaises(ValueError):validate_reset_checkpoint(checkpoint,gate,creation)
                checkpoint.write_bytes(b'altered')
                with self.assertRaises(ValueError):validate_reset_checkpoint(checkpoint,gate,creation)

if __name__=='__main__':unittest.main()
