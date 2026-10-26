import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.production import load_corpus, protected_encodings
from righelt_training.curriculum import Curriculum
from righelt_training.replay import ReplayBuffer, encoding_hash, partition_for_family


class ProductionTest(unittest.TestCase):
    def fixture(self, directory, *, leak=False):
        state={'outcome':{'status':'ongoing'}}
        value={'schema':1,'kind':'production-starts-v1','heldOut':['held'], 'positions':[
            {'gameId':'held' if leak else 'train','decisionId':'d','stateHash':'h',
             'state':state,'partition':'train','category':'opening','encodingHash':'a'*64,'sharedOpening':False}]}
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

    def test_all_replay_sources_and_generated_transpositions_exclude_unique_withheld_encoding(self):
        # Failing-first review regression: a normal start or inherited archive
        # must not reintroduce an encoding excluded from production starts.
        protected=encoding_hash([0.25,0.5])
        family=next(f'family-{i}' for i in range(100) if partition_for_family(f'family-{i}')=='train')
        buffer=ReplayBuffer(protected_encoding_hashes={protected})
        for source in ['normal','simple','continuation','production','inherited']:
            game={'id':source,'familyId':family,'partition':'train','termination':'terminal',
                  'outcome':{'status':'p1_win'},'decisions':[
                      {'id':source+':different-id-and-history','encoded':[0.25,0.5],
                       'legal':[0],'policy':[{'index':0,'probability':1.}]},
                      {'id':source+':safe','encoded':[0.5,0.25],
                       'legal':[0],'policy':[{'index':0,'probability':1.}]}]}
            original=json.dumps(game,sort_keys=True)
            buffer.append(game)
            self.assertEqual(json.dumps(game,sort_keys=True),original)
        self.assertEqual(len(buffer.positions),5)
        self.assertTrue(all(p['id'].endswith(':safe') for p in buffer.positions))
        self.assertEqual(buffer.protected_exclusions,{k:1 for k in ['normal','simple','continuation','production','inherited']})
        self.assertEqual(len(buffer.game_ids),5)  # Raw archive ancestry remains.

    def test_shared_opening_is_labeled_and_not_claimed_unseen(self):
        with tempfile.TemporaryDirectory() as d:
            binding=self.fixture(d);path=Path(binding['path']);corpus=json.loads(path.read_text())
            corpus['positions'].append({'gameId':'held','decisionId':'opening','stateHash':'shared',
                'state':{'outcome':{'status':'ongoing'}},'partition':'validation',
                'encodingHash':'b'*64,'sharedOpening':True})
            corpus['positions'].append({'gameId':'held','decisionId':'unique','stateHash':'unique',
                'state':{'outcome':{'status':'ongoing'}},'partition':'validation',
                'encodingHash':'c'*64,'sharedOpening':False})
            path.write_text(json.dumps(corpus));binding['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(protected_encodings(binding),{'c'*64})
            self.assertEqual(len(load_corpus(binding)),1)

    def test_protected_replay_rejects_missing_encoding_before_mutation(self):
        family=next(f'family-{i}' for i in range(100) if partition_for_family(f'family-{i}')=='train')
        b=ReplayBuffer(protected_encoding_hashes={'a'*64})
        with self.assertRaisesRegex(ValueError,'encoded position'):
            b.append({'id':'g','familyId':family,'partition':'train','termination':'terminal',
                      'outcome':{'status':'draw'},'decisions':[{'id':'d','legal':[0],'policy':[]}]})
        self.assertEqual(len(b.positions),0)
