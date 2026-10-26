import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

PATH=Path(__file__).resolve().parents[1]/'snapshot-production.py'
spec=importlib.util.spec_from_file_location('production_snapshot',PATH)
snapshot_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(snapshot_module)


class ProductionSnapshotTest(unittest.TestCase):
    def test_consistent_select_only_cut_publishes_manifest_and_private_files(self):
        queries=[]
        def query(sql):
            queries.append(sql)
            return [{'game_id':'g','event_seq':1}]
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'snapshot'
            result=snapshot_module.snapshot(root,"player'one",query)
            self.assertTrue((root/'manifest.json').exists())
            self.assertEqual(len(queries),7)
            self.assertTrue(all(q.startswith('SELECT ') for q in queries))
            self.assertIn("player''one",queries[0])
            self.assertEqual(result['revisionFence'],[{'game_id':'g','event_seq':1}])
            self.assertEqual((root/'games.json').stat().st_mode&0o777,0o600)
            with self.assertRaises(FileExistsError):snapshot_module.snapshot(root,'p',query)

    def test_concurrent_game_update_or_new_game_cannot_publish_valid_cut(self):
        calls=[]
        def query(sql):
            calls.append(sql)
            return [{'game_id':'g','event_seq':2 if len(calls)==7 else 1}]
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'snapshot'
            with self.assertRaisesRegex(ValueError,'changed during export'):
                snapshot_module.snapshot(root,'p',query)
            self.assertFalse((root/'manifest.json').exists())
            self.assertTrue((root/'inconsistent-cut.json').exists())
