import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.production import load_corpus
from righelt_training.curriculum import Curriculum


class ProductionTest(unittest.TestCase):
    def fixture(self, directory, *, leak=False):
        state={'outcome':{'status':'ongoing'}}
        value={'schema':1,'kind':'production-starts-v1','heldOut':['held'], 'positions':[
            {'gameId':'held' if leak else 'train','decisionId':'d','stateHash':'h',
             'state':state,'partition':'train','category':'opening'}]}
        path=Path(directory)/'corpus.json';path.write_text(json.dumps(value))
        return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

    def test_corpus_identity_and_withheld_game_protection(self):
        with tempfile.TemporaryDirectory() as d:
            binding=self.fixture(d)
            self.assertEqual(len(load_corpus(binding)),1)
            with self.assertRaisesRegex(ValueError,'checksum'):
                load_corpus({**binding,'sha256':'wrong'})
            with self.assertRaisesRegex(ValueError,'leakage'):
                load_corpus(self.fixture(d,leak=True))

    def test_seeded_mix_and_source_identity_survive_restart(self):
        with tempfile.TemporaryDirectory() as d:
            b=self.fixture(d);a=Curriculum(107,production_corpus=b);c=Curriculum(107,production_corpus=b)
            for index in range(12):
                job=a.job(index,'model')
                self.assertEqual(job,c.job(index,'model'))
                self.assertEqual('productionSource' in job,index%4<2)
                if index%4<2:self.assertEqual(job['productionSource']['corpusSha256'],b['sha256'])
                if index%4==2:self.assertEqual(job['kind'],'normal')
