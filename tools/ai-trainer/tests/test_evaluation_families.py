"""Pure protocol tests use synthetic proof records, never real final outcomes."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.evaluation_families import (family_aliases,family_from_anchors,
    commander_family,seal_final_families,read_final_families,FINAL_FAMILIES)
from righelt_training.replay import partition_for_family
from righelt_training.config import CONFIG

SOURCE='a'*40


def fixtures():
    entries=[];used=set()
    for row in range(10):
        for col in range(10):
            if (row,col)==(0,0):continue
            state={'pieces':[{'owner':'P1','kind':'commander','position':{'row':0,'col':0}},
                             {'owner':'P2','kind':'commander','position':{'row':row,'col':col}}]}
            family=family_from_anchors([('P1',0,0),('P2',row,col)])
            aliases=family_aliases(state)
            if partition_for_family(family)!='final'or aliases&used:continue
            h=hashlib.sha256(family.encode()).hexdigest()
            entries.append({'familyId':family,'initialState':state,'openingActions':[{'type':'pass'}],
                'openingFingerprint':h,'stateHash':h,'encodingHash':h,'engineProof':{
                    'passed':True,'initial':False,'sourceRevision':SOURCE,'fingerprint':h,'stateHash':h,'encodingHash':h}})
            used.update(aliases)
            if len(entries)==FINAL_FAMILIES:return entries
    raise AssertionError('Synthetic final families unavailable')


class EvaluationFamiliesTest(unittest.TestCase):
    def test_exact_six_distinct_final_families_and_both_seats_all_profiles(self):
        result=seal_final_families(fixtures(),source_revision=SOURCE)
        self.assertEqual(result['protocol']['independentFamilies'],6)
        self.assertEqual(result['protocol']['profiles'],['babs','tau','horus'])
        self.assertTrue(result['protocol']['seatSwapped'])
        self.assertFalse(result['protocol']['outcomesObserved'])

    def test_exposed_or_aliased_family_rejects(self):
        entries=fixtures();alias=next(iter(family_aliases(entries[0]['initialState'])))
        with self.assertRaisesRegex(ValueError,'exposed'):seal_final_families(entries,source_revision=SOURCE,forbidden_families={alias})
        entries[1]=copy.deepcopy(entries[0])
        with self.assertRaisesRegex(ValueError,'duplicated'):seal_final_families(entries,source_revision=SOURCE)

    def test_incomplete_family_count_or_engine_identity_rejects(self):
        with self.assertRaisesRegex(ValueError,'count'):seal_final_families(fixtures()[:-1],source_revision=SOURCE)
        for change in ('sourceRevision','encodingHash','initial'):
            entries=fixtures();entries[0]['engineProof'][change]=True if change=='initial'else'b'*64
            with self.assertRaises(ValueError):seal_final_families(entries,source_revision=SOURCE)

    def test_encoded_commander_family_matches_actual_anchor_contract(self):
        encoded=[0.]*4600;encoded[0]=1.;encoded[CONFIG['planes'].index('P2.commander')*100+79]=1.
        self.assertEqual(commander_family(encoded),family_from_anchors([('P1',0,0),('P2',7,9)]))
        encoded[1]=1.
        with self.assertRaises(ValueError):commander_family(encoded)

    def test_final_alias_cannot_relabel_a_nonfinal_actual_arrangement(self):
        entries=fixtures();state=entries[0]['initialState']
        for piece in state['pieces']:
            piece['position']['col']=9-piece['position']['col']
        actual=family_from_anchors([(p['owner'],p['position']['row'],p['position']['col'])for p in state['pieces']])
        self.assertNotEqual(actual,entries[0]['familyId'])
        self.assertIn(entries[0]['familyId'],family_aliases(state))
        with self.assertRaisesRegex(ValueError,'actual commander'):seal_final_families(entries,source_revision=SOURCE)

    def test_protocol_and_file_checksums_are_both_bound(self):
        result=seal_final_families(fixtures(),source_revision=SOURCE)
        with tempfile.TemporaryDirectory()as d:
            p=Path(d)/'protocol.json';p.write_text(json.dumps(result))
            binding={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            self.assertEqual(read_final_families(binding),result['protocol'])
            result['protocol']['outcomesObserved']=True;p.write_text(json.dumps(result))
            with self.assertRaises(ValueError):read_final_families(binding)


if __name__=='__main__':unittest.main()
