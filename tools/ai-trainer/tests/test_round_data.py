import copy
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.round_data import admit,read_start,record_path


class RoundDataTest(unittest.TestCase):
    def test_first_admission_is_immutable_across_pilots_and_lost_controller_state(self):
        with tempfile.TemporaryDirectory()as folder:
            contract={'statePath':str(Path(folder)/'state.json'),'executionStartedAt':'original-start','deadline':'original-end'}
            binding={'snapshot':{'sha256':'a'*64},'corpus':{'sha256':'b'*64}}
            first=admit(contract,binding,'first-manifest','source',clock=lambda:1000.)
            # Simulate a controller crash: the mutable state file is absent.
            self.assertFalse(Path(contract['statePath']).exists())
            self.assertEqual(read_start(contract,binding),first)
            again=admit(contract,binding,'another-pilot','source',clock=lambda:2000.)
            self.assertEqual(again,first)
            changed=copy.deepcopy(binding);changed['corpus']['sha256']='c'*64
            with self.assertRaisesRegex(ValueError,'identity changed'):read_start(contract,changed)
            with self.assertRaises(ValueError):admit(contract,changed,'other','source')

    def test_partial_or_corrupt_durable_record_fails_closed(self):
        with tempfile.TemporaryDirectory()as folder:
            contract={'statePath':str(Path(folder)/'state.json'),'executionStartedAt':'start','deadline':'end'}
            path=record_path(contract);path.parent.mkdir(parents=True);path.write_text('{partial')
            with self.assertRaises(ValueError):admit(contract,{},'manifest','source')
            self.assertEqual(path.read_text(),'{partial')

if __name__=='__main__':unittest.main()
