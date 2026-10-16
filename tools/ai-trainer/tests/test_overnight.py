import json,tempfile,hashlib,unittest
from pathlib import Path
from righelt_training.supervisor import validate_overnight_checkpoint

class OvernightTests(unittest.TestCase):
    def test_random_or_unrelated_checkpoint_is_rejected(self):
        with self.assertRaises(ValueError):validate_overnight_checkpoint(None,{})
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'checkpoints').mkdir();p=root/'checkpoints'/'model.pt';p.write_bytes(b'audited')
            digest=hashlib.sha256(p.read_bytes()).hexdigest()
            (root/'manifest.json').write_text(json.dumps({'sha256':'x','manifest':{'stage':'initial'}}))
            health={'healthy':True,'progressReportPublished':False,'checkpoints':[{'sha256':digest}]}
            (root/'health-report.json').write_text(json.dumps(health))
            (root/'latest.json').write_text(json.dumps({'checkpoint':str(p.resolve()),'sha256':digest}))
            gate={'health':{**health,'progressReportPublished':True}}
            self.assertEqual(validate_overnight_checkpoint(p,gate)['sha256'],digest)
            p.write_bytes(b'other')
            with self.assertRaises(ValueError):validate_overnight_checkpoint(p,gate)
