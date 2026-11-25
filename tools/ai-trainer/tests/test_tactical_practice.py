import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from righelt_training.tactical_practice import PracticeBatches, preference_loss, prepared_job
from righelt_training.witness_blocks import seal_completed, expanded_state


class TacticalPracticeTest(unittest.TestCase):
    def test_one_prepared_launch_per_eight_rotates_opponents_and_binds_actual_state(self):
        from righelt_training.replay import partition_for_family
        family=next('normal:'+str(i) for i in range(20) if partition_for_family('normal:'+str(i))=='train')
        starts=[{'id':str(i),'sourceFamily':family,'state':i,'stateHash':'exact-'+str(i),
                 'earlier':100+i,'earlierHash':'earlier-'+str(i)} for i in range(9)]
        chosen=[]
        for index in range(1397,1397+128):
            original={'teaching':{'cycle':(index//4+index)%4},'initialState':None}
            job=prepared_job(original,index,1397,starts)
            if 'tacticalStart' in job:
                src=starts[int(job['tacticalStart']['id'])]
                earlier=job['tacticalStart']['earlier']
                self.assertEqual(job['initialState'], src['earlier' if earlier else 'state'])
                self.assertEqual(job['tacticalStart']['stateHash'], src['earlierHash' if earlier else 'stateHash'])
                chosen.append(((index-1397)//8,job['teaching']['cycle'],earlier))
            else:self.assertIs(job,original)
        self.assertEqual([(block,role) for block,role,_ in chosen], [(i,i%4) for i in range(16)])
        self.assertEqual({earlier for _,_,earlier in chosen},{False,True})

    def test_active_clock_charges_both_arms_and_excludes_closed_interruptions(self):
        from righelt_training.campaign_supervisor import advance_clock
        record={'charged':0,'lastMonotonic':10,'firstWall':1000,'running':True}
        record=advance_clock(record,120,1110,False)
        record=advance_clock(record,200,1190,True)
        record=advance_clock(record,300,1290,False)
        self.assertEqual(record['charged'],210)
        with self.assertRaises(ValueError):advance_clock(record,299,1300,True)

    def test_schedules_use_identical_ordered_examples_and_last_exposure(self):
        ordinary = [{'id': i} for i in range(443)]
        lessons = [{'id': i, 'category': str(i % 4), 'sourceFamily': str(i % 3), 'preference': {}}
                   for i in range(19)]
        batches = PracticeBatches(ordinary, lessons, 711)
        samples = []
        for schedule in ('spaced', 'concentrated'):
            base, certificate, exposed = [], [], []
            for cursor in range(2048):
                batch = batches.batch(schedule, cursor)
                self.assertEqual(len(batch), 128)
                selected = [p['id'] for p in batch if 'preference' in p]
                if selected:
                    exposed.append(cursor)
                base.extend(p['id'] for p in batch if 'preference' not in p)
                certificate.extend(selected)
            self.assertEqual((len(base), len(certificate)), (260096, 2048))
            self.assertEqual((exposed[0], exposed[-1]), (0, 2047))
            self.assertEqual(len(exposed), 2048 if schedule == 'spaced' else 64)
            samples.append((base, certificate))
        self.assertEqual(samples[0], samples[1])
        self.assertTrue(all('preference' not in p for p in batches.batch('ordinary', 2047)))

    def test_multiple_valid_choices_and_unjudged_logit(self):
        logits = torch.tensor([[1., 2., -1., 7.]], requires_grad=True)
        row = {'policy': [], 'policyMask': False, 'terminalMask': False, 'legal': [0, 1, 2, 3],
               'preference': {'preferred': [0, 1], 'inferior': [2]}}
        loss = preference_loss(logits, [row], logits.sum() * 0)
        loss.backward()
        grad = logits.grad.tolist()[0]
        self.assertLess(grad[0], 0)
        self.assertLess(grad[1], 0)
        self.assertGreater(grad[2], 0)
        self.assertEqual(grad[3], 0)
        with self.assertRaises(ValueError):
            preference_loss(logits, [{**row, 'terminalMask': True}], logits.sum() * 0)

    def test_block_publication_interruption_missing_and_corrupt_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            state = {'updates': 682, 'freshTraining': {'batches': [
                {'update': i, 'policyExamples': [{'id': 'g' + str(i)}]} for i in range(170, 683)]}}
            original = copy.deepcopy(state)
            with patch('righelt_training.witness_blocks.os.link', side_effect=OSError('interrupted')):
                with self.assertRaises(OSError):
                    seal_completed(state, root)
            self.assertEqual(state, original)
            seal_completed(state, root)
            self.assertEqual(len(state['freshTraining']['batches']), 1)
            self.assertEqual(expanded_state(state, root), original)
            second = copy.deepcopy(original)
            seal_completed(second, root)
            files = list((Path(root) / 'batch-witnesses').iterdir())
            self.assertEqual(len(files), 2)
            data = files[0].read_bytes()
            files[0].write_bytes(gzip.compress(json.dumps([]).encode()))
            with self.assertRaisesRegex(ValueError, 'checksum'):
                expanded_state(state, root)
            files[0].write_bytes(data)
            files[0].unlink()
            with self.assertRaises(FileNotFoundError):
                expanded_state(state, root)
