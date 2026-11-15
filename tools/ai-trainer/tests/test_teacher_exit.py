import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from righelt_training.config import ROOT
from righelt_training.hosted_science import refreshed_policy,teacher


class TeacherExitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw=subprocess.check_output(['node','--import','tsx','--input-type=module','-e',
            "import {teacherExitFixture} from './tools/ai-trainer/tests/teacher-exit-fixture.mjs'; console.log(JSON.stringify(await teacherExitFixture()));"],cwd=ROOT,text=True,timeout=15)
        cls.fixture=json.loads(raw)

    def test_actual_zero_simulation_policy_is_verified_and_retained_without_repeating_proof(self):
        f=copy.deepcopy(self.fixture);row=f['position'];answer=f['answer'];profile=f['profile'];proofs=[]
        self.assertEqual(answer['simulations'],0)
        first=refreshed_policy(row,answer,profile,verification_log=proofs,source_revision='b'*40)
        self.assertEqual((first['terminalMask'],first['terminalValue']),(row['terminalMask'],row['terminalValue']))
        self.assertEqual(first['teacherEvidence']['completedSimulations'],0)
        with patch('righelt_training.hosted_science.subprocess.run',side_effect=AssertionError('expired work must not rerun')):
            restored=refreshed_policy(row,answer,profile,proof_seconds=0,retained_proof=proofs[0],source_revision='b'*40)
        self.assertEqual(first,restored)
        for change in ('source','policy','root','support'):
            altered=copy.deepcopy(f);proof=copy.deepcopy(proofs[0]);revision='b'*40
            if change=='source':revision='c'*40
            if change=='policy':altered['answer']['policy'][0]['probability']=.9
            if change=='root':altered['position']['stateHash']='0'*64
            if change=='support':proof['support']=[]
            with self.subTest(change=change),patch('righelt_training.hosted_science.subprocess.run',side_effect=AssertionError('invalid cache must not create work')),self.assertRaises(ValueError):
                refreshed_policy(altered['position'],altered['answer'],profile,proof_seconds=0,retained_proof=proof,source_revision=revision)

    def test_actual_teacher_recovers_settled_early_proof_after_stage_expiry(self):
        class Model:
            def to(self,*args):return self
            def eval(self):return self
        f=copy.deepcopy(self.fixture);row=f['position'];answer=f['answer'];profile=f['profile'];proofs=[]
        refreshed_policy(row,answer,profile,verification_log=proofs,source_revision='b'*40)
        parent=ROOT/'.ai-runs';parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temp:
            directory=Path(temp);rows=directory/'rows.json';rows.write_text(json.dumps([row]))
            cp=directory/'teacher.pt';cp.write_bytes(b'fixture');cp.with_suffix('.json').write_text(json.dumps({'manifestSha256':'old'}))
            binding=lambda p:{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
            plan={'kind':'policy-only-teacher-refresh','mode':'screen','rows':binding(rows),'teacher':binding(cp),'profile':profile,'searchSeconds':30}
            execution={'scientific':{'stage':'teacher-screen','experimentSha256':'a'*64},'generation':2,'sourceRevision':'b'*40,'manifestSha256':'c'*64,'phase':'screen'}
            retained={'id':row['id'],'teacherSha256':binding(cp)['sha256'],'sourceRevision':'b'*40,'requestedProfile':profile,
                'mode':'screen','status':'complete','answer':answer,'earlyExitVerification':proofs}
            with patch('righelt_training.model.model_from_record',return_value=Model()),patch('righelt_training.checkpoint.load_checkpoint'),patch('righelt_training.device.selected_device',return_value='cpu'),patch('righelt_training.hosted_receipts.evaluation_claim',return_value={'created':False,'result':retained}) as claim,patch('righelt_training.hosted_science.subprocess.run',side_effect=AssertionError('no fresh proof')),patch('righelt_training.search_parity.search_reference',side_effect=AssertionError('no fresh search')):
                result=teacher(plan,directory,execution,[row['id']],seconds=0)
            self.assertFalse(claim.call_args.kwargs['create']);self.assertTrue(result['allWorkComplete'])
            self.assertEqual(result['completedWorkIds'],[row['id']])
