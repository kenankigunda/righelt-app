import hashlib
import json
from pathlib import Path
import tempfile
import time
from argparse import Namespace
import unittest
from unittest.mock import patch
from righelt_training.export_parity import evaluate
from righelt_training.health import trained_export_proof
from righelt_training.supervisor import parity_arguments
from righelt_training.config import CONFIG_SHA256
from righelt_training.checkpoint import atomic_json


class ExportParityTest(unittest.TestCase):
    def fixture(self,d):
        root=Path(d);checkpoint=root/'checkpoint.pt';checkpoint.write_bytes(b'trained')
        digest=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        atomic_json(checkpoint.with_suffix('.json'),{'updates':1})
        atomic_json(root/'latest.json',{'sha256':digest})
        corpus=root/'corpus.json';corpus.write_text('{}')
        corpus_hash=hashlib.sha256(corpus.read_bytes()).hexdigest()
        atomic_json(root/'runtime.json',{'parityCorpusSha256':corpus_hash,'parityCorpusPath':str(corpus)})
        manifest={'sha256':'manifest','manifest':{'sourceRevision':'source'}}
        atomic_json(root/'manifest.json',manifest)
        atomic_json(root/'allocation.json',{'paused':False,'workers':2,'stop':False})
        return root,checkpoint,corpus,manifest

    def test_supervised_trained_numeric_result_and_health_identity_checks(self):
        with tempfile.TemporaryDirectory() as d:
            root,checkpoint,corpus,manifest=self.fixture(d)
            rows=[{'encoded':[0.0]*4600}]*1000
            with patch('righelt_training.export_parity.verify_corpus',return_value=rows),patch('torch.backends.mps.is_available',return_value=True),patch('righelt_training.export_parity.load_checkpoint'),patch('righelt_training.export_parity.export_onnx',return_value={'sha256':'model'}):
                report=evaluate(root,checkpoint,corpus,time.monotonic()+60,checker=lambda *a,**k:{'numericPassed':True,'maxAbsoluteError':[1e-8,2e-8]})
            self.assertTrue(report['complete'],report);self.assertEqual(report['heldoutStates'],1000)
            latest=json.loads((root/'latest.json').read_text())
            self.assertTrue(trained_export_proof(root,latest,manifest))
            for field,value in [('checkpointSha256','stale'),('corpusSha256','stale'),('configSha256','stale'),('heldoutStates',999),('complete',False),('trainedCheckpoint',False),('referenceDevice','cpu'),('maxAbsoluteError',[float('nan'),0])]:
                invalid={**report,field:value}
                (root/'trained-export-parity.json').write_text(json.dumps(invalid))
                self.assertFalse(trained_export_proof(root,latest,manifest),field)
            atomic_json(root/'trained-export-parity.json',report);corpus.write_text('changed')
            self.assertFalse(trained_export_proof(root,latest,manifest))

    def test_expiry_and_failed_numeric_report_remain_incomplete(self):
        with tempfile.TemporaryDirectory() as d:
            root,checkpoint,corpus,_=self.fixture(d)
            result=evaluate(root,checkpoint,corpus,time.monotonic())
            self.assertFalse(result['complete']);self.assertFalse(result['numericPassed'])
            with patch('righelt_training.export_parity.verify_corpus',return_value=[{'encoded':[0.0]*4600}]*1000),patch('torch.backends.mps.is_available',return_value=True),patch('righelt_training.export_parity.load_checkpoint'),patch('righelt_training.export_parity.export_onnx',return_value={}):
                report=evaluate(root,checkpoint,corpus,time.monotonic()+60,checker=lambda *a,**k:{'numericPassed':True,'maxAbsoluteError':[float('nan'),0]})
            self.assertFalse(report['complete']);self.assertTrue(report['failed'])

    def test_supervisor_phase_requires_existing_run_corpus_and_is_exclusive(self):
        with tempfile.TemporaryDirectory() as d:
            root,checkpoint,corpus,_=self.fixture(d)
            args=Namespace(export_parity=True,parity_corpus=corpus,arena_plan=None,prepare_arena=False,health=False,resume=checkpoint,run_dir=root)
            self.assertEqual(parity_arguments(args,root),hashlib.sha256(corpus.read_bytes()).hexdigest())
            for field,value in [('health',True),('prepare_arena',True),('arena_plan',root/'plan.json'),('resume',None),('parity_corpus',Path('/outside'))]:
                old=getattr(args,field);setattr(args,field,value)
                with self.assertRaises(ValueError):parity_arguments(args,root)
                setattr(args,field,old)

if __name__=='__main__':unittest.main()
