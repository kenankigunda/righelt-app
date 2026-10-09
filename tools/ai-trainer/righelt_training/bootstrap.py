"""Charged proof-only entrypoint for the approved restart diagnostic.

This cannot create an allocation or run training. It produces a launch gate only
after current-source parity, process cleanup and accounting all complete.
"""
import argparse
from dataclasses import dataclass
import fcntl
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid

from .allocation import Allocation
from .budget import Budget
from .checkpoint import atomic_json, inspect_checkpoint
from .config import ROOT, CONFIG_SHA256
from .manifest import dependency_inventory, manifest_hashes
from .processes import cleanup_owned, install_stop_handlers
from .sequence import Sequence, launch_ready, immutable, read, digest
from .supervisor import run_phase, validate_gate_report


@dataclass(frozen=True)
class Policy:
    archive: str = str(ROOT / '.ai-runs')
    allocation_name: str = 'reboot-evaluation-r1'
    allocation_id: str = 'd6c16136ec0c4f688655e54e886e4674'
    checkpoint_sha256: str = '44e2ed473e30d74825993b2e04052a4d243220ea497542ced0fe608ffcd729d9'
    checkpoint_updates: int = 3309
    checkpoint_relative: str = 'overnight-r2/checkpoints/checkpoint-000942.pt'
    cap_seconds: int = 7200
    charged_floor: float = 458.080072


STATES = 1000
PROFILE = {'simulations': 8, 'temperature': 0, 'maxValueGap': 0}


def source_identity():
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        raise ValueError('bootstrap requires clean committed source')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    files = subprocess.check_output(['git', 'ls-files', '--', 'tools/ai-trainer', 'tools/ai-benchmark',
                                    'scripts/build-ai-benchmark.mjs'], cwd=ROOT, text=True).splitlines()
    return {'sourceRevision': revision, 'configSha256': CONFIG_SHA256,
            'proofDependencies': dependency_inventory(),
            'bootstrapDependencies': {name: digest(ROOT / name) for name in files}}


def runtime_identity():
    return {'python': platform.python_version(),
            'pythonExecutableSha256': digest(Path(sys.executable).resolve()),
            **{name: importlib.metadata.version(name) for name in ('torch', 'onnx', 'onnxruntime')},
            'node': subprocess.check_output(['node', '--version'], text=True, timeout=10).strip(),
            'onnxruntime-web': read(ROOT / 'node_modules/onnxruntime-web/package.json')['version'],
            'playwright': read(ROOT / 'node_modules/@playwright/test/package.json')['version']}


def evidence(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': digest(path)}


def validate_inputs(sequence, static_proof, recovery_audit, corpus, legacy_gate, policy):
    identity = source_identity()
    static = read(static_proof)
    for key in ('sourceRevision', 'configSha256', 'proofDependencies'):
        if static.get(key) != identity[key]: raise ValueError('static proof does not match current source: ' + key)
    for name in ('coreTests', 'trainerTests', 'exactReplay'):
        check = static.get('checks', {}).get(name, {})
        if check.get('passed') is not True or not check.get('evidence') or digest(check['evidence']) != check.get('sha256'):
            raise ValueError('missing or changed static proof: ' + name)
    repair = static.get('repair', {})
    if (repair.get('sourceRevision') != identity['sourceRevision']
            or not repair.get('cause') or not repair.get('artifactDisposition')):
        raise ValueError('current-source reviewed repair record required')
    for name in ('regressionEvidence', 'reviewEvidence'):
        records = repair.get(name)
        if (not isinstance(records, list) or not records
                or any(not row.get('path') or digest(row['path']) != row.get('sha256') for row in records)):
            raise ValueError('missing or changed repair evidence: ' + name)
    checkpoint = Path(sequence.config['recoveryCheckpoint']).resolve()
    if (checkpoint != (Path(policy.archive) / policy.checkpoint_relative).resolve()
            or digest(checkpoint) != policy.checkpoint_sha256):
        raise ValueError('bootstrap is restricted to the approved checkpoint')
    meta = read(checkpoint.with_suffix('.json'))
    if meta['manifestSha256'] not in manifest_hashes(checkpoint.parent.parent):
        raise ValueError('recovery checkpoint manifest is not authorized')
    data = inspect_checkpoint(checkpoint, manifest_sha256=meta['manifestSha256'], require_recovery=True)
    audit = read(recovery_audit)
    if (audit.get('passed') is not True or audit.get('sourceRevision') != identity['sourceRevision']
            or audit.get('checkpoint') != str(checkpoint) or audit.get('sha256') != policy.checkpoint_sha256
            or audit.get('updates') != data['updates'] or data['updates'] != policy.checkpoint_updates
            or not data.get('optimizer') or audit.get('recoverySha256') != data['recoverySha256']):
        raise ValueError('current recovery audit does not match the full checkpoint bundle')
    # This is inherited initial health, never current fresh-work evidence.
    legacy = read(legacy_gate)
    health = legacy.get('health', {})
    if (not legacy.get('sourceRevision') or legacy.get('configSha256') != CONFIG_SHA256
            or health.get('terminalGames', 0) < 100 or health.get('distinctRecoverableTrainedCheckpoints', 0) < 2
            or health.get('finiteNonzeroUpdates') is not True or health.get('unresolvedCorrectnessFailures', 1) != 0
            or health.get('trainedExportParityPassed') is not True or health.get('unfinishedAttempts', [])
            or health.get('progressReportPublished') is not True or not legacy.get('progressReport')):
        raise ValueError('inherited initial health or progress-report evidence is incomplete')
    return {**identity, 'runtime': runtime_identity(), 'sequenceId': sequence.config['sequenceId'],
            'sequence': evidence(sequence.path), 'checkpoint': evidence(checkpoint),
            'staticProof': evidence(static_proof), 'recoveryAudit': evidence(recovery_audit),
            'corpus': evidence(corpus), 'legacyGate': evidence(legacy_gate)}


def validate_identity(identity):
    current = source_identity()
    if any(identity.get(key) != value for key, value in current.items()) or identity['runtime'] != runtime_identity():
        raise ValueError('source, dependencies or runtime changed during proof')
    for name in ('sequence', 'checkpoint', 'staticProof', 'recoveryAudit', 'corpus', 'legacyGate'):
        if digest(identity[name]['path']) != identity[name]['sha256']:
            raise ValueError('bootstrap input changed: ' + name)


def validate_outputs(attempt, identity):
    attempt = Path(attempt)
    corpus = read(identity['corpus']['path']); ids = [row['id'] for row in corpus['states']]
    checked = read(attempt / 'corpus-check.json')
    native = read(attempt / 'numeric/parity-report.json')
    raw = read(attempt / 'native-raw.json'); search = read(attempt / 'native-search.json')
    numeric = read(attempt / 'browser-numeric.json'); tactical = read(attempt / 'browser-search-proof.json')
    observed = read(attempt / 'browser-search.json'); built = read(attempt / 'benchmark/manifest.json')
    model_sha = digest(attempt / 'numeric/model.onnx')
    errors = native.get('maxAbsoluteError', [])
    if (len(ids) != STATES or len(set(ids)) != STATES or checked.get('passed') is not True
            or checked.get('states') != STATES or checked.get('corpusSha256') != identity['corpus']['sha256']):
        raise ValueError('current engine corpus verification is incomplete')
    if (native.get('numericPassed') is not True or native.get('states') != STATES
            or native.get('heldoutStates') != STATES or native.get('referenceDevice') != 'mps'
            or native.get('trainedCheckpoint') is not True or native.get('configSha256') != CONFIG_SHA256
            or native.get('corpusSha256') != identity['corpus']['sha256']
            or native.get('atol') != 1e-5 or native.get('rtol') != 1e-4
            or len(errors) != 2 or any(type(n) not in (int, float) or not math.isfinite(n) or n < 0 for n in errors)
            or native.get('export', {}).get('sha256') != model_sha):
        raise ValueError('native MPS numeric proof is incomplete')
    if (raw.get('modelSha256') != model_sha or raw.get('referenceDevice') != 'mps'
            or raw.get('corpusSha256') != identity['corpus']['sha256']
            or [row['id'] for row in raw.get('states', [])] != ids
            or search.get('complete') is not True or search.get('referenceDevice') != 'mps'
            or search.get('modelSha256') != model_sha or digest(attempt / 'native-search.onnx') != model_sha
            or search.get('corpusSha256') != identity['corpus']['sha256'] or search.get('profile') != PROFILE
            or [row['id'] for row in search.get('states', [])] != ids
            or any(row['seed'] != 107+i or row['result'].get('status') != 'ready'
                   or row['result'].get('stopped') not in ('complete', 'node-limit')
                   for i, row in enumerate(search['states']))):
        raise ValueError('1000-state native search reference is incomplete or mismatched')
    if (numeric.get('numericParityPassed') is not True or numeric.get('legalMasksIdentical') is not True
            or numeric.get('states') != STATES or numeric.get('referenceDevice') != 'mps'
            or numeric.get('backend') != 'wasm' or numeric.get('threads') != 1
            or numeric.get('corpusSha256') != identity['corpus']['sha256'] or numeric.get('modelSha256') != model_sha
            or not numeric.get('browserVersion') or tactical.get('browserVersion') != numeric['browserVersion']
            or tactical.get('states') != STATES or tactical.get('tacticalOutcomesVerified') is not True
            or tactical.get('modelSha256') != model_sha or tactical.get('referenceDevice') != 'mps'
            or observed.get('modelVersion') != model_sha or [row['id'] for row in observed.get('results', [])] != ids):
        raise ValueError('1000-state browser numeric/legal/tactical proof is incomplete')
    if built.get('modelVersion') != model_sha or built.get('runtimeVersion') != identity['runtime']['onnxruntime-web']:
        raise ValueError('browser runtime or model identity mismatch')
    if set(built.get('assets', {})) != {'worker', 'model', 'corpus', 'runtimeMjs', 'runtimeWasm'}:
        raise ValueError('browser runtime artifact inventory incomplete')
    for asset in built['assets'].values():
        path = (attempt / 'benchmark' / asset['path']).resolve()
        if not path.is_relative_to((attempt / 'benchmark').resolve()) or digest(path) != asset['sha256']:
            raise ValueError('browser proof asset changed')
    names = ('corpus-check.json', 'numeric/parity-report.json', 'numeric/model.onnx', 'native-raw.json',
             'native-search.json', 'native-search.onnx', 'browser-raw.json', 'browser-numeric.json', 'browser-search.json',
             'browser-search-proof.json', 'benchmark/manifest.json')
    return {'complete': True, 'passed': True, 'identity': identity, 'heldoutStates': STATES,
            'modelSha256': model_sha, 'browserVersion': numeric['browserVersion'],
            'artifacts': {name: evidence(attempt / name) for name in names},
            'legalMasksPassed': True, 'tacticalParityPassed': True, 'productionPromotion': False}


def make_gate(attempt, identity, proof):
    static = read(identity['staticProof']['path']); legacy = read(identity['legacyGate']['path'])
    audit = read(identity['recoveryAudit']['path'])
    # sequence.immutable uses this canonical serialization. Construct the gate
    # under the charged interval; publish only once accounting confirms cleanup.
    proof_ref = {'path': str(attempt / 'complete-evidence.json'),
                 'sha256': hashlib.sha256(json.dumps(proof, sort_keys=True, allow_nan=False).encode()).hexdigest()}
    gate = {**{key: identity[key] for key in ('sourceRevision', 'configSha256', 'proofDependencies')},
            'checks': {key: static['checks'][key] for key in ('coreTests', 'trainerTests', 'exactReplay')},
            'health': legacy['health'], 'progressReport': legacy['progressReport'],
            'inheritedHealthEvidence': {**identity['legacyGate'], 'sourceRevision': legacy['sourceRevision']},
            'repair': static['repair'],
            'resumeCheckpoint': {**audit, 'auditPath': identity['recoveryAudit']['path'], 'auditSha256': identity['recoveryAudit']['sha256']},
            'bootstrapEvidence': proof_ref, 'productionPromotion': False}
    gate['checks']['exportParity'] = {'passed': True, 'heldoutStates': STATES, 'legalMasksPassed': True,
            'tacticalParityPassed': True, 'evidence': proof_ref['path'], 'sha256': proof_ref['sha256'],
            'numericEvidence': str(attempt / 'browser-numeric.json')}
    validate_gate_report(gate, identity['sourceRevision'], 'overnight')
    return gate


def run(sequence_directory, *, static_proof, recovery_audit, corpus, legacy_gate,
        completion, snapshot, activity_file, policy=Policy()):
    sequence_directory = Path(sequence_directory).resolve(); root = sequence_directory.parent
    if root != Path(policy.archive).resolve(): raise ValueError('bootstrap archive differs from approved allocation')
    with (root / 'coordinator.lock').open('a+') as coordinator, (root / 'supervisor.lock').open('a+') as supervisor:
        fcntl.flock(coordinator, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(supervisor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sequence = Sequence(sequence_directory)
        if sequence.config.get('launchHold'): raise ValueError('sequence launch held: ' + str(sequence.config['launchHold']))
        live = launch_ready(read(completion), read(snapshot), required=sequence.prerequisites)
        if read(activity_file) != live: raise ValueError('activity file does not match the current task snapshot')
        if sequence.next_phase() != 'diagnostic': raise ValueError('bootstrap only belongs to the diagnostic phase')
        identity = validate_inputs(sequence, static_proof, recovery_audit, corpus, legacy_gate, policy)
        directory = Path(sequence.config['diagnosticDirectory']).resolve()
        if directory != root / policy.allocation_name: raise ValueError('bootstrap diagnostic directory changed')
        allocation = Allocation(root, directory)
        created, charged, _ = allocation.accounting()
        if (created['id'] != policy.allocation_id or sequence.config['diagnosticAllocationId'] != policy.allocation_id
                or created['seconds'] != policy.cap_seconds or not math.isfinite(charged) or charged < policy.charged_floor - 1e-6):
            raise ValueError('bootstrap must use the original diagnostic allowance')
        allocation.recover_abandoned(cleanup_owned)
        claim = sequence.claim(read(completion), read(snapshot))
        if claim.get('phase') != 'diagnostic' or claim.get('runDirectory') != str(directory):
            raise ValueError('missing diagnostic claim')
        interval, remaining, charged = allocation.begin('bootstrap-proof')
        attempt = directory / 'bootstrap' / uuid.uuid4().hex
        reason = 'interrupted'; proof = None; cleaned = False
        try:
            attempt.mkdir(parents=True, exist_ok=False)
            now = interval['monotonic']; wall = interval['wall']
            runtime = {'schema': 1, 'command': 'bootstrap-proof', 'supervisorPid': os.getpid(),
                       'startedMonotonic': now, 'deadlineMonotonic': now + remaining,
                       'deadlineWall': wall + remaining, 'allocationId': created['id'], 'allocationInterval': interval['id']}
            plan = {'schema': 1, 'identity': identity, 'runDirectory': str(directory), 'runtime': runtime,
                    'interval': interval, 'remainingSeconds': remaining, 'chargedBefore': charged}
            immutable(attempt / 'plan.json', plan)
            atomic_json(directory / 'runtime.json', runtime)
            argv = [sys.executable, '-m', 'righelt_training.bootstrap_worker', '--attempt', str(attempt)]
            with (attempt / 'worker.log').open('x') as log:
                reason, process = run_phase(argv, {**os.environ, 'PYTHONPATH': str(ROOT / 'tools/ai-trainer')},
                    log, Budget(now, remaining, wall + remaining), runtime, directory, root, Path(activity_file))
            if reason != 'completed' or process is None or process.returncode != 0:
                raise RuntimeError('bootstrap proof did not complete: ' + reason)
            validate_identity(identity)
            worker = read(attempt / 'worker-complete.json')
            if (worker.get('identity') != identity or worker.get('complete') is not True
                    or worker.get('runtime') != identity['runtime']):
                raise ValueError('worker completion identity mismatch')
            proof = validate_outputs(attempt, identity)
            gate = make_gate(attempt, identity, proof)
            reason = 'completed'
        except BaseException:
            if reason == 'completed': reason = 'proof-rejected'
            raise
        finally:
            try:
                cleanup_owned(directory); cleaned = True
                if proof is not None:
                    validate_identity(identity)
                    if validate_inputs(sequence, static_proof, recovery_audit, corpus, legacy_gate, policy) != identity:
                        raise ValueError('recovery or static proof changed before publication')
                    if validate_outputs(attempt, identity) != proof:
                        raise ValueError('proof artifacts changed before publication')
            except BaseException:
                proof = None
                if cleaned: reason = 'proof-rejected'
                raise
            finally:
                if cleaned: allocation.finish(interval['id'], reason=reason)
                if attempt.exists():
                    immutable(attempt / 'result.json', {'reason': reason, 'cleanupVerified': cleaned,
                              'interval': interval['id'], 'workerCompleted': proof is not None})
        _, total, pending = allocation.accounting()
        if pending or total > created['seconds']: raise ValueError('bootstrap budget exhausted before proof publication')
        immutable(attempt / 'complete-evidence.json', proof)
        if digest(attempt / 'complete-evidence.json') != gate['bootstrapEvidence']['sha256']:
            raise ValueError('published proof identity changed')
        immutable(attempt / 'gate.json', gate)
        return {'gate': str(attempt / 'gate.json'), 'sha256': digest(attempt / 'gate.json'),
                'allocationId': created['id'], 'chargedSeconds': total, 'remainingSeconds': created['seconds']-total}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('sequence-directory', 'static-proof', 'recovery-audit', 'corpus', 'legacy-gate', 'completion', 'snapshot', 'activity-file'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = vars(parser.parse_args()); directory = args.pop('sequence_directory')
    install_stop_handlers()
    print(json.dumps(run(directory, **args), indent=2))


if __name__ == '__main__': main()
