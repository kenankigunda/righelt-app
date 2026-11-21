import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training import cloud_launch as launch,cloud_episode as episode
from test_cloud_launch import plan as old_plan,CloudLaunchTest


def plan(root):
    p=old_plan();ready=launch.REPLACEMENT['authorizedAt']/1000+60
    p.update(launchAuthorityId=launch.REPLACEMENT['id'],repairReadyAtWall=ready,launchAuthorizedAtWall=ready,
        launchAdmissionDeadlineWall=ready+2700,memoryScope=launch.REPLACEMENT['memoryScope'],
        consumedWorkTransfer={'path':'.ai-runs/consumed.json','sha256':launch.REPLACEMENT['consumptionEvidenceSha256']},
        allocationStartWall=ready+10,trainingStopWall=ready+36000,artifactDeadlineWall=ready+43200,
        nativeManifest={'runtimeMetadataImage':'image@sha256:'+'f'*64})
    value={'kind':'bounded-repair-ready','authorityId':launch.REPLACEMENT['id'],'sourceRevision':p['sourceRevision'],
        'image':p['nativeManifest']['runtimeMetadataImage'],'repairReadyAt':int(ready*1000),'checksPassed':True,'reviewPassed':True,'imageVerified':True}
    path=root/'ready.json';path.write_text(json.dumps(value));p['repairReadyProof']={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    return p


class BoundedReplacementTest(unittest.TestCase):
    def test_actual_ready_marker_has_fixed_hard_deadlines_and_all_required_identity_fields(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=plan(root);self.assertEqual(episode.validate(p),p)
            gate,_=CloudLaunchTest().gate(root,p)
            with patch('time.time',return_value=p['allocationStartWall']):r=launch.qualify(root,p,gate)
            self.assertEqual(r['repairReadyAt'],int(p['repairReadyAtWall']*1000))
            self.assertEqual(r['consumedWorkTransferSha256'],p['consumedWorkTransfer']['sha256'])
            self.assertEqual(r['repairReadyProofSha256'],p['repairReadyProof']['sha256'])
            self.assertEqual(r['memoryScope'],'cgroup-v2-v1');self.assertEqual(r['admissionDeadline'],int(p['launchAdmissionDeadlineWall']*1000))
            for change in ({'repairReadyAtWall':launch.REPLACEMENT['repairDeadline']/1000+1},
                {'launchAdmissionDeadlineWall':p['launchAdmissionDeadlineWall']+1},{'memoryScope':'host'},
                {'consumedWorkTransfer':{'sha256':'0'*64}}):
                with self.subTest(change=change),self.assertRaises(ValueError):episode.validate({**p,**change})
        for change in ('expired','altered-ready'):
            with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
                root=Path(d);p=plan(root);gate,_=CloudLaunchTest().gate(root,p)
                if change=='altered-ready':(root/'ready.json').write_text('{}')
                now=p['launchAdmissionDeadlineWall'] if change=='expired' else p['allocationStartWall']
                with patch('time.time',return_value=now),self.assertRaises(ValueError):launch.qualify(root,p,gate)
                self.assertFalse((root/'launch-qualified.json').exists())


if __name__=='__main__':unittest.main()
