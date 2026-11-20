import json
from pathlib import Path
import shutil
import tempfile
import unittest
from righelt_training.hosted_snapshot import snapshot,PARENT_LEDGERS


class HostedParentLedgerTest(unittest.TestCase):
    def test_snapshot_retains_exact_native_parent_ledgers_without_broad_parent_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=root/'.ai-runs/candidate';run.mkdir(parents=True)
            (run/'latest.json').write_text('{"checkpoint":"immutable"}')
            for index,name in enumerate(PARENT_LEDGERS):(run.parent/name).write_text(json.dumps({'ordinal':index}))
            (run.parent/'unrelated-private-file').write_text('must stay outside snapshot')
            result=Path(snapshot(root,'.ai-runs/candidate',parent_ledgers=True))
            self.addCleanup(shutil.rmtree,result)
            for name in PARENT_LEDGERS:self.assertEqual((result/'.ai-runs'/name).read_bytes(),(run.parent/name).read_bytes())
            self.assertFalse((result/'.ai-runs/unrelated-private-file').exists())
            self.assertTrue((result/'.ai-runs/candidate/latest.json').exists())

    def test_parent_ledger_symlink_is_rejected_without_copying_its_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);run=root/'.ai-runs/candidate';run.mkdir(parents=True)
            outside=root/'outside';outside.write_text('private')
            (run.parent/PARENT_LEDGERS[0]).symlink_to(outside)
            with self.assertRaisesRegex(ValueError,'unsafe native parent ledger'):snapshot(root,'.ai-runs/candidate',parent_ledgers=True)


if __name__=='__main__':unittest.main()
