"""Pure architecture/provenance checks. No Torch import or model execution."""
import ast
from pathlib import Path
import unittest
from types import SimpleNamespace
from righelt_training.architecture import (BASELINE, DEFINITIONS, architecture_binding,
    validate_architecture, record_architecture, model_architecture)


class ArchitectureContractTest(unittest.TestCase):
    def test_absent_legacy_identity_is_baseline_but_explicit_null_rejects(self):
        self.assertEqual(record_architecture({}),architecture_binding(BASELINE))
        for invalid in [None,{}, {'id':BASELINE}, {'id':'unknown','sha256':'a'*64}]:
            with self.assertRaises(ValueError):record_architecture({'modelArchitecture':invalid})

    def test_architectures_keep_existing_encoding_and_action_layout(self):
        for identifier, definition in DEFINITIONS.items():
            self.assertEqual(definition['inputPlanes'],46)
            self.assertEqual(definition['actionCount'],2801)
            self.assertEqual(definition['encoding'],'absolute-v1')
            self.assertEqual(validate_architecture(architecture_binding(identifier)),architecture_binding(identifier))

    def test_definition_ids_have_distinct_checksummed_identities(self):
        self.assertEqual(len({architecture_binding(k)['sha256']for k in DEFINITIONS}),3)
        bad={**architecture_binding('board-attention-48x2-v1'),'sha256':'0'*64}
        with self.assertRaises(ValueError):validate_architecture(bad)

    def test_model_identity_is_explicit_for_attention(self):
        self.assertEqual(model_architecture(SimpleNamespace()),architecture_binding())
        binding=architecture_binding('board-attention-64x2-v1')
        self.assertEqual(model_architecture(SimpleNamespace(model_architecture=binding)),binding)
        with self.assertRaises(ValueError):model_architecture(SimpleNamespace(model_architecture=None))

    def test_source_parses_without_importing_or_constructing_models(self):
        base=Path(__file__).parents[1]/'righelt_training'
        for name in ['architecture.py','board_attention.py','model.py','checkpoint.py','export.py',
                     'runner.py','arena.py','export_parity.py','search_parity.py','health.py','exploration_worker.py']:
            with self.subTest(name=name):ast.parse((base/name).read_text(),filename=name)


if __name__=='__main__':unittest.main()
