import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from righelt_training.config import ROOT
from righelt_training.development_assessment import produce_assessment,work_ids


class Barrier:
    def __init__(self):self.records={};self.claims=[]
    def evaluation_claim(self,namespace,identity,create=True):
        key=(namespace,identity);self.claims.append((key,create))
        if key in self.records:return {'created':False,'result':self.records[key]}
        if not create:return {'created':False,'unclaimed':True}
        self.records[key]=None;return {'created':True}
    def settle(self,namespace,identity,result):self.records[(namespace,identity)]=result


class DevelopmentAssessmentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script="""import {developmentSuiteFixture} from './tools/hosted-compute/test/development-suite-fixture.mjs';
import {developmentDigest,developmentWorkIds} from './tools/hosted-compute/development-suite.mjs';
import {encodeAction,transition} from './packages/computer-player/src/index.ts';
import {deterministicStateHash} from './packages/game-engine/src/index.ts';
import {verifyWitness} from './tools/ai-trainer/tactical-evidence.mjs';
const f=await developmentSuiteFixture();f.index.profiles=[await f.put({simulations:1,temperature:0,maxValueGap:0})];const originalIndexSha256=await f.put(f.index);
// Explicit synthetic native-wiring case: the historical rush is part of the
// prepared ROOT, while the sole model-controlled action is still chosen by search.
f.prepared.state=transition(f.prepared.state,f.original.winningLine[0]);f.prepared.stateHash=deterministicStateHash(f.prepared.state);
f.prepared.id='synthetic-post-rush-end-turn';f.prepared.requests=[{name:'finish',actions:[{type:'end_turn'}],expectedOutcome:'p2_win'}];
f.index.cases[0].caseId=f.prepared.id;f.index.cases[0].rootSha256=f.prepared.stateHash;f.index.cases[0].reason='synthetic post-rush wiring-only diagnostic';
const packet={schema:1,kind:'prepared-development',sourcePacketSha256:f.index.packets[0].sourcePacketSha256,cases:[f.prepared]};f.index.packets[0].preparedSha256=await f.put(packet);
const proof=await verifyWitness({state:f.prepared.state,stateHash:f.prepared.stateHash,actions:[{type:'end_turn'}],expectedOutcome:'p2_win',maxActions:4,milliseconds:1000,maxOperations:2000});
f.index.packets[0].preparationSha256=await f.put({kind:'development-evidence',packetSha256:f.index.packets[0].preparedSha256,sourcePacketSha256:packet.sourcePacketSha256,cases:[{id:f.prepared.id,stateHash:f.prepared.stateHash,witnesses:[{name:'finish',...proof}]}]});await f.put(f.index);console.log(JSON.stringify({index:f.index,originalIndexSha256,indexSha256:await developmentDigest(f.index),workIds:await developmentWorkIds(f.index),winningActionIndex:encodeAction(f.original.winningLine[0]),objects:Object.fromEntries([...f.objects].map(([sha,bytes])=>[sha,new TextDecoder().decode(bytes)]))}));"""
        cls.fixture=json.loads(subprocess.check_output(['node','--import','tsx','--input-type=module','-e',script],cwd=ROOT,text=True))
    def args(self,barrier,output):
        component={'schema':1,'indexSha256':self.fixture['indexSha256'],'seed':107,'stepSeconds':3,'maxActions':4,'milliseconds':10000,'maxOperations':2000}
        execution={'seed':107,'sourceRevision':'c'*40,'dependencySha256':'d'*64,'manifestSha256':'1'*64,'phase':'teacher','generation':1}
        return component,execution,{'model':None,'model_sha256':'e'*64,'device':'cpu','deadline':time.monotonic()+40,
            'read_object':lambda sha:self.fixture['objects'][sha].encode(),'output':output,'barrier':barrier}
    def test_work_ids_and_consumed_unsettled_never_infer(self):
        self.assertEqual(work_ids(self.fixture['index']),self.fixture['workIds'])
        barrier=Barrier()
        with tempfile.TemporaryDirectory() as tmp:
            component,execution,args=self.args(barrier,tmp)
            for identity in work_ids(self.fixture['index']):barrier.records[('development:'+execution['manifestSha256']+':teacher',identity)]=None
            def unexpected(*a,**k):raise AssertionError('consumed probe rerun')
            result=produce_assessment(component,execution,search=unexpected,**args)
            self.assertFalse(result['qualified']);self.assertEqual(result['workReceipts'][0]['status'],'unfinished')
            for row in result['report']['rows']:
                after=json.loads((Path(tmp)/'.objects'/row['afterSha256']).read_bytes())
                self.assertEqual(after['disposition'],'missing');self.assertEqual(after['historicalTrainingPositions'],0)
    def test_actual_native_model_search_claims_before_inference_and_recovery_never_reruns(self):
        import torch
        from righelt_training.config import CONFIG
        from righelt_training.search_parity import search_reference
        torch.set_num_threads(1);torch.manual_seed(107)
        class FixturePolicy(torch.nn.Module):
            # Frozen synthetic NN weights prefer the independently specified rush,
            # then end_turn after the old origin action becomes illegal.
            def __init__(self,index):
                super().__init__();self.logits=torch.nn.Parameter(torch.full((CONFIG['actionCount'],),-100.));self.calls=0
                with torch.no_grad():self.logits[index]=100.;self.logits[-1]=90.
            def forward(self,x):
                self.calls+=1;return self.logits.expand(x.shape[0],-1),torch.zeros(x.shape[0],device=x.device)
        model=FixturePolicy(self.fixture['winningActionIndex']).eval();weights={k:v.clone() for k,v in model.state_dict().items()}
        barrier=Barrier();calls=[]
        def observed(*args,**kwargs):
            self.assertTrue(barrier.claims);self.assertTrue(any(value is None for value in barrier.records.values()));calls.append(1)
            answer=search_reference(*args,**kwargs);calls[-1]=(answer.get('status'),answer.get('stopped'),answer.get('reason'),answer.get('simulations'),answer.get('actionIndex'),self.fixture['winningActionIndex'],answer.get('action',{}).get('type'));return answer
        with tempfile.TemporaryDirectory() as first,tempfile.TemporaryDirectory() as restored:
            component,execution,args=self.args(barrier,first);args['model']=model
            result=produce_assessment(component,execution,search=observed,**args)
            self.assertGreater(len(calls),0);self.assertGreater(model.calls,0)
            assessments=[json.loads((Path(first)/'.objects'/row[key]).read_bytes()) for row in result['report']['rows'] for key in ('beforeSha256','afterSha256')]
            self.assertTrue(any(a['disposition']=='complete' and len(a.get('stepSearches',[]))>=1 for a in assessments),'actual model produced no verified complete-turn probe: '+str([(a['disposition'],a.get('reason')) for a in assessments])+' '+str(calls))
            self.assertFalse(result['qualified']) # This one-choice wiring fixture cannot establish useful teacher correction.
            self.assertTrue(all(torch.equal(v,weights[k]) for k,v in model.state_dict().items()))
            def unexpected(*a,**k):raise AssertionError('settled probe rerun')
            recovered=produce_assessment(component,{**execution,'generation':2},search=unexpected,**{**args,'output':restored,'deadline':time.monotonic()+10})
            self.assertEqual(recovered['report']['rows'],result['report']['rows'])
            self.assertEqual(recovered['workReceipts'],result['workReceipts'])
            before=len(calls)
            with self.assertRaisesRegex(ValueError,'binding differs'):
                produce_assessment(component,execution,search=unexpected,**{**args,'output':restored,'model_sha256':'f'*64})
            self.assertEqual(len(calls),before)
            with tempfile.TemporaryDirectory() as bounded:
                exhausted=produce_assessment({**component,'indexSha256':self.fixture['originalIndexSha256'],'maxActions':1},execution,search=search_reference,**{**args,'output':bounded,'barrier':Barrier(),'deadline':time.monotonic()+15})
                self.assertFalse(exhausted['qualified'])
                records=[json.loads((Path(bounded)/'.objects'/row[key]).read_bytes()) for row in exhausted['report']['rows'] for key in ('beforeSha256','afterSha256')]
                self.assertTrue(all(a['disposition']=='incomplete' for a in records))
    def test_expired_allocation_creates_no_probe_or_claim(self):
        barrier=Barrier()
        with tempfile.TemporaryDirectory() as tmp:
            component,execution,args=self.args(barrier,tmp);args['deadline']=time.monotonic()-1
            def unexpected(*a,**k):raise AssertionError('expired probe inference')
            with patch('righelt_training.development_assessment.bridge',side_effect=AssertionError('expired subprocess')):
                result=produce_assessment(component,execution,search=unexpected,**args)
            self.assertFalse(result['qualified']);self.assertTrue(all(not create for _,create in barrier.claims));self.assertEqual(result['workReceipts'][0]['status'],'unstarted')
