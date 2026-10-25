"""Pure engine-encoding facts and completed-turn masks, no NN calls."""
import unittest
from righelt_training.config import CONFIG
from righelt_training.replay import encoding_hash
from righelt_training.sequence_targets import board_facts,observed_future_targets,future_batch,TARGET_COUNT


def encoded(p1_supplied=True):
    result=[0.]*4600
    def mark(name,index):result[CONFIG['planes'].index(name)*100+index]=1.
    for player,index in [('P1',0),('P2',99)]:
        mark(player+'.commander',index)
        mark(player+'.commanded',index)
        if player=='P2'or p1_supplied:mark(player+'.supplied',index)
    return result


def decisions(turns):
    return [{'turnIndex':turn,'beforeHash':str(i),'afterHash':str(i+1),
             'controller':'P1'if i%2==0 else'P2','encoded':encoded(i%2==0)}
            for i,turn in enumerate(turns)]


class SequenceTargetsTest(unittest.TestCase):
    def test_board_facts_have_absolute_owner_and_supply_semantics(self):
        facts=board_facts(encoded(False))
        self.assertEqual(facts,[0.,1.,0.,0.,1.,1.,.5,.5])

    def test_completed_turn_horizons_ignore_forced_controller_changes(self):
        d=decisions([1,1,2,3,5])
        targets=observed_future_targets(d)
        self.assertEqual(sum(targets[0]['mask']),24)
        self.assertEqual(targets[0]['values'][:8],board_facts(d[2]['encoded']))
        self.assertEqual(targets[0]['values'][8:16],board_facts(d[3]['encoded']))
        self.assertEqual(targets[0]['values'][16:],board_facts(d[4]['encoded']))

    def test_missing_future_and_legacy_turns_stay_unknown(self):
        d=decisions([1,2])
        target=observed_future_targets(d)
        self.assertEqual(sum(target[0]['mask']),8)
        self.assertFalse(any(target[-1]['mask']))
        del d[0]['turnIndex']
        self.assertTrue(all(not any(x['mask'])for x in observed_future_targets(d)))

    def test_crossed_branch_and_backward_clock_reject(self):
        d=decisions([1,2]);d[1]['beforeHash']='other-branch'
        with self.assertRaisesRegex(ValueError,'discontinuous'):observed_future_targets(d)
        with self.assertRaisesRegex(ValueError,'turn'):observed_future_targets(decisions([2,1]))

    def test_protected_future_encoding_never_becomes_a_training_label(self):
        d=decisions([1,2]);protected={encoding_hash(d[1]['encoded'])}
        self.assertFalse(any(observed_future_targets(d,protected_encodings=protected)[0]['mask']))

    def test_skipped_unobserved_turn_is_not_filled(self):
        d=decisions([1,3])
        t=observed_future_targets(d)[0]
        self.assertFalse(any(t['mask'][:8]))
        self.assertTrue(all(t['mask'][8:16]))

    def test_future_batch_masks_unknowns_and_rejects_invalid_labels(self):
        values,masks=future_batch([{}])
        self.assertEqual(len(values[0]),TARGET_COUNT)
        self.assertFalse(any(masks[0]))
        for target in [{'values':[0.]*TARGET_COUNT,'mask':[1]*TARGET_COUNT},
                       {'values':[2.]*TARGET_COUNT,'mask':[True]*TARGET_COUNT},
                       {'values':[float('nan')]*TARGET_COUNT,'mask':[False]*TARGET_COUNT}]:
            with self.assertRaises(ValueError):future_batch([{'futureFacts':target}])


if __name__=='__main__':unittest.main()
