import copy
import unittest
from righelt_training.evaluation import prospective_report,paired_arm_report,paired_report


SCOPE={'metric':'score','profiles':['horus','babs'],'starts':['normal','developed'],'seats':['P1','P2']}
UNCERTAINTY={'confidence':.95,'seed':123,'resamples':200}


def schedule(prefix):
    # Synthetic reporting fixtures. Live admission obtains identities from shared rules.
    return [{'id':prefix+profile+start+seat,'pairId':profile+start,'candidateSeat':seat,
             'profile':profile,'startKind':start,'familyId':profile+start,'sourceFamily':profile+start,
             'role':'candidate','seed':42,'kind':'normal' if start=='normal' else 'simple',
             **({} if start=='normal' else {'initialState':{'boardSize':10,'fixture':'developed-start'}}),
             'startIdentity':{'schema':1,'startKind':start,'kind':'normal' if start=='normal' else 'simple','stateHash':'a'*64,'constructionSha256':'b'*64}}
            for profile in ('horus','babs') for start in ('normal','developed') for seat in ('P1','P2')]


def receipts(jobs,win):
    result=[]
    for j in jobs:
        winner=j['candidateSeat'] if win(j) else ('P2' if j['candidateSeat']=='P1' else 'P1')
        result.append({**j,'jobId':j['id'],'receiptId':'receipt:'+j['id'],'status':'complete','outcome':'p1_win' if winner=='P1' else 'p2_win'})
    return result


class ProspectiveReportingTest(unittest.TestCase):
    def test_pooled_improvement_cannot_hide_horus_normal_actual_win_regression(self):
        a,b=schedule('control-'),schedule('treatment-')
        normal=lambda j:j['profile']=='horus' and j['startKind']=='normal'
        report=paired_arm_report(a,receipts(a,normal),b,receipts(b,lambda j:not normal(j)),SCOPE,UNCERTAINTY)
        self.assertEqual(report['primaryPairedDelta'],.5)
        self.assertEqual(report['control']['horusNormal']['wins'],2)
        self.assertEqual(report['treatment']['horusNormal']['wins'],0)
        self.assertEqual(report['treatment']['horusNormal']['losses'],2)
        self.assertEqual(report['treatment']['horusNormal']['actualWinRateBounds'],[0.,0.])
        self.assertEqual(len(report['treatment']['strata']),8)
        self.assertEqual(report['treatment']['horusNormal']['giveawayUnassessed'],2)
        self.assertFalse(report['strengthEstablished'])
        self.assertIsNone(report['independentTrainingReplications'])
        self.assertEqual(report['familyUncertainty']['sourceFamilies'],['babsdeveloped','babsnormal','horusdeveloped','horusnormal'])

    def test_missing_results_are_intervals_and_draws_are_not_actual_wins(self):
        a,b=schedule('c'),schedule('t');ar=receipts(a,lambda j:False);br=receipts(b,lambda j:True)
        for row in ar:row['outcome']='draw'
        br[0].update(status='unfinished',outcome='timeout',giveaways=1)
        br.pop()
        scope={**SCOPE,'metric':'actual-win-rate'}
        result=paired_arm_report(a,ar,b,br,scope,UNCERTAINTY)
        self.assertEqual(result['primaryPairedDeltaBounds'],[.75,1.])
        self.assertIsNone(result['primaryPairedDelta'])
        summary=result['treatment']['primary']
        self.assertEqual((summary['wins'],summary['missing'],summary['unfinished'],summary['unstarted']),(6,2,1,1))
        self.assertEqual(summary['giveaways'],1)
        self.assertEqual(result['control']['primary']['actualWinRateBounds'],[0.,0.])
        self.assertEqual(result['control']['primary']['scoreBounds'],[.5,.5])
        self.assertFalse(result['familyUncertainty']['missingOutcomesImputed'])

    def test_family_bootstrap_keeps_correlated_jobs_together_and_is_seeded(self):
        a,b=schedule('c'),schedule('t')
        for j in a+b:j['sourceFamily']='one-source'
        x=paired_arm_report(a,receipts(a,lambda j:False),b,receipts(b,lambda j:True),SCOPE,UNCERTAINTY)
        self.assertIsNone(x['familyUncertainty']['interval'])
        self.assertEqual(x['familyUncertainty']['status'],'insufficient-source-families')
        for j in a+b:j['sourceFamily']=j['familyId']
        args=(a,receipts(a,lambda j:False),b,receipts(b,lambda j:True),SCOPE,UNCERTAINTY)
        self.assertEqual(paired_arm_report(*args),paired_arm_report(*args))
        self.assertEqual(paired_arm_report(*args)['familyUncertainty']['interval'],[1.,1.])

    def test_schedule_and_receipt_identity_are_matched_before_comparison(self):
        a,b=schedule('c'),schedule('t');ar=receipts(a,lambda j:False);br=receipts(b,lambda j:True)
        for key,value in [('sourceFamily','different'),('familyId','different'),('seed',43),('startKind','normal'),('profile','different'),('candidateSeat','P2')]:
            changed=copy.deepcopy(b);changed[2][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):paired_arm_report(a,ar,changed,receipts(changed,lambda j:True),SCOPE,UNCERTAINTY)
        changed=copy.deepcopy(br);changed[0]['receiptId']=ar[0]['receiptId']
        with self.assertRaisesRegex(ValueError,'reused'):paired_arm_report(a,ar,b,changed,SCOPE,UNCERTAINTY)
        changed=copy.deepcopy(br);changed[0]['seed']=99
        with self.assertRaisesRegex(ValueError,'scheduled'):prospective_report(b,changed,SCOPE)
        with self.assertRaisesRegex(ValueError,'settings'):paired_arm_report(a,ar,b,br,SCOPE,None)

    def test_same_family_seed_with_different_full_board_or_identity_is_not_matched(self):
        a,b=schedule('c'),schedule('t')
        for job in b:
            if job['startKind']=='developed':job['initialState']['fixture']='different-board'
        with self.assertRaisesRegex(ValueError,'mismatch'):
            paired_arm_report(a,receipts(a,lambda j:True),b,receipts(b,lambda j:True),SCOPE,UNCERTAINTY)
        b=schedule('t');b[2]['startIdentity']['stateHash']='c'*64
        with self.assertRaisesRegex(ValueError,'same frozen start'):
            prospective_report(b,receipts(b,lambda j:True),SCOPE)
        b=schedule('t');b[0]['initialState']={'boardSize':10}
        with self.assertRaisesRegex(ValueError,'construction'):
            prospective_report(b,receipts(b,lambda j:True),SCOPE)

    def test_legacy_calls_are_explicitly_diagnostic_and_keep_all_scheduled_jobs(self):
        jobs=schedule('c');rows=receipts(jobs,lambda j:True)
        for j in jobs:j.pop('startIdentity')
        self.assertTrue(prospective_report(jobs,rows)['diagnosticOnly'])
        for j in jobs:
            for key in ('startKind','seed','sourceFamily','kind','initialState','startIdentity'):j.pop(key,None)
        result=prospective_report(jobs,rows)
        self.assertTrue(result['diagnosticOnly']);self.assertIsNone(result['primaryScope']);self.assertIsNone(result['primary'])
        self.assertEqual(len(result['scheduledWork']),8)
        with self.assertRaisesRegex(ValueError,'construction'):prospective_report(jobs,rows,SCOPE)
        with self.assertRaisesRegex(ValueError,'10000'):paired_report([],seed=1,resamples=200)


if __name__=='__main__':unittest.main()
