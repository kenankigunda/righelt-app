import hashlib
import tempfile
from pathlib import Path
import unittest
import json
from unittest.mock import patch
import numpy as np
import onnx
from onnx import helper,TensorProto,numpy_helper
from righelt_training.export_runtime import ExportedModel
from righelt_training.arena import infer


def fixture_model(path):
    policy=np.zeros((1,2801),dtype=np.float32);policy[0,2]=4.
    value=np.array([.25],dtype=np.float32)
    graph=helper.make_graph([helper.make_node('Constant',[],['policy'],value=numpy_helper.from_array(policy)),helper.make_node('Constant',[],['value'],value=numpy_helper.from_array(value))],
        'synthetic-transport-only',[helper.make_tensor_value_info('state',TensorProto.FLOAT,[1,46,10,10])],
        [helper.make_tensor_value_info('policy',TensorProto.FLOAT,[1,2801]),helper.make_tensor_value_info('value',TensorProto.FLOAT,[1])])
    model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',17)]);model.ir_version=10
    onnx.save(model,path)
    return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

class ExportRuntimeTest(unittest.TestCase):
    def test_actual_onnx_bytes_drive_arena_inference_and_wrong_hash_rejects(self):
        with tempfile.TemporaryDirectory() as temp:
            binding=fixture_model(Path(temp)/'synthetic.onnx');model=ExportedModel(binding)
            policy,value=infer(model,[0.]*(46*100),'unused-gpu-marker')
            self.assertEqual(len(policy),2801);self.assertEqual(policy[2],4.);self.assertEqual(sum(policy),4.);self.assertEqual(value,.25)
            self.assertEqual(model.runtime['providers'],['CPUExecutionProvider']);self.assertFalse(model.runtime['hostedGpuUsedForInference'])
            with self.assertRaisesRegex(ValueError,'checksum'):ExportedModel({**binding,'sha256':'f'*64})
            with self.assertRaisesRegex(ValueError,'input'):model.infer_export([float('nan')]*(46*100))

    def test_low_runway_reuses_settled_outcomes_without_starting_new_games(self):
        from righelt_training.hosted_science import authoritative_profiles,evaluate,digest
        from righelt_training.prospective_durability import sha,verifier_binding
        root=Path.cwd()/'.ai-runs';root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp:
            run=Path(temp);binding=fixture_model(run/'synthetic.onnx');profiles=authoritative_profiles()
            families=run/'families.json';families.write_text(json.dumps({'schema':1,'families':[{'id':'family1','partition':'validation','sourceFamily':'source1'}]}))
            family_binding={'path':str(families),'sha256':hashlib.sha256(families.read_bytes()).hexdigest()}
            jobs=[{'id':name+seat,'pairId':name,'profile':name,'candidateSeat':seat,'role':'candidate','partition':'validation','familyId':'family1','sourceFamily':'source1','seed':12,'gameSeconds':900} for name in profiles['profiles'] for seat in ('P1','P2')]
            plan={'schema':1,'kind':'prospective-public-profile-evaluation','profiles':profiles,'candidateSha256':binding['sha256'],'schedule':jobs,'familyInventory':family_binding,'models':{'candidate':binding,'opponent':binding}}
            execution={'scientific':{'stage':'evaluation','experimentSha256':'a'*64,'candidateSha256':binding['sha256'],'familyInventorySha256':family_binding['sha256']},'generation':2,'phase':'eval','manifestSha256':'c'*64,'sourceRevision':'d'*40}
            def claim(namespace,identity,*,create):
                self.assertFalse(create)
                job=next(j for j in jobs if j['id']==identity);profile=profiles['profiles'][job['profile']]
                outcome='p1_win' if job['candidateSeat']=='P1' else 'p2_win'
                game={'id':identity,'seed':12,'familyId':'family1','partition':'validation','outcome':{'status':outcome},'modelVersions':{'P1':binding['sha256'],'P2':binding['sha256']},'profileVersions':{'P1':profile['version'],'P2':profile['version']}}
                raw={'jobId':identity,'pairId':job['pairId'],'candidateSeat':job['candidateSeat'],'profile':job['profile'],'familyId':'family1','sourceFamily':'source1','role':'candidate','receiptId':'c'*64+':'+identity,'startKind':'unclassified','seed':12,'schema':1,'originalGeneration':1,'sourceRevision':'d'*40,'status':'raw-complete','rawOutcome':outcome,'game':game,'gameSha256':sha(game)}
                if ':verification:' in namespace:
                    return {'created':False,'result':{'schema':1,'kind':'prospective-replay-verification','rawSha256':sha(raw),'startIdentity':None,'verifier':verifier_binding('d'*40),'engineReplayVerified':True,'outcome':outcome}}
                return {'created':False,'result':raw}
            with patch('righelt_training.hosted_receipts.evaluation_claim',side_effect=claim),patch('righelt_training.arena.verify_game',side_effect=AssertionError('settled proof must be reused')) as verify:
                result=evaluate(plan,run,execution,[j['id'] for j in jobs],seconds=.01,player=lambda *args: (_ for _ in ()).throw(AssertionError('new game forbidden')))
            self.assertEqual(len(result['completedWorkIds']),6);self.assertTrue(result['allWorkComplete']);verify.assert_not_called()
            proof=json.loads((run/'proof-2.json').read_bytes())
            self.assertEqual(proof['inferenceRuntime']['candidate']['kind'],'exported-onnx')
            self.assertEqual(proof['inferenceRuntime']['candidate']['providers'],['CPUExecutionProvider'])

    def test_evaluate_cloud_raw_restore_verifies_without_regenerating_consumed_game(self):
        from righelt_training.hosted_science import authoritative_profiles,evaluate
        from test_prospective_durability import Barrier
        from unittest.mock import Mock
        root=Path.cwd()/'.ai-runs';root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp:
            run=Path(temp);binding=fixture_model(run/'synthetic.onnx');profiles=authoritative_profiles()
            families=run/'families.json';families.write_text(json.dumps({'schema':1,'families':[{'id':'family1','partition':'validation','sourceFamily':'source1'}]}))
            family_binding={'path':str(families),'sha256':hashlib.sha256(families.read_bytes()).hexdigest()}
            jobs=[{'id':name+seat,'pairId':name,'profile':name,'candidateSeat':seat,'role':'candidate','partition':'validation','familyId':'family1','sourceFamily':'source1','seed':12,'gameSeconds':900} for name in profiles['profiles'] for seat in ('P1','P2')]
            plan={'schema':1,'kind':'prospective-public-profile-evaluation','profiles':profiles,'candidateSha256':binding['sha256'],'schedule':jobs,'familyInventory':family_binding,'models':{'candidate':binding,'opponent':binding}}
            execution={'scientific':{'stage':'evaluation','experimentSha256':'a'*64,'candidateSha256':binding['sha256'],'familyInventorySha256':family_binding['sha256']},'generation':1,'phase':'eval','manifestSha256':'c'*64,'sourceRevision':'d'*40}
            barrier=Barrier()
            def player(job,*args):
                profile=profiles['profiles'][job['profile']]
                return {'status':'completed','game':{'id':job['id'],'seed':12,'familyId':'family1','partition':'validation','outcome':{'status':'p1_win'},'modelVersions':job['modelVersions'],'profileVersions':{'P1':profile['version'],'P2':profile['version']}}}
            with patch('righelt_training.hosted_receipts.evaluation_claim',side_effect=barrier.evaluation_claim),patch('righelt_training.hosted_receipts.settle',side_effect=barrier.settle),patch('righelt_training.arena.verify_game',side_effect=KeyboardInterrupt('crash after raw')):
                with self.assertRaises(KeyboardInterrupt):evaluate(plan,run/'lost-host',execution,[j['id'] for j in jobs],seconds=100,player=player)
            original=barrier.records[('prospective:'+execution['manifestSha256']+':eval',jobs[0]['id'])]['result']
            self.assertEqual(original['status'],'raw-complete')
            barrier.generation=2;execution={**execution,'generation':2};forbidden=Mock(side_effect=AssertionError('consumed player rerun'))
            with patch('righelt_training.hosted_receipts.evaluation_claim',side_effect=barrier.evaluation_claim),patch('righelt_training.hosted_receipts.settle',side_effect=barrier.settle),patch('righelt_training.arena.verify_game') as verify:
                result=evaluate(plan,run/'restored',execution,[j['id'] for j in jobs],seconds=10,player=forbidden)
            forbidden.assert_not_called();verify.assert_called_once()
            self.assertEqual(result['completedWorkIds'],[jobs[0]['id']]);self.assertFalse(result['allWorkComplete'])
            proof=json.loads((run/'restored'/'proof-2.json').read_bytes())
            self.assertEqual([r['status'] for r in proof['workReceipts']],['complete']+['unstarted']*5)
            self.assertTrue(any('/raw/' in a['path'] for a in result['artifacts']))

if __name__=='__main__':unittest.main()
