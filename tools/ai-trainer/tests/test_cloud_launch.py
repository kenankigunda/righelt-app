"""Prospective admission and real metadata gate validation, without model work."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training import cloud_launch as launch,cloud_episode as episode,exploratory_contract as contract
from righelt_training.config import CONFIG_SHA256
from righelt_training.manifest import dependency_inventory
from test_cloud_episode import plan as repair_plan


def plan():
    p=repair_plan();start=launch.LIMITS['authorizedAt']/1000+60
    p.update(launchAuthorityId=launch.LIMITS['id'],launchAuthorizedAtWall=launch.LIMITS['authorizedAt']/1000,
             launchAdmissionDeadlineWall=launch.LIMITS['admissionDeadline']/1000,additionalRepairSeconds=0,
             allocationStartWall=start,trainingStopWall=start+36000,artifactDeadlineWall=start+43200,
             sourceRevision='a'*40,executionRecipe={'sha256':'d'*64})
    return p


class CloudLaunchTest(unittest.TestCase):
    def test_new_admission_keeps_expired_repair_clock_and_cannot_grant_repair_or_resume(self):
        p=plan();self.assertEqual(episode.validate(p),p)
        self.assertEqual((p['repairStartedAtWall'],p['repairDeadlineWall']),(1795230840,1795241640))
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'plan.json').write_text(json.dumps(p))
            episode.start_repair(root,p,p['allocationStartWall'])
            self.assertFalse((root/'exploratory-recovery.jsonl').exists())
            contract.finish_repair(root,p['allocationStartWall']+10)
            self.assertFalse((root/'exploratory-recovery.jsonl').exists())
            before=(root/'launch-authority.json').read_bytes()
            with self.assertRaisesRegex(ValueError,'no additional repair'):contract.start_repair(root,p['allocationStartWall']+20)
            with self.assertRaisesRegex(ValueError,'no same-allocation resumes'):contract.consume_resume(root,'resource-pressure-stop',p['allocationStartWall']+20)
            with self.assertRaisesRegex(ValueError,'expired'):episode.start_repair(root,p,p['launchAdmissionDeadlineWall'])
            self.assertEqual((root/'launch-authority.json').read_bytes(),before)
        for change in ({'additionalRepairSeconds':1},{'repairDeadlineWall':p['launchAdmissionDeadlineWall']},
                       {'launchAuthorityId':'other'},{'allocationStartWall':1795230900},
                       {'trainingStopWall':p['allocationStartWall']+43201}):
            with self.subTest(change=change),self.assertRaises(ValueError):episode.validate({**p,**change})
        with self.assertRaises(ValueError):episode.validate({k:v for k,v in p.items() if not k.startswith('launch')})

    def gate(self,root,p):
        def write(name,value):
            path=root/name;path.write_text(json.dumps(value))
            return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        numeric=write('numeric.json',{'schema':2,'referenceDevice':'cuda','numericPassed':True,'onnxSha256':'e'*64,
            'states':1,'inputShape':[1,46,10,10],'inputDtype':'float32','atol':1e-5,'rtol':1e-4,
            'arithmetic':{'policyApplied':True},'batches':[{'start':0,'count':1,'comparisons':{key:{'passed':True,
                'outputs':[{'name':name,'referenceShape':shape,'actualShape':shape,'referenceDtype':'float32',
                    'actualDtype':'float32','passed':True,'abiPassed':True,'finite':True,
                    'referenceNonfinite':0,'actualNonfinite':0,'exceedingCells':0}
                    for name,shape in [('policy',[1,2801]),('value',[1])]]}
                for key in ('torchCpuToOrtCpu','torchReferenceToTorchCpu','torchReferenceToOrtCpu')}}]})
        report=write('target.json',{'schema':1,'kind':'disposable-target-backend-preflight','passed':True,'backend':'cuda',
            'sourceRevision':p['sourceRevision'],'configSha256':CONFIG_SHA256,
            'inputCheckpointSha256':p['checkpoint']['sha256'],'executionRecipeSha256':p['executionRecipe']['sha256'],
            'updates':1,'parameterDelta':.5,'teacherLoaded':True,'freshBaselineInitialized':True,
            'checkpointRecoveryPassed':True,'numericParityPassed':True,'abiPassed':True,
            'originalCheckpointUnchanged':True,'numericReport':numeric,
            'export':{'sha256':'e'*64,'dtype':'float32','opset':17,'configSha256':CONFIG_SHA256}})
        gate={'schema':1,'kind':'exploratory-launch-gate','sourceRevision':p['sourceRevision'],
            'configSha256':CONFIG_SHA256,'proofDependencies':dependency_inventory(),
            'checks':{name:{'passed':True,'evidence':report} for name in ('coreTests','trainerTests','exactReplay','targetBackend')}}
        gate['checks']['targetBackend'].update(backend='cuda',restorePassed=True,checkpointRecoveryPassed=True,
            finiteUpdatePassed=True,numericPassed=True,abiPassed=True)
        write('gate.json',gate)
        return root/'gate.json',report

    def test_qualified_marker_requires_full_bound_target_gate_before_admission_expiry(self):
        p=plan()
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);gate,target=self.gate(root,p);clock=p['allocationStartWall']
            with patch('time.time',return_value=clock):record=launch.qualify(root,p,gate)
            self.assertEqual(record['planSha256'],contract.digest(p))
            self.assertEqual(record['targetReportSha256'],target['sha256'])
            self.assertEqual(record['qualifiedAt'],int(clock*1000));self.assertEqual(record['additionalRepairSeconds'],0)
            self.assertFalse(record['productiveWorkStarted']);before=(root/'launch-qualified.json').read_bytes()
            with patch('time.time',return_value=clock),self.assertRaisesRegex(ValueError,'already recorded'):launch.qualify(root,p,gate)
            self.assertEqual((root/'launch-qualified.json').read_bytes(),before)
        for invalid in ('expired','gate-mismatch','failed-numeric','target-changed'):
            with self.subTest(invalid=invalid),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);gate,target=self.gate(root,p)
                if invalid=='gate-mismatch':
                    value=json.loads(gate.read_bytes());value['sourceRevision']='f'*40;gate.write_text(json.dumps(value))
                if invalid=='failed-numeric':(root/'numeric.json').write_text('{}')
                if invalid=='target-changed':(root/'target.json').write_text('{}')
                with patch('time.time',return_value=p['launchAdmissionDeadlineWall'] if invalid=='expired' else clock),self.assertRaises(ValueError):launch.qualify(root,p,gate)
                self.assertFalse((root/'launch-qualified.json').exists())


if __name__=='__main__':unittest.main()
