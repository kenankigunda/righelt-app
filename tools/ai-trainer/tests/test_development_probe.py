"""Bounded JSON fixtures only: no model, engine, browser or subprocess execution."""
from contextlib import contextmanager, redirect_stdout
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from righelt_training import development_probe as probe
from righelt_training.bootstrap import PROFILE, validate_outputs
from righelt_training.config import CONFIG, CONFIG_SHA256
from righelt_training.replay import partition_for_family


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False))


class DevelopmentProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.root = Path(cls.temp.name).resolve()
        family = next('export-validation-' + str(i) for i in range(100) if partition_for_family('export-validation-' + str(i)) == 'validation')
        encoded = [0] * 4600
        states = []
        for i in range(1000):
            controller = 'P1' if i % 2 == 0 else 'P2'
            phase = (i // 2) % 5
            state = {'sideToMove': controller}
            if phase > 1:
                # Owner deliberately differs: coverage must use the actual controller.
                state['continuation'] = {'owner': 'P2' if controller == 'P1' else 'P1',
                                         'type': 'rush' if phase == 2 else 'push',
                                         'phase': 'retreat' if phase == 3 else 'follow'}
            states.append({'id': family + ':' + str(i), 'familyId': family, 'partition': 'validation',
                           'state': state, 'hash': str(i), 'encoded': encoded, 'legal': [0, 16] if phase == 1 else [0, 1]})
        cls.corpus = cls.root / 'corpus.json'; write(cls.corpus, {'schema': 1, 'kind': 'export-validation', 'states': states})
        cls.cases = cls.root / 'cases.json'; write(cls.cases, probe.prepare(cls.corpus))
        cls.proofs = [cls.make_proof('first', states, 'a' * 40), cls.make_proof('second', states, 'b' * 40)]

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    @classmethod
    def make_proof(cls, name, states, source):
        attempt = cls.root / name; attempt.mkdir()
        checkpoint = attempt / 'checkpoint.pt'; checkpoint.write_bytes(name.encode())
        identity = {'sourceRevision': source, 'configSha256': CONFIG_SHA256,
                    'proofDependencies': {'engine.ts': 'a' * 64}, 'bootstrapDependencies': {'search.py': 'b' * 64},
                    'runtime': {'python': 'fixture', 'onnxruntime-web': 'fixture'}, 'corpus': probe.reference(cls.corpus),
                    'checkpoint': probe.reference(checkpoint), 'sequenceId': 'fixture'}
        for key in ('sequence', 'legacyGate'):
            path = attempt / (key + '.json'); write(path, {'fixture': True}); identity[key] = probe.reference(path)
        static = attempt / 'static.json'; write(static, {key: identity[key] for key in ('sourceRevision', 'configSha256', 'proofDependencies')})
        audit = attempt / 'audit.json'; write(audit, {'passed': True, 'sourceRevision': source, 'checkpoint': str(checkpoint), 'sha256': probe.digest(checkpoint)})
        identity.update(staticProof=probe.reference(static), recoveryAudit=probe.reference(audit))
        model = attempt / 'numeric/model.onnx'; model.parent.mkdir(); model.write_bytes(b'fixture model ' + name.encode())
        model_sha = probe.digest(model); (attempt / 'native-search.onnx').write_bytes(model.read_bytes())
        common = {'configSha256': CONFIG_SHA256, 'modelSha256': model_sha, 'referenceDevice': 'mps', 'corpusSha256': probe.digest(cls.corpus)}
        write(attempt / 'corpus-check.json', {'passed': True, 'states': 1000, 'corpusSha256': common['corpusSha256']})
        write(attempt / 'numeric/parity-report.json', {**common, 'numericPassed': True, 'states': 1000, 'heldoutStates': 1000,
              'trainedCheckpoint': True, 'atol': 1e-5, 'rtol': 1e-4, 'maxAbsoluteError': [0, 0], 'export': {'sha256': model_sha}})
        logits = [0] * CONFIG['actionCount']; logits[0] = 2
        write(attempt / 'native-raw.json', {**common, 'states': [{'id': row['id'], 'legal': row['legal'], 'policyLogits': logits,
              'value': 0.25 if name == 'first' else 0.5} for row in states]})
        write(attempt / 'native-search.json', {**common, 'profile': PROFILE, 'complete': True,
              'states': [{'id': row['id'], 'seed': 107 + i, 'result': {'status': 'ready', 'stopped': 'node-limit',
                  'actionIndex': row['legal'][1], 'value': 0.5, 'policyMask': True, 'fallback': None, 'reason': 'search',
                  'actions': [{'index': 0, 'immediate': 'eligible', 'tactical': 'horizon', 'visits': 99, 'value': 0.9},
                              {'index': row['legal'][1], 'immediate': 'win' if i % 3 == 0 else 'eligible',
                               'tactical': 'proven-win' if i % 3 == 0 else 'horizon'}]}}
                         for i, row in enumerate(states)]})
        write(attempt / 'browser-numeric.json', {**common, 'numericParityPassed': True, 'legalMasksIdentical': True,
              'states': 1000, 'backend': 'wasm', 'threads': 1, 'browserVersion': 'fixture'})
        write(attempt / 'browser-search-proof.json', {**common, 'states': 1000, 'tacticalOutcomesVerified': True, 'browserVersion': 'fixture'})
        write(attempt / 'browser-raw.json', {'fixture': True})
        write(attempt / 'browser-search.json', {'modelVersion': model_sha, 'results': [{'id': row['id']} for row in states]})
        assets = {}
        for key in ('worker', 'model', 'corpus', 'runtimeMjs', 'runtimeWasm'):
            path = attempt / 'benchmark' / key; path.parent.mkdir(exist_ok=True); path.write_bytes(key.encode())
            assets[key] = {'path': key, 'sha256': probe.digest(path)}
        write(attempt / 'benchmark/manifest.json', {'modelVersion': model_sha, 'runtimeVersion': 'fixture', 'assets': assets})
        path = attempt / 'complete-evidence.json'; write(path, validate_outputs(attempt, identity)); return path

    @contextmanager
    def changed(self, path, mutate):
        original = path.read_bytes(); value = probe.read(path); mutate(value); write(path, value)
        try: yield
        finally: path.write_bytes(original)

    def test_fixed_order_dedup_actual_controllers_and_all_five_categories(self):
        cases = probe.load_cases(self.cases)
        self.assertEqual(cases, probe.prepare(self.corpus))
        self.assertEqual(cases['missingCoverage'], [])
        self.assertEqual(len(cases['cases']), 18)
        self.assertEqual([c['corpusIndex'] for c in cases['cases']], sorted(c['corpusIndex'] for c in cases['cases']))
        self.assertEqual(cases['cases'][2]['categories'], ['ordinary', 'push-available'])
        self.assertEqual(cases['cases'][4]['controller'], 'P1')
        self.assertEqual(cases['cases'][4]['categories'], ['rush'])
        self.assertTrue(all(len(c['selected']) == 2 for c in cases['coverage'].values()))

    def test_missing_coverage_is_explicit_without_substituting_a_puzzle(self):
        with self.changed(self.corpus, lambda doc: [row['state'].update(sideToMove='P1') for row in doc['states']]):
            cases = probe.prepare(self.corpus)
        self.assertEqual(cases['missingCoverage'], ['P2:' + name for name in probe.CATEGORIES])
        self.assertEqual(cases['coverage']['P2:follow']['shortfall'], 2)

    def test_final_train_and_acceptance_cannot_be_frozen(self):
        for partition in ('final', 'train'):
            with self.subTest(partition=partition), self.changed(self.corpus, lambda doc: doc['states'][0].update(partition=partition)):
                with self.assertRaisesRegex(ValueError, 'sealed'): probe.prepare(self.corpus)
        with self.changed(self.corpus, lambda doc: doc.update(kind='acceptance')):
            with self.assertRaisesRegex(ValueError, 'acceptance'): probe.prepare(self.corpus)
        with self.changed(self.corpus, lambda doc: doc.update(states=doc['states'][:180])):
            with self.assertRaisesRegex(ValueError, '1000-state'): probe.prepare(self.corpus)

    def test_validation_label_cannot_override_family_partition(self):
        family = next('export-validation-' + str(i) for i in range(100) if partition_for_family('export-validation-' + str(i)) == 'final')
        with self.changed(self.corpus, lambda doc: doc['states'][0].update(familyId=family, id=family + ':0')):
            with self.assertRaisesRegex(ValueError, 'sealed'): probe.prepare(self.corpus)

    def test_changed_corpus_or_selection_rejected_without_refreeze(self):
        with self.changed(self.corpus, lambda doc: doc['states'][0].update(hash='altered')):
            with self.assertRaisesRegex(ValueError, 'checksum'): probe.load_cases(self.cases)
        with self.changed(self.cases, lambda doc: doc['cases'].reverse()):
            with self.assertRaisesRegex(ValueError, 'silent refreeze'): probe.load_cases(self.cases)

    def test_prepare_command_is_idempotent_and_never_replaces_frozen_cases(self):
        output = self.root / 'cli-cases.json'
        args = ['prepare', '--corpus', str(self.corpus), '--output', str(output)]
        with redirect_stdout(StringIO()):
            probe.main(args); probe.main(args)
            with self.changed(self.corpus, lambda doc: doc['states'][0].update(hash='changed')):
                with self.assertRaisesRegex(ValueError, 'immutable'): probe.main(args)
        self.assertEqual(probe.read(output), probe.read(self.cases))

    def test_complete_proof_separates_raw_search_and_proven_answers(self):
        with patch('subprocess.run', side_effect=AssertionError('no execution')), patch('subprocess.check_output', side_effect=AssertionError('no execution')):
            value = probe.report(self.cases, self.proofs[0])
        self.assertEqual(value['status'], 'complete'); self.assertIsNone(value['acceptanceDecision'])
        first, second = value['observations'][:2]
        self.assertEqual(first['raw']['preferredLegalActions'], [0])
        self.assertEqual(first['searched']['actionIndex'], 1)
        self.assertEqual(first['authoritative']['actions']['winning'], [1])
        self.assertEqual(first['authoritative']['rootValueP1'], 1)
        self.assertFalse(first['authoritative']['exhaustive'])
        self.assertEqual(second['raw']['valueController'], -0.25)
        self.assertEqual(second['authoritative']['status'], 'unproven')
        self.assertIsNone(second['authoritative']['rawValueAbsoluteError'])
        p2win = next(row for row in value['observations'] if row['controller'] == 'P2' and row['authoritative']['actions']['winning'])
        self.assertEqual(p2win['authoritative']['rootValueP1'], -1)

    def test_missing_partial_and_stage_export_reports_never_complete(self):
        missing = probe.report(self.cases, self.root / 'absent.json')
        self.assertEqual(missing['status'], 'missing'); self.assertEqual(missing['observations'], [])
        with self.changed(self.proofs[0], lambda doc: doc.update(complete=False)):
            self.assertEqual(probe.report(self.cases, self.proofs[0])['status'], 'incomplete')
        result = probe.report(self.cases, self.proofs[0].parent / 'numeric/parity-report.json')
        self.assertEqual(result['status'], 'unsupported'); self.assertEqual(result['observations'], [])

    def test_altered_artifact_checkpoint_and_audit_are_rejected(self):
        attempt = self.proofs[0].parent
        for name in ('native-raw.json', 'native-search.json', 'audit.json'):
            with self.subTest(name=name), self.changed(attempt / name, lambda doc: doc.update(altered=True)):
                with self.assertRaisesRegex(ValueError, 'checksum'): probe.report(self.cases, self.proofs[0])
        checkpoint = attempt / 'checkpoint.pt'; original = checkpoint.read_bytes()
        try:
            checkpoint.write_bytes(b'copied checkpoint')
            with self.assertRaisesRegex(ValueError, 'checksum'): probe.report(self.cases, self.proofs[0])
        finally: checkpoint.write_bytes(original)

    def test_profile_changed_even_with_new_artifact_hash_is_rejected(self):
        search = self.proofs[0].parent / 'native-search.json'
        with self.changed(search, lambda doc: doc['profile'].update(simulations=20)):
            with self.changed(self.proofs[0], lambda doc: doc['artifacts'].update({'native-search.json': probe.reference(search)})):
                with self.assertRaisesRegex(ValueError, 'search reference'): probe.report(self.cases, self.proofs[0])

    def test_deadline_and_wrong_seed_are_not_complete_search(self):
        search = self.proofs[0].parent / 'native-search.json'
        for mutate in (lambda doc: doc['states'][0]['result'].update(stopped='deadline'), lambda doc: doc['states'][0].update(seed=99)):
            with self.changed(search, mutate):
                with self.changed(self.proofs[0], lambda doc: doc['artifacts'].update({'native-search.json': probe.reference(search)})):
                    with self.assertRaisesRegex(ValueError, 'search reference'): probe.report(self.cases, self.proofs[0])

    def test_illegal_preferences_and_nonfinite_values_cannot_be_reported(self):
        case = probe.read(self.cases)['cases'][0]; frozen = {'legal': [0, 1]}
        raw = {'legal': [0, 1], 'policyLogits': [0] * 2801, 'value': 0}
        searched = {'seed': 107, 'result': {'actionIndex': 0, 'value': 0, 'stopped': 'complete', 'actions': []}}
        for value in (float('nan'), float('inf'), 2):
            raw['value'] = value
            with self.assertRaisesRegex(ValueError, 'observations'): probe.observations(case, frozen, raw, searched)
        raw['value'] = 0; searched['result']['actionIndex'] = 2800
        with self.assertRaisesRegex(ValueError, 'observations'): probe.observations(case, frozen, raw, searched)

    def test_ties_and_observed_winning_values_are_not_optimal_answers(self):
        case = {'id': 'fixture', 'controller': 'P2', 'categories': ['ordinary']}
        raw = {'legal': [1, 0], 'policyLogits': [0] * 2801, 'value': -1}
        searched = {'seed': 107, 'result': {'actionIndex': 1, 'value': -1, 'stopped': 'complete',
                    'actions': [{'index': 1, 'immediate': 'eligible', 'tactical': 'horizon', 'visits': 100, 'value': -1}]}}
        result = probe.observations(case, {'legal': [1, 0]}, raw, searched)
        self.assertEqual(result['raw']['preferredLegalActions'], [0, 1])
        self.assertTrue(result['rawPreferenceMatchesSearch'])
        self.assertEqual(result['authoritative']['status'], 'unproven')
        self.assertIsNone(result['authoritative']['rootValueP1'])
        self.assertIsNone(result['authoritative']['rawValueAbsoluteError'])

    def test_mutation_during_report_prevents_publication(self):
        raw = self.proofs[0].parent / 'native-raw.json'; original = raw.read_bytes()
        original_observations = probe.observations; first = [True]
        def mutate(*args):
            if first[0]: raw.write_bytes(b'{}'); first[0] = False
            return original_observations(*args)
        output = self.root / 'mutated-report.json'
        try:
            with patch.object(probe, 'observations', side_effect=mutate), self.assertRaisesRegex(ValueError, 'checksum'):
                probe.main(['report', '--cases', str(self.cases), '--proof', str(self.proofs[0]), '--output', str(output)])
            self.assertFalse(output.exists())
        finally: raw.write_bytes(original)

    def reports(self):
        paths = [self.root / 'before.json', self.root / 'after.json']
        for path, proof in zip(paths, self.proofs): write(path, probe.report(self.cases, proof))
        return paths

    def test_comparison_allows_different_revisions_with_identical_footprint(self):
        before, after = self.reports(); value = probe.compare(self.cases, before, after)
        self.assertEqual(value['status'], 'complete')
        self.assertEqual(value['sourceRevisions'], ['a' * 40, 'b' * 40])
        self.assertEqual(value['changes'][0]['rawValueP1Delta'], 0.25)
        self.assertIsNone(value['acceptanceDecision']); self.assertFalse(value['sameExportedModel'])

    def test_copied_checkpoint_and_tampered_report_do_not_compare(self):
        before, after = self.reports()
        with self.assertRaisesRegex(ValueError, 'distinct checkpoint'): probe.compare(self.cases, before, before)
        with self.changed(after, lambda doc: doc['observations'][0]['raw'].update(valueP1=1)):
            with self.assertRaisesRegex(ValueError, 'report changed'): probe.compare(self.cases, before, after)

    def test_changed_dependency_inventory_is_not_a_learning_comparison(self):
        proof = self.proofs[1]; static = proof.parent / 'static.json'
        with self.changed(static, lambda doc: doc['proofDependencies'].update({'engine.ts': 'f' * 64})):
            with self.changed(proof, lambda doc: doc['identity'].update(proofDependencies={'engine.ts': 'f' * 64}, staticProof=probe.reference(static))):
                before, after = self.reports()
                with self.assertRaisesRegex(ValueError, 'footprint'): probe.compare(self.cases, before, after)

    def test_missing_evidence_comparison_is_explicit_and_outputs_are_immutable(self):
        output = self.root / 'missing.json'; comparison = self.root / 'missing-comparison.json'
        with redirect_stdout(StringIO()):
            args = ['report', '--cases', str(self.cases), '--output', str(output)]
            probe.main(args); probe.main(args)
            probe.main(['compare', '--cases', str(self.cases), '--before', str(output), '--after', str(output), '--output', str(comparison)])
            with self.assertRaisesRegex(ValueError, 'immutable'):
                probe.main(args + ['--proof', str(self.proofs[0])])
        self.assertEqual(probe.read(comparison)['status'], 'incomplete')
        self.assertEqual(probe.read(output)['status'], 'missing')


if __name__ == '__main__': unittest.main()
