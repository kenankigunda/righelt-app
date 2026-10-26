import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
from righelt_training.curriculum import simple_root
from righelt_training.config import ROOT
from righelt_training.overall_evaluation import definition,jobs,report,run,capture_public_profiles,read_public_profiles


class OverallEvaluationTest(unittest.TestCase):
    def setUp(self):
        self.families=[{'familyId':f'family-{i}','seed':100+i,'initialState':simple_root(100+i),'openingFingerprint':str(i)*64}for i in range(6)]
        self.patch=patch('righelt_training.overall_evaluation.read_final_families',return_value={'families':self.families});self.patch.start();self.addCleanup(self.patch.stop)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.profiles=capture_public_profiles(Path(self.temp.name)/'profiles.json')
        self.plan=definition({'path':'/sealed.json','sha256':'a'*64},self.profiles)

    def test_matrix_preserves_matched_seeds_and_all_live_profiles(self):
        work=list(jobs(self.plan,'candidate','baseline'))
        self.assertEqual(len(work),54)
        self.assertEqual(sum(j['candidateSeat']is None for j in work),18)
        self.assertEqual(len({j['familyId']for j in work[:18]}),6)
        self.assertEqual({j['profile']for j in work[:18]},{'babs','tau','horus'})
        for start in range(0,54,3):
            group=work[start:start+3]
            self.assertEqual(len({j['seed']for j in group}),1)
            self.assertEqual(group[0]['modelVersions'],{'P1':'baseline','P2':'baseline'})
            self.assertEqual(group[1]['modelVersions']['P1'],'candidate')
            self.assertEqual(group[2]['modelVersions']['P2'],'candidate')

    def test_actual_worker_accepts_public_final_job_before_any_model_reply(self):
        job=next(jobs(self.plan,'candidate','baseline'))
        # Close stdin after the job. A first evaluate request proves contract
        # acceptance; no neural-network result is supplied or computed.
        result=subprocess.run(['node','--import','tsx','tools/ai-trainer/engine-worker.mjs'],input=json.dumps({**job,'budgetMs':3000})+'\n',capture_output=True,text=True,cwd=ROOT,timeout=10)
        messages=[json.loads(line)for line in result.stdout.splitlines()]
        self.assertTrue(any(m['type']=='evaluate'for m in messages),messages)
        self.assertFalse(any('Invalid training job'in m.get('message','')for m in messages))

    def test_unfinished_is_not_a_draw_or_terminal_score(self):
        group=self.plan['groups'][0]['id']
        result=report(self.plan,{group+'-control':{'outcome':'p1_win'},group+'-candidate-P1':{'outcome':'unfinished'},group+'-candidate-P2':{'outcome':'draw'}})
        self.assertEqual(result['completedTerminalCandidateGames'],1)
        self.assertEqual(result['terminalScores'][0]['score'],.5)
        self.assertEqual(result['unfinishedGames'],1)
        self.assertEqual(result['unattemptedGames'],51)
        self.assertFalse(result['automaticPromotion'])

    def test_resumed_evidence_is_verified_and_trajectories_are_deduplicated(self):
        def player(job,models,deadline):
            return {'status':'completed','game':{**job,'termination':'terminal','outcome':{'status':'p1_win'},'decisions':[],'finalHash':'f'*64}}
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            result=run(self.plan,root,{'candidate':object(),'baseline':object()},'candidate','baseline',1000,allocation=lambda:{'paused':False},heartbeat=lambda:None,player=player,clock=lambda:0)
            self.assertEqual(result['completedTerminalCandidateGames'],36)
            self.assertEqual(result['uniqueCompletedTrajectories'],len({json.dumps(f['initialState'],sort_keys=True)for f in self.families}))
            self.assertEqual(result['matchedLossesBaselineWon'],[])
            run(self.plan,root,{},'candidate','baseline',1000,allocation=lambda:{'paused':False},heartbeat=lambda:None,player=Mock(side_effect=AssertionError('No repeats')),clock=lambda:0)
            archive=next(root.glob('*.json.gz'));archive.write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError,'checksum'):run(self.plan,root,{},'candidate','baseline',1000,allocation=lambda:{'paused':False},heartbeat=lambda:None,player=player,clock=lambda:0)

if __name__=='__main__':unittest.main()
