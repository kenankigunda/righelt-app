"""Bounded CPU contract tests for restart-plan R-I03, R-I04 and R-I05.

Games below are small synthetic replay records; exact replay is injected at the
boundary. Existing test_runner exercises the real authoritative engine replay.
"""
import copy
import json
from pathlib import Path
import random
import tempfile
import time
import unittest
from unittest.mock import patch

import torch

from righelt_training import fresh_health, health
from righelt_training.allocation import Allocation
from righelt_training.checkpoint import atomic_json, inspect_checkpoint
from righelt_training.manifest import write_manifest
from righelt_training.model import PolicyValueNet
from righelt_training.recovery import RecoveryLedger
from righelt_training.replay import ReplayBuffer, partition_for_family, save_game
from righelt_training.runner import Runner, default_state
from righelt_training.trainer import make_optimizer, train_round


def game(index, *, masked=False, terminal=True):
    family = next(str(i) for i in range(100) if partition_for_family(str(i)) == 'train')
    identity = f'initial-game-107-{index}'
    decision = {'id': identity + ':0', 'encoded': [0.] * 4600, 'legal': [0, 2800],
                'policy': [] if masked else [{'index': 0, 'probability': 1.}], 'policyMask': not masked,
                'action': {'type': 'pass'}, 'beforeHash': f'before-{index}', 'afterHash': f'after-{index}',
                'controller': 'P1'}
    if masked:
        decision['fallback'] = {'schemaVersion': 1, 'reason': 'search-incomplete'}
    return {'id': identity, 'familyId': family, 'partition': 'train', 'seed': index, 'kind': 'normal',
            'initialState': {'fixture': index}, 'modelVersion': 'fixture-model',
            'termination': 'terminal' if terminal else 'truncated',
            'outcome': {'status': 'p1_win' if terminal else 'ongoing'},
            'finalHash': f'after-{index}', 'decisions': [decision]}


class FreshHealthTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1); torch.manual_seed(37)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def runner(self, name):
        runner = Runner.__new__(Runner)
        runner.directory = self.root / name; runner.directory.mkdir()
        runner.device = torch.device('cpu'); runner.state = default_state()
        runner.model = PolicyValueNet(); runner.optimizer = make_optimizer(runner.model)
        runner.buffer = ReplayBuffer(); runner.runtime = {}; runner.seed = 107
        runner.stage = 'initial'; runner.checkpoint_requested = False
        runner.deadline = time.monotonic() + 600; runner.last_checkpoint = time.monotonic()
        runner.ledger = RecoveryLedger(self.root)
        return runner

    def publish(self, runner):
        runner.checkpoint()
        return Path(json.loads((runner.directory / 'latest.json').read_text())['checkpoint'])

    def train(self, runner, positions=None, *, publish=True):
        result = train_round(runner.model, runner.optimizer,
                             list(runner.buffer.positions) if positions is None else positions,
                             device='cpu', seed=11, deadline=time.monotonic()+60,
                             on_batch=runner.record_training_batch,
                             evidence_game_ids=(fresh_health.eligible_game_ids(runner.state)
                                if fresh_health.STATE_KEY in runner.state else None))
        self.assertEqual(result['updates'], 1)
        return self.publish(runner) if publish else None

    def fixture(self, exploration=None):
        source = self.runner('source')
        source.stage = 'overnight'
        source.manifest_hash = write_manifest(source.directory / 'manifest.json', {'stage': 'overnight', 'seed': 107})
        inherited = game(0)
        path = save_game(source.directory / 'games', inherited)
        source.buffer.append(inherited); source.state['archives'] = [str(path.relative_to(source.directory))]
        source.state.update(round=13, phase='training', trainingBatch=7, nextJob=101,
                            curriculumSwitched=True, terminalGames=1, completedGames=1, replayChecks=1)
        checkpoint = self.train(source)
        # Preserve an unrelated old canary too, for copied/renamed exclusions.
        canary = game(-1)
        canary['id'] = 'canary-old'; canary['decisions'][0]['id'] = 'canary-old:0'
        save_game(self.root / 'diagnostic' / 'canaries' / 'old' / 'games', canary)
        evidence = self.root / 'diagnostic.json'
        atomic_json(evidence, {'workload': 'restart-diagnostic-20-v1', 'diagnosticGatePassed': True,
                              'allAttemptsAccounted': True, 'terminalGames': 16, 'scheduledGames': 20})
        contract = {'sequenceId': 'restart-test', 'phase': 'six-hour', 'budgetSeconds': 21600,
                    'reserveSeconds': 3600, 'preserveState': True, 'freshHealth': True,
                    'recoveryCheckpoint': str(checkpoint), 'recoverySha256': fresh_health.file_digest(checkpoint),
                    'predecessorEvidence': str(evidence), 'predecessorEvidenceSha256': fresh_health.file_digest(evidence)}
        if exploration is not None:
            from righelt_training import exploration_adoption as adoption
            from exploration_fixture import receipt_fixture_validation
            self.enterContext(receipt_fixture_validation())
            contract['explorationProtocol'] = adoption.PROTOCOL
        runner = self.runner('six-hour')
        creation = Allocation(self.root, runner.directory).create_continuation(contract)
        manifest = {'stage': 'initial', 'seed': 107, 'seconds': 21600, 'continuation': contract}
        if exploration is not None:
            from exploration_fixture import publish_selection
            binding = publish_selection(Allocation(self.root, runner.directory), enabled=exploration)
            manifest.update(explorationAdoption=binding,trainingRecipe=adoption.read_binding(binding)['trainingRecipe'])
        runner.manifest_hash = write_manifest(runner.directory / 'manifest.json', manifest)
        runner.manifest = json.loads((runner.directory / 'manifest.json').read_text())
        runner.runtime = {'parentCheckpointManifestSha256': source.manifest_hash, 'allocationId': creation['id']}
        runner.restore(checkpoint)
        runner.runtime['parentCheckpointManifestSha256'] = runner.manifest_hash
        (runner.directory / 'supervisor-attempts.jsonl').write_text(
            json.dumps({'event': 'started', 'id': 'train', 'phase': 'training', 'pid': 0}) + '\n' +
            json.dumps({'event': 'finished', 'id': 'train', 'phase': 'training', 'reason': 'completed'}) + '\n')
        self.publish(runner)
        return source, runner, checkpoint

    def accept(self, runner, record):
        job = {'command': 'generate', **{key: record[key] for key in
                ('id', 'seed', 'familyId', 'partition', 'kind', 'modelVersion')}}
        for key in ('trainingRecipe','explorationAdoption'):
            if key in record: job[key]=record[key]
        self.assertTrue(runner.ledger.launch(record['id'], runner.directory))
        with patch('righelt_training.runner.verify_game') as verify:
            self.assertTrue(runner.accept_game(record, time.monotonic()+60, job=job))
            verify.assert_called_once()

    def audit(self, runner):
        with patch.object(health, 'trained_export_proof', return_value=True):
            return health.audit(runner.directory, time.monotonic()+60, verifier=lambda game, deadline: None)

    def test_cross_stage_restoration_preserves_optimizer_rng_cursor_and_replay(self):
        source, runner, checkpoint = self.fixture()
        restored = inspect_checkpoint(checkpoint, manifest_sha256=source.manifest_hash, require_recovery=True)
        for key in ('round', 'trainingBatch', 'phase', 'nextJob', 'curriculumSwitched', 'updates', 'nonzeroUpdates'):
            self.assertEqual(runner.state[key], source.state[key], key)
        self.assertEqual(runner.buffer.game_ids, source.buffer.game_ids)
        self.assertEqual(runner.buffer.positions.maxlen, source.buffer.positions.maxlen)
        for name, tensor in runner.model.state_dict().items():
            self.assertTrue(torch.equal(tensor, restored['model'][name]))
        for key, entry in runner.optimizer.state_dict()['state'].items():
            for name, value in entry.items():
                other = restored['optimizer']['state'][key][name]
                self.assertTrue(torch.equal(value, other) if isinstance(value, torch.Tensor) else value == other)
        random.setstate(restored['pythonRng']); expected_python = random.random()
        torch.set_rng_state(restored['torchRng']); expected_torch = torch.rand(3)
        runner.runtime['parentCheckpointManifestSha256'] = source.manifest_hash
        runner.restore(checkpoint)
        self.assertEqual(random.random(), expected_python)
        self.assertTrue(torch.equal(torch.rand(3), expected_torch))

    def test_full_gate_requires_100_new_games_and_two_new_trained_checkpoints(self):
        _, runner, _ = self.fixture()
        for index in range(1, 100): self.accept(runner, game(index))
        self.train(runner, [runner.buffer.positions[-1]])
        self.train(runner, [runner.buffer.positions[-1]])
        result = self.audit(runner)
        self.assertTrue(result['complete'], result)
        self.assertEqual(result['terminalGames'], 100)
        self.assertEqual(result['freshTerminalGames'], 99)
        self.assertEqual(result['inheritedTerminalGames'], 1)
        self.assertFalse(result['healthy'])
        self.accept(runner, game(100)); self.publish(runner)
        result = self.audit(runner)
        self.assertTrue(result['healthy'], result)
        self.assertEqual(result['freshTerminalGames'], 100)
        self.assertEqual(result['distinctRecoverableTrainedCheckpoints'], 2)
        self.assertEqual(result['freshFiniteNonzeroUpdates'], 2)
        self.assertTrue(result['freshExamplesUsed'])
        with patch.object(health, 'trained_export_proof', return_value=False):
            result = health.audit(runner.directory, time.monotonic()+60, verifier=lambda *_: None)
        self.assertFalse(result['healthy'])

    def test_copied_renamed_canary_inherited_duplicate_and_truncated_games_excluded(self):
        _, runner, _ = self.fixture()
        copied = game(0); copied['id'] = 'initial-game-107-1000'; copied['decisions'][0]['id'] = copied['id'] + ':0'
        copied['seed'] = 1000; copied['modelVersion'] = 'different-label'
        self.accept(runner, copied)
        canary = game(-1); canary['id'] = 'initial-game-107-1001'; canary['decisions'][0]['id'] = canary['id'] + ':0'
        self.accept(runner, canary)
        self.accept(runner, game(1))
        duplicate = game(1); duplicate['id'] = 'initial-game-107-1002'; duplicate['decisions'][0]['id'] = duplicate['id'] + ':0'
        self.accept(runner, duplicate)
        self.accept(runner, game(2, terminal=False))
        self.publish(runner)
        result = self.audit(runner)
        self.assertTrue(result['complete'], result)
        self.assertEqual(result['freshTerminalGames'], 1)
        self.assertEqual(result['excludedFreshGames'], 4)
        self.assertEqual(result['inheritedTerminalGames'], 1)

    def test_nontraining_and_unlaunched_records_cannot_create_receipts(self):
        _, runner, _ = self.fixture()
        for index, command, launch in ((1, 'arena', True), (2, 'generate', False)):
            record = game(index); job = {**record, 'command': command}
            if launch: runner.ledger.launch(record['id'], runner.directory)
            with patch('righelt_training.runner.verify_game'), self.assertRaisesRegex(ValueError, 'training generation|allocation launch'):
                runner.accept_game(record, time.monotonic()+60, job=job)
        self.assertEqual(runner.state[fresh_health.STATE_KEY]['games'], {})
        self.assertEqual(len(runner.state['archives']), 1)

    def test_failed_exact_replay_never_becomes_a_fresh_game(self):
        _, runner, _ = self.fixture(); record = game(1)
        runner.ledger.launch(record['id'], runner.directory)
        with patch('righelt_training.runner.verify_game', side_effect=TimeoutError):
            self.assertFalse(runner.accept_game(record, time.monotonic()+60, job={**record, 'command': 'generate'}))
        self.assertEqual(runner.state[fresh_health.STATE_KEY]['games'], {})
        self.publish(runner); result = self.audit(runner)
        self.assertEqual(result['freshTerminalGames'], 0)

    def test_old_only_unsampled_and_masked_examples_do_not_prove_both_losses(self):
        _, runner, _ = self.fixture()
        self.accept(runner, game(1)); self.publish(runner)
        self.train(runner, [runner.buffer.positions[0]])
        result = self.audit(runner)
        self.assertEqual(result['freshTerminalGames'], 1)
        self.assertEqual(result['freshPolicyExamples'], 0)
        self.assertEqual(result['freshValueExamples'], 0)
        self.accept(runner, game(2, masked=True))
        self.train(runner, [runner.buffer.positions[-1]])
        result = self.audit(runner)
        self.assertEqual(result['freshPolicyExamples'], 0)
        self.assertEqual(result['freshValueExamples'], 1)
        self.assertFalse(result['freshExamplesUsed'])
        self.train(runner, [runner.buffer.positions[-2]])
        self.assertTrue(self.audit(runner)['freshExamplesUsed'])

    def test_repeated_publications_and_starting_weights_are_not_two_trained_checkpoints(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1))
        self.publish(runner); self.publish(runner)
        self.assertEqual(self.audit(runner)['distinctRecoverableTrainedCheckpoints'], 0)
        self.train(runner); self.publish(runner); self.publish(runner)
        self.assertEqual(self.audit(runner)['distinctRecoverableTrainedCheckpoints'], 1)
        self.train(runner)
        self.assertEqual(self.audit(runner)['distinctRecoverableTrainedCheckpoints'], 2)

    def test_uncheckpointed_batch_logs_cannot_satisfy_new_learning(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1)); self.publish(runner)
        self.train(runner, publish=False)
        self.assertIn('policyExamples', (runner.directory / 'runner-events.jsonl').read_text())
        result = self.audit(runner)
        self.assertEqual(result['freshPolicyExamples'], 0)
        self.assertEqual(result['freshFiniteNonzeroUpdates'], 0)
        self.assertEqual(result['distinctRecoverableTrainedCheckpoints'], 0)

    def test_rollback_discards_descendant_updates_and_trained_checkpoints(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1))
        before = self.publish(runner)
        orphan1 = self.train(runner); orphan2 = self.train(runner)
        self.assertEqual(self.audit(runner)['distinctRecoverableTrainedCheckpoints'], 2)
        runner.restore(before); self.publish(runner)
        self.assertTrue(orphan1.exists()); self.assertTrue(orphan2.exists())
        result = self.audit(runner)
        self.assertEqual(result['freshFiniteNonzeroUpdates'], 0)
        self.assertFalse(result['freshExamplesUsed'])
        self.assertEqual(result['distinctRecoverableTrainedCheckpoints'], 0)
        self.train(runner)
        self.assertEqual(self.audit(runner)['distinctRecoverableTrainedCheckpoints'], 1)

    def test_altered_baseline_recovery_sidecar_archive_and_allocation_fail_closed(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1)); checkpoint = self.train(runner)
        baseline_path = runner.directory / fresh_health.BASELINE_NAME
        original = baseline_path.read_bytes(); changed = json.loads(original)
        changed['baseline']['archives'] = []
        changed['sha256'] = fresh_health.digest(changed['baseline'])
        atomic_json(baseline_path, changed)
        result = self.audit(runner)
        self.assertEqual(result['unresolvedCorrectnessFailures'], 1)
        self.assertIn('baseline checksum', result['failures'][0])
        baseline_path.write_bytes(original)
        sidecar = checkpoint.with_suffix('.runner.json'); original = sidecar.read_bytes()
        changed = json.loads(original); changed['state'][fresh_health.STATE_KEY]['batches'][0]['policyExamples'] = []
        atomic_json(sidecar, changed)
        self.assertIn('sidecar binding', self.audit(runner)['failures'][0])
        sidecar.write_bytes(original)
        archive = runner.directory / runner.state['archives'][-1]; original = archive.read_bytes()
        archive.write_bytes(original + b'changed')
        self.assertIn('archive checksum', self.audit(runner)['failures'][0])
        archive.write_bytes(original)
        ledger = self.root / 'allocation-events.jsonl'
        changed = json.loads(ledger.read_text()); changed['id'] = 'changed-allocation'
        ledger.write_text(json.dumps(changed) + '\n')
        self.assertIn('allocation or starting checkpoint', self.audit(runner)['failures'][0])

    def test_forged_masked_loss_witness_and_zero_update_fail_closed(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1, masked=True)); self.train(runner)
        fresh = runner.state[fresh_health.STATE_KEY]
        fresh['batches'][0]['policyExamples'] = copy.deepcopy(fresh['batches'][0]['valueExamples'])
        self.publish(runner)
        self.assertIn('masked or missing', self.audit(runner)['failures'][0])
        fresh['batches'][0]['policyExamples'] = []
        fresh['batches'][0]['parameterDelta'] = 0
        self.publish(runner)
        self.assertIn('invalid retained fresh update', self.audit(runner)['failures'][0])

    def test_forged_sibling_reference_is_rejected_even_with_valid_checkpoint_bytes(self):
        _, runner, _ = self.fixture(); self.accept(runner, game(1)); before = self.publish(runner)
        self.train(runner)
        orphan = copy.deepcopy(runner.fresh_previous_checkpoint)
        runner.restore(before); self.train(runner)
        # The sibling took a different training update, so its retained witness
        # is not a prefix of the latest checkpoint's update history.
        runner.state[fresh_health.STATE_KEY]['batches'][0]['loss'] += .25
        runner.state[fresh_health.STATE_KEY]['checkpoints'].append(orphan)
        self.publish(runner)
        result = self.audit(runner)
        self.assertEqual(result['unresolvedCorrectnessFailures'], 1)
        self.assertIn('retained training lineage', result['failures'][0])

    def test_baseline_is_created_once_and_missing_baseline_cannot_be_reinvented(self):
        _, runner, _ = self.fixture()
        path = runner.directory / fresh_health.BASELINE_NAME
        with self.assertRaises(FileExistsError): fresh_health.immutable_json(path, {})
        checkpoint = self.publish(runner)
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'baseline missing'):
            runner.restore(checkpoint)

    def test_missing_continuation_cannot_downgrade_to_lifetime_health(self):
        _, runner, _ = self.fixture()
        path = runner.directory / 'manifest.json'
        record = json.loads(path.read_text()); del record['manifest']['continuation']
        atomic_json(path, record)
        result = self.audit(runner)
        self.assertFalse(result['healthy'])
        self.assertEqual(result['unresolvedCorrectnessFailures'], 1)
        self.assertIn('continuation manifest missing', result['failures'][0])

    def test_selected_recipe_survives_restore_and_only_new_bound_games_count(self):
        _, runner, original = self.fixture(exploration=True)
        recipe, binding = runner.training_recipe, runner.exploration_adoption
        self.assertEqual(recipe['id'], 'root-dirichlet-v1')
        original_bytes = original.read_bytes()
        baseline = copy.deepcopy(runner.fresh_baseline)
        for index in range(1, 101):
            record = game(index)
            record.update(trainingRecipe=recipe, explorationAdoption=binding)
            record['decisions'][0].update(trainingRecipe=recipe, explorationAdoption=binding,
                                         rootExploration={'recipe': recipe, 'applied': True})
            self.accept(runner, record)
        first = self.train(runner, [runner.buffer.positions[-1]])
        last = self.train(runner, [runner.buffer.positions[-1]])
        runner.restore(last)
        self.assertEqual(runner.training_recipe, recipe); self.assertEqual(runner.exploration_adoption, binding)
        self.assertEqual(runner.fresh_baseline, baseline); self.assertEqual(original.read_bytes(), original_bytes)
        result = self.audit(runner)
        self.assertTrue(result['healthy'], result)
        self.assertEqual(result['freshTerminalGames'], 100); self.assertEqual(result['inheritedTerminalGames'], 1)
        self.assertEqual(result['explorationAdoption'], binding); self.assertEqual(result['trainingRecipe'], recipe)
        self.assertEqual(result['distinctRecoverableTrainedCheckpoints'], 2)
        self.assertTrue(first.exists())
        before = len(runner.buffer.positions)
        bad = game(101)
        with self.assertRaisesRegex(ValueError, 'authorized recipe'): self.accept(runner, bad)
        self.assertEqual(len(runner.buffer.positions), before)
        self.assertTrue(list((runner.directory/'games').glob('*101*')))
        self.assertNotIn(bad['id'], runner.state[fresh_health.STATE_KEY]['games'])

    def test_inconclusive_screen_baseline_is_still_bound_for_new_games(self):
        _, runner, _ = self.fixture(exploration=False)
        self.assertEqual(runner.training_recipe['id'], 'baseline-v1')
        record = game(1)
        with self.assertRaisesRegex(ValueError, 'authorized recipe'): self.accept(runner, record)
        # The rejected launch ID remains consumed. Use a distinct next game.
        record = game(2)
        record.update(trainingRecipe=runner.training_recipe, explorationAdoption=runner.exploration_adoption)
        record['decisions'][0].update(trainingRecipe=runner.training_recipe, explorationAdoption=runner.exploration_adoption)
        self.accept(runner, record); self.train(runner, [runner.buffer.positions[-1]])
        result = self.audit(runner)
        self.assertEqual(result['freshTerminalGames'], 1); self.assertFalse(result['healthy'])


if __name__ == '__main__': unittest.main()
