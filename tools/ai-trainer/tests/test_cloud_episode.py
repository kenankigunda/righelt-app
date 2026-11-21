"""Episode clocks and zero-resume policy with synthetic metadata only."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training import cloud_episode as episode
from righelt_training import exploratory_contract as legacy


def plan():
    p=episode.LIMITS
    start=p['repairStartedAt']/1000+60
    return {'schema':2,'episodeId':p['id'],'executionScope':'cloud-repair-original1086',
            'maximumSameAllocationResumes':0,'repairStartedAtWall':p['repairStartedAt']/1000,
            'repairDeadlineWall':p['repairDeadline']/1000,'allocationStartWall':start,
            'artifactAfterTrainingSeconds':7200,'maximumTrainingSeconds':43200,
            'checkpoint':{'sha256':p['checkpointSha256']},'trainingStopWall':start+36000,
            'artifactDeadlineWall':start+43200}


class CloudEpisodeTest(unittest.TestCase):
    def test_new_explicit_window_never_changes_historical_clock_or_extends_twelve_hours(self):
        record=plan();self.assertEqual(episode.validate(record),record)
        self.assertEqual((legacy.TRAINING_STOP,legacy.ARTIFACT_DEADLINE),(1795183200,1795190400))
        for change in ({'maximumSameAllocationResumes':1},{'repairDeadlineWall':record['repairDeadlineWall']+1},
                       {'checkpoint':{'sha256':'f'*64}}, {'trainingStopWall':record['allocationStartWall']+43201},
                       {'allocationStartWall':True},{'artifactAfterTrainingSeconds':7201}):
            with self.subTest(change=change),self.assertRaises(ValueError):episode.validate({**record,**change})

    def test_artifacts_expire_two_hours_after_actual_early_stop_not_planned_cutoff_or_wake(self):
        record=plan();ended=record['allocationStartWall']+1200
        self.assertEqual(episode.artifact_deadline(record,{'trainingStoppedAtMs':int(ended*1000)}),ended+7200)
        self.assertLess(ended+7200,record['artifactDeadlineWall'])
        for invalid in ({},{'trainingStoppedAtMs':True},{'trainingStoppedAtMs':int(record['trainingStopWall']*1000)+1}):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):episode.artifact_deadline(record,invalid)

    def test_repair_start_is_absolute_and_repeat_cannot_reset_or_resume(self):
        record=plan()
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'plan.json').write_text(json.dumps(record))
            episode.start_repair(root,record,record['allocationStartWall'])
            before=(root/'exploratory-recovery.jsonl').read_bytes()
            episode.start_repair(root,record,record['allocationStartWall']+60)
            self.assertEqual((root/'exploratory-recovery.jsonl').read_bytes(),before)
            row=json.loads(before);self.assertEqual(row['observedAt'],record['repairStartedAtWall'])
            with self.assertRaisesRegex(ValueError,'no same-allocation resumes'):
                legacy.consume_resume(root,'resource-pressure-stop',record['allocationStartWall'])
            with self.assertRaises(ValueError):episode.start_repair(root,record,record['repairDeadlineWall'])
            self.assertEqual((root/'exploratory-recovery.jsonl').read_bytes(),before)


if __name__=='__main__':unittest.main()
