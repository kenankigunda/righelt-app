import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import gzip
import hashlib
import os
import signal
import subprocess
import sys
import time

from righelt_training.config import CONFIG
from righelt_training.learning_data import report, phase_of, exposure, search_metrics, sha, checkpoint_games, journal_snapshot, inherited_games
from righelt_training.replay import partition_for_family
from righelt_training.start_inventory import candidates, verify_inventory, source_snapshot


def game(identity='one', phase='none', terminal=True):
    family = next(f'f{i}' for i in range(1000) if partition_for_family(f'f{i}') == 'train')
    encoded = [0.] * (CONFIG['inputPlanes'] * CONFIG['boardSize'] ** 2)
    offset = CONFIG['planes'].index('phase.' + phase) * CONFIG['boardSize'] ** 2
    encoded[offset:offset+100] = [1.] * 100
    decision = {'id': identity + ':0', 'beforeHash': identity, 'afterHash': identity + '-after', 'controller': 'P2',
                'action': {'type': 'pass'}, 'encoded': encoded, 'legal': [0, 1], 'policyMask': True, 'fallback': None,
                'policy': [{'index': 0, 'probability': 1.}], 'search': {'reason': 'search', 'stopped': 'complete',
                  'actions': [{'index': 0, 'prior': .5, 'visits': 8}, {'index': 1, 'prior': .5, 'visits': 0}]}}
    return {'id': identity, 'partition': 'train', 'familyId': family, 'kind': 'simple', 'decisions': [decision],
            'initialState': {'outcome': {'status': 'ongoing'}}, 'rootState': {}, 'warmupActions': [],
            'termination': 'terminal' if terminal else 'truncated', 'outcome': {'status': 'p2_win' if terminal else 'ongoing'},
            'finalHash': identity + '-after'}


class LearningDataTest(unittest.TestCase):
    def test_valid_but_unrelated_baseline_cannot_classify_inherited_data(self):
        with tempfile.TemporaryDirectory() as directory:
            data = {'sha256': 'baseline-a', 'baseline': {'allocationId': 'allocation-a',
                    'continuation': {}, 'archives': [{'gameId': 'old'}]}}
            (Path(directory)/'fresh-health-baseline.json').write_text(json.dumps(data))
            identity = {'freshBaseline': {'allocationId': 'allocation-a', 'baselineSha256': 'baseline-a'}}
            with patch('righelt_training.fresh_health.load_baseline', return_value=data):
                self.assertEqual(inherited_games(Path(directory), identity), {'old'})
                for field in ('allocationId', 'baselineSha256'):
                    wrong = copy.deepcopy(identity); wrong['freshBaseline'][field] = 'unrelated'
                    with self.assertRaisesRegex(ValueError, 'retained checkpoint'):
                        inherited_games(Path(directory), wrong)

    def test_relocated_checkpoint_retains_absolute_archive_keys_and_replay_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); checkpoint = root/'new/checkpoints/checkpoint.pt'
            checkpoint.parent.mkdir(parents=True); checkpoint.write_bytes(b'checkpoint')
            checkpoint.with_suffix('.json').write_text(json.dumps({'manifestSha256': 'manifest', 'sha256': sha(checkpoint)}))
            old = root/'old.json.gz'; old.write_bytes(gzip.compress(json.dumps(game('old')).encode()))
            new = root/'new/new.json.gz'; new.write_bytes(gzip.compress(json.dumps(game('new')).encode()))
            data = {'updates': 7, 'recoverySha256': 'bound', 'replayIds': [str(old), 'new.json.gz'],
                    'recovery': {'state': {}, 'archives': {'new.json.gz': sha(new), str(old): sha(old)}}}
            with patch('righelt_training.checkpoint.inspect_checkpoint', return_value=data):
                _, archives = checkpoint_games(checkpoint)
            self.assertEqual([a['game']['id'] for a in archives], ['old', 'new'])

    def test_live_journal_hash_covers_exact_snapshot_and_marks_partial_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'events'; raw = b'{"type":"first"}\n{"type":'
            p.write_bytes(raw); events, identity = journal_snapshot(p)
            p.write_bytes(raw+b'"second"}\n')
            self.assertEqual(events, [{'type': 'first'}])
            self.assertEqual(identity['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertGreater(identity['partialTailBytes'], 0)
            self.assertNotEqual(identity['sha256'], sha(p))
    def test_masks_coverage_entropy_and_controller_phase(self):
        first = game(); second = game('two', 'retreat', False)
        d = second['decisions'][0]; d.update(policyMask=False, policy=[], fallback={'reason': 'safety-incomplete'})
        result = report([first, second])
        total = result['retainedArchives']
        self.assertEqual((total['games'], total['terminalGames'], total['policySupervised'], total['valuePositions']), (2, 1, 1, 1))
        self.assertEqual(total['fallbackRate'], .5)
        self.assertEqual(total['metrics']['visitedFraction'], {'observations': 2, 'mean': .5})
        self.assertEqual(total['metrics']['policyEntropy']['observations'], 1)
        self.assertIn('P2|retreat', result['byControllerPhase'])
        self.assertGreater(total['metrics']['priorTargetJensenShannon']['mean'], 0)

    def test_old_positions_cannot_inflate_current_allocation_rates(self):
        old, new = game('old'), game('new')
        events = [{'type': 'game', 'id': 'new', 'termination': 'terminal', 'policyPositions': 1, 'valuePositions': 1}]
        result = report([old, new], events, 3600)
        self.assertEqual(result['retainedArchives']['terminalGames'], 2)
        self.assertEqual(result['retainedAllocation']['perChargedHour']['terminalGames'], 1)
        self.assertEqual(report([old], events, 3600)['retainedAllocation']['perChargedHour']['terminalGames'], 0)

    def test_legacy_exposure_is_unknown_and_actual_counts_conserve_masks(self):
        events = [{'type': 'training-batch', 'positions': 2},
                  {'type': 'training-batch', 'positions': 3, 'policyPositions': 2, 'valuePositions': 1,
                   'sampledGames': [{'gameId': 'old', 'positions': 2, 'policyPositions': 1, 'valuePositions': 0},
                                    {'gameId': 'new', 'positions': 1, 'policyPositions': 1, 'valuePositions': 1}]}]
        r = exposure(events, [game('old'), game('new')], {'old'})
        self.assertEqual(r['unattributedLegacyPositions'], 2)
        self.assertEqual(r['byGame']['old']['origin'], 'inherited')
        self.assertEqual(r['byGame']['old']['archiveAgeGames'], 1)
        self.assertEqual(r['byGame']['new']['origin'], 'new')
        events[1]['sampledGames'][0]['positions'] = 1
        with self.assertRaisesRegex(ValueError, 'mismatch'): exposure(events, [])

    def test_sealed_partitions_duplicate_ids_and_invalid_targets_rejected(self):
        bad = game(); bad['partition'] = 'final'
        with self.assertRaises(ValueError): report([bad])
        bad = game(); bad['familyId'] = next(f'f{i}' for i in range(1000) if partition_for_family(f'f{i}') == 'final')
        with self.assertRaises(ValueError): report([bad])
        with self.assertRaises(ValueError): report([game(), game()])
        bad = game(); bad['decisions'][0]['policy'][0]['probability'] = float('nan')
        with self.assertRaises(ValueError): report([bad])
        bad = game(); bad['decisions'][0]['encoded'] = [0] * 4600
        with self.assertRaises(ValueError): phase_of(bad['decisions'][0])

    def test_missing_legacy_search_is_not_zero_coverage(self):
        row = game()['decisions'][0]; del row['search']
        self.assertEqual(search_metrics(row), {'policyEntropy': 0})


class InventoryTest(unittest.TestCase):
    def test_inventory_dependency_identity_reads_current_config_bytes(self):
        from righelt_training.config import ROOT, CONFIG_PATH
        before = source_snapshot()
        actual_sha = sha
        with patch('righelt_training.start_inventory.sha', side_effect=lambda p: 'changed' if Path(p) == CONFIG_PATH else actual_sha(p)):
            after = source_snapshot()
        self.assertNotEqual(before, after)
        self.assertEqual(after[str(CONFIG_PATH.relative_to(ROOT))], 'changed')

    def test_inventory_sigterm_cleans_up_its_engine_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); archive=root/'archive'; archive.write_text('bound')
            fixture=root/'game.json'; fixture.write_text(json.dumps(game()))
            pidfile=root/'child.pid'; worker=root/'wait.mjs'
            worker.write_text("import fs from 'node:fs'; fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(()=>{},1000); process.stdin.resume();")
            # Exercise main's handler and runner's real subprocess cleanup. The
            # fake worker deliberately blocks, without model or game work.
            code="""
import json,sys
from pathlib import Path
from righelt_training import start_inventory as inventory, runner
from righelt_training.learning_data import sha
root=Path(sys.argv[1]); game=json.loads((root/'game.json').read_text())
original=runner.subprocess.Popen
def launch(argv,**kwargs):
 return original(['node',str(root/'wait.mjs'),str(root/'child.pid')],**kwargs)
runner.subprocess.Popen=launch
inventory.checkpoint_games=lambda p: ({},[{'game':game,'path':str(root/'archive'),'sha256':sha(root/'archive')}])
sys.argv=['inventory','--checkpoint',str(root/'unused'),'--output',str(root/'output'),'--verify-seconds','30']
inventory.main()
"""
            child=None
            process=subprocess.Popen([sys.executable,'-c',code,str(root)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                deadline=time.monotonic()+8
                while not pidfile.exists() and process.poll() is None and time.monotonic()<deadline:time.sleep(.02)
                self.assertTrue(pidfile.exists())
                child=int(pidfile.read_text());process.send_signal(signal.SIGTERM)
                _,error=process.communicate(timeout=4)
                self.assertEqual(process.returncode,143,error.decode())
                with self.assertRaises(ProcessLookupError):os.kill(child,0)
                self.assertFalse((root/'output').exists())
            finally:
                if process.poll() is None:process.kill()
                process.communicate(timeout=3)
                if child:
                    try:os.kill(child,signal.SIGKILL)
                    except ProcessLookupError:pass

    def test_balanced_deterministic_selection_and_dedup(self):
        items = [{'game': game(str(i), phase), 'path': f'{i}.gz', 'sha256': 'sha'} for i, phase in enumerate(('none', 'retreat', 'follow', 'rush'))]
        result = candidates(items, 4)
        self.assertEqual(len(result['selected']), 4)
        self.assertEqual(result, candidates(list(reversed(items)), 4))
        self.assertFalse(result['adoptedByCurriculum'])
        self.assertEqual(len(result['missingCoverage']), 4)
        duplicate = copy.deepcopy(items[0]); duplicate['game']['id'] = 'copy'
        self.assertEqual(len(candidates(items + [duplicate], 32)['selected']), 4)

    def test_real_file_binding_bounded_replay_and_no_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'archive'; p.write_text('bound')
            g = game(); items = [{'game': g, 'path': str(p), 'sha256': sha(p)}]
            inv = candidates(items)
            calls = []
            def engine(job, timeout):
                calls.append((job, timeout))
                return {'type': 'inventoried', 'hash': g['finalHash'], 'states': [{'index': 0, 'state': g['initialState'],
                        'hash': 'one', 'decisionId': 'one:0', 'controller': 'P2'}]}
            r = verify_inventory(inv, items, 1, engine=engine)
            self.assertEqual(len(r['verifiedStates']), 1)
            self.assertEqual(calls[0][0]['command'], 'inventory')
            self.assertLessEqual(calls[0][1], 1)
            r = verify_inventory(inv, items, 1, engine=lambda *a, **k: {'type': 'unfinished', 'reason': 'node-limit'})
            self.assertEqual(r['verifiedStates'], [])
            self.assertEqual(len(r['verificationAttempts']), 1)
            p.write_text('altered')
            with self.assertRaisesRegex(ValueError, 'changed'): verify_inventory(inv, items, 1, engine=engine)

    def test_correctness_failure_does_not_become_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'archive'; p.write_text('bound')
            items = [{'game': game(), 'path': str(p), 'sha256': sha(p)}]
            with self.assertRaises(ValueError):
                verify_inventory(candidates(items), items, 1, engine=lambda *a, **k: {'type': 'error', 'message': 'illegal'})

    def test_source_mutation_during_replay_cannot_publish_verified_states(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'archive'; p.write_text('bound'); g = game()
            items = [{'game': g, 'path': str(p), 'sha256': sha(p)}]
            answer = {'type': 'inventoried', 'hash': g['finalHash'], 'states': [{'index': 0,
                      'state': g['initialState'], 'hash': 'one', 'decisionId': 'one:0', 'controller': 'P2'}]}
            with patch('righelt_training.start_inventory.source_snapshot', side_effect=[{'a': 'old'}, {'a': 'new'}]):
                with self.assertRaisesRegex(ValueError, 'source changed'):
                    verify_inventory(candidates(items), items, 1, engine=lambda *a, **k: answer)


if __name__ == '__main__': unittest.main()
