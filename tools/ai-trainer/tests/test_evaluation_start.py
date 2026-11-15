import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.hosted_science import validate_schedule
from righelt_training.evaluation_start import expected_evaluation_starts,verify_evaluation_game_start


class EvaluationStartTest(unittest.TestCase):
    def test_scoped_schedule_uses_authoritative_start_and_same_board_in_both_seats(self):
        profiles={'profiles':{name:{} for name in ('babs','tau','horus')}}
        scope={'metric':'score','profiles':list(profiles['profiles']),'starts':['normal'],'seats':['P1','P2']}
        jobs=[{'id':name+seat,'pairId':name,'profile':name,'candidateSeat':seat,'role':'candidate',
               'partition':'validation','familyId':'family','sourceFamily':'source','seed':12,'gameSeconds':90,
               'startKind':'normal','kind':'normal'} for name in profiles['profiles'] for seat in ('P1','P2')]
        for job,identity in zip(jobs,expected_evaluation_starts(jobs)):job['startIdentity']=identity
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'families.json'
            file.write_text(json.dumps({'schema':1,'families':[{'id':'family','sourceFamily':'source','partition':'validation','startKind':'normal'}]}))
            binding={'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
            plan={'schema':1,'kind':'prospective-public-profile-evaluation','candidateSha256':'a'*64,'familyInventory':binding,
                  'profiles':profiles,'schedule':jobs,'primaryScope':scope}
            execution={'scientific':{'candidateSha256':'a'*64,'familyInventorySha256':binding['sha256']}}
            self.assertEqual(validate_schedule(plan,profiles,[j['id'] for j in jobs],execution),jobs)
            bad=copy.deepcopy(plan);bad['schedule'][0]['startIdentity']['stateHash']='b'*64
            with self.assertRaisesRegex(ValueError,'authoritative'):validate_schedule(bad,profiles,[j['id'] for j in jobs],execution)
            states=json.loads((Path(__file__).parent/'fixtures/s05-effects-v1.json').read_text())['cases']
            file.write_text(json.dumps({'schema':1,'families':[{'id':'family','sourceFamily':'source','partition':'validation','startKind':'developed'}]}))
            binding['sha256']=hashlib.sha256(file.read_bytes()).hexdigest();execution['scientific']['familyInventorySha256']=binding['sha256']
            plan['primaryScope']['starts']=['developed']
            for i,j in enumerate(jobs):j.update(startKind='developed',kind='simple',initialState=states[i%2]['rootState'])
            for j,identity in zip(jobs,expected_evaluation_starts(jobs)):j['startIdentity']=identity
            with self.assertRaisesRegex(ValueError,'same frozen start'):validate_schedule(plan,profiles,[j['id'] for j in jobs],execution)

    def test_self_consistent_wrong_game_root_is_not_the_frozen_start(self):
        states=json.loads((Path(__file__).parent/'fixtures/s05-effects-v1.json').read_text())['cases']
        job={'kind':'simple','startKind':'developed','initialState':states[0]['rootState']}
        job['startIdentity']=expected_evaluation_starts([job])[0]
        normalized=json.loads((Path(__file__).parent/'fixtures/evaluation-developed-start.json').read_text())
        good={'rootState':normalized,'initialState':normalized,'warmupActions':[]}
        self.assertEqual(verify_evaluation_game_start(job,good),job['startIdentity'])
        wrong={'rootState':states[1]['rootState'],'initialState':states[1]['rootState'],'warmupActions':[]}
        with self.assertRaisesRegex(ValueError,'start verification'):verify_evaluation_game_start(job,wrong)
        with self.assertRaisesRegex(ValueError,'start verification'):expected_evaluation_starts([{**job,'kind':'normal','startKind':'normal'}])


if __name__=='__main__':unittest.main()
