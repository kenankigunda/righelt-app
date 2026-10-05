"""Optional native development observations inside an existing export phase.

No allocation, model creation, export, optimizer or standalone launch entrypoint.
The caller must first publish successful trained-export-parity.json and keep its
supervisor alive. The existing supervisor enforces operation-status.json even
if a model forward stalls. Every invocation retains a separate immutable attempt.
"""
import os
from pathlib import Path
import re
import time
import uuid

import torch

from .bootstrap import source_identity, runtime_identity, PROFILE
from .budget import effective_deadline
from .checkpoint import atomic_json, weights_sha256
from .config import CONFIG, CONFIG_SHA256
from .development_probe import (checked_ref, checksum, corpus_rows, load_cases, observations,
                                read, reference, report, SEARCH_DEPENDENCIES)
from .search_parity import search_reference
from .sequence import immutable

MAX_SECONDS = 60
CLEANUP_SECONDS = 2


def resource_ready(directory):
    allocation = read(Path(directory) / 'allocation.json')
    return (allocation.get('paused') is False and allocation.get('stop') is False
            and allocation.get('workers', 0) >= 1 and allocation.get('reason') != 'initial-conservative')


def model_weights(model):
    return weights_sha256(model.state_dict())


def model_device(model):
    return str(next(model.parameters()).device)


def checkpoint_weights(path):
    data = torch.load(path, map_location='cpu', weights_only=True)
    if data.get('configSha256') != CONFIG_SHA256 or data.get('updates', 0) <= 0:
        raise ValueError('development checkpoint is not compatible trained state')
    return weights_sha256(data['model'])


def validate_identity(identity, cases):
    if (not re.fullmatch('[0-9a-f]{40}', identity.get('sourceRevision', ''))
            or not re.fullmatch('[0-9a-f]{64}', identity.get('modelWeightsSha256', ''))
            or any(not isinstance(identity.get(key), dict) or not identity[key]
                   or any(not re.fullmatch('[0-9a-f]{64}', value) for value in identity[key].values())
                   for key in ('proofDependencies', 'bootstrapDependencies'))):
        raise ValueError('stage development source/model identity missing')
    for key in ('checkpoint', 'corpus', 'cases', 'export', 'parity', 'manifest', 'runtimeRecord'):
        checked_ref(identity[key])
    parity = read(identity['parity']['path']); manifest = read(identity['manifest']['path'])
    runtime = read(identity['runtimeRecord']['path'])
    if (identity['configSha256'] != cases['configSha256'] or identity['corpus'] != cases['corpus']
            or identity['cases']['sha256'] != reference(identity['cases']['path'])['sha256']
            or read(identity['cases']['path']) != cases or checksum(manifest['manifest']) != manifest['sha256']
            or manifest['manifest']['sourceRevision'] != identity['sourceRevision']
            or runtime.get('manifestSha256') != manifest['sha256'] or runtime.get('command') != 'export-parity'
            or runtime.get('parityCorpusSha256') != cases['corpus']['sha256']
            or runtime.get('developmentCasesSha256') != identity['cases']['sha256']
            or parity.get('complete') is not True or parity.get('numericPassed') is not True
            or parity.get('trainedCheckpoint') is not True or parity.get('referenceDevice') != 'mps'
            or parity.get('heldoutStates') != 1000 or parity.get('configSha256') != CONFIG_SHA256
            or parity.get('checkpointSha256') != identity['checkpoint']['sha256']
            or parity.get('manifestSha256') != manifest['sha256']
            or parity.get('sourceRevision') != identity['sourceRevision']
            or parity.get('corpusSha256') != cases['corpus']['sha256']
            or parity.get('export', {}).get('sha256') != identity['export']['sha256']
            or not identity.get('modelWeightsSha256')):
        raise ValueError('stage development identity does not match supervised trained export')
    if any(not identity['bootstrapDependencies'].get(name) for name in SEARCH_DEPENDENCIES):
        raise ValueError('stage development search dependency inventory missing')


def identity_for(model, checkpoint, corpus, cases_path, directory, attempt):
    from .manifest import active_manifest
    source = source_identity(); checkpoint_ref = reference(checkpoint)
    asset = directory / 'trained-export' / (checkpoint_ref['sha256'] + '.onnx')
    manifest = active_manifest(directory)
    # Bind the immutable manifest revision rather than a mutable active pointer.
    manifest_path = directory / 'manifest.json'
    if read(manifest_path) != manifest: manifest_path = directory / 'manifests' / (manifest['sha256'] + '.json')
    # Phase status files are mutable; archive their exact input snapshots so a
    # later health/export phase cannot invalidate a completed observation.
    for name in ('trained-export-parity.json', 'runtime.json'):
        immutable(attempt / name, read(directory / name))
    identity = {**source, 'runtime': runtime_identity(), 'checkpoint': checkpoint_ref, 'corpus': reference(corpus),
                'cases': reference(cases_path), 'export': reference(asset),
                'parity': reference(attempt / 'trained-export-parity.json'), 'manifest': reference(manifest_path),
                'runtimeRecord': reference(attempt / 'runtime.json'), 'modelWeightsSha256': model_weights(model)}
    if model.training or model_device(model) != 'mps' or identity['modelWeightsSha256'] != checkpoint_weights(checkpoint):
        raise ValueError('loaded development model differs from the exported checkpoint/eval device')
    runtime = read(identity['runtimeRecord']['path'])
    if runtime.get('supervisorPid') != os.getppid() or os.getpgrp() != os.getpid():
        raise ValueError('development collection requires the existing export supervisor')
    return identity


class GuardedModel:
    def __init__(self, model, frozen, check):
        self.model = model; self.frozen = frozen; self.check = check; self.raw = None

    def __call__(self, inputs):
        self.check()
        shape = (1, CONFIG['inputPlanes'], CONFIG['boardSize'], CONFIG['boardSize'])
        if tuple(inputs.shape) != shape or inputs.dtype != torch.float32 or not torch.isfinite(inputs).all():
            raise ValueError('invalid development input shape, dtype or values')
        root = self.raw is None
        if root:
            expected = torch.tensor(self.frozen['encoded'], dtype=torch.float32).reshape(shape)
            if not torch.equal(inputs.detach().cpu(), expected):
                raise ValueError('current engine root encoding differs from frozen case')
        with torch.inference_mode(): policy, value = self.model(inputs)
        self.check()
        if (tuple(policy.shape) != (1, CONFIG['actionCount']) or tuple(value.shape) != (1,)
                or not torch.isfinite(policy).all() or not torch.isfinite(value).all() or value.abs().max().item() > 1):
            raise ValueError('invalid development model output')
        if root:
            self.raw = {'id': self.frozen['id'], 'legal': self.frozen['legal'],
                        'policyLogits': policy[0].cpu().tolist(), 'value': value[0].item()}
        return policy, value


def validate_case(case, frozen, receipt):
    search = receipt['searched']; result = search['result']
    if (not isinstance(receipt.get('raw'), dict) or receipt['id'] != case['id'] or receipt['rowSha256'] != case['rowSha256']
            or receipt['raw']['id'] != case['id'] or search['id'] != case['id']
            or search['seed'] != 107 + case['corpusIndex'] or result.get('status') != 'ready'
            or result.get('stopped') not in ('complete', 'node-limit')
            or result.get('legality', {}).get('complete') is not True
            or result['legality']['indices'] != frozen['legal']
            or receipt.get('rootEncodingSha256') != checksum(frozen['encoded'])):
        raise ValueError('stage development case identity, encoding, legal mask or search changed')
    return observations(case, frozen, receipt['raw'], search)


def read_proof(path, cases):
    proof_ref = reference(path); proof = read(path); identity = proof['identity']
    if (proof.get('schema') != 1 or proof.get('kind') != 'stage-development-proof'
            or proof.get('complete') is not True or proof.get('passed') is not True
            or proof.get('profile') != PROFILE or proof.get('referenceDevice') != 'mps'
            or proof.get('expectedCaseIds') != [case['id'] for case in cases['cases']]
            or len(proof.get('receipts', [])) != len(cases['cases'])):
        raise ValueError('incomplete or incompatible stage development proof')
    validate_identity(identity, cases)
    if checkpoint_weights(identity['checkpoint']['path']) != identity['modelWeightsSha256']:
        raise ValueError('development weights do not match bound checkpoint')
    rows = corpus_rows(cases['corpus']['path']); output = []
    for case, record in zip(cases['cases'], proof['receipts'], strict=True):
        receipt_path = checked_ref(record)
        if receipt_path.parent != Path(path).resolve().parent: raise ValueError('case receipt escapes attempt')
        receipt = read(receipt_path)
        if receipt.get('status') != 'complete': raise ValueError('partial case cannot complete development proof')
        output.append(validate_case(case, rows[case['corpusIndex']], receipt))
    validate_identity(identity, cases)
    for record in proof['receipts']: checked_ref(record)
    checked_ref(proof_ref)
    return {**identity, 'modelSha256': identity['export']['sha256']}, output


def collect(model, checkpoint, corpus, cases_path, run_directory, deadline, *, clock=time.monotonic, resource_check=None):
    directory = Path(run_directory).resolve(); start = clock()
    deadline = min(deadline, effective_deadline(read(directory / 'runtime.json')))
    hard_deadline = min(start + MAX_SECONDS, deadline - CLEANUP_SECONDS)
    soft_deadline = hard_deadline - CLEANUP_SECONDS
    attempt = directory / 'development' / uuid.uuid4().hex
    attempt.mkdir(parents=True, exist_ok=False)
    plan = {'schema': 1, 'complete': False, 'checkpoint': str(Path(checkpoint).resolve()),
            'cases': str(Path(cases_path).resolve()), 'startedMonotonic': start, 'deadlineMonotonic': hard_deadline}
    immutable(attempt / 'plan.json', plan)
    operation = directory / 'operation-status.json'
    atomic_json(operation, {'schema': 1, 'pid': os.getpid(), 'name': 'development-collection', 'status': 'running',
                           'deadlineMonotonic': hard_deadline, 'observedAt': time.time()})
    resource_check = resource_check or (lambda: resource_ready(directory))
    def check():
        if clock() >= soft_deadline: raise TimeoutError('development deadline')
        available = resource_check()
        if available is False: raise TimeoutError('development resource stop')
        if available is not None and available is not True: raise ValueError('invalid development resource observation')
    proof = {'schema': 1, 'kind': 'stage-development-proof', 'complete': False, 'passed': False,
             'profile': PROFILE, 'referenceDevice': 'mps', 'identity': {}, 'receipts': [],
             'expectedCaseIds': [], 'acceptancePassed': False, 'productionPromotion': False}
    failure = None
    try:
        check(); cases = load_cases(cases_path); rows = corpus_rows(corpus)
        proof['expectedCaseIds'] = [case['id'] for case in cases['cases']]
        identity = identity_for(model, checkpoint, corpus, cases_path, directory, attempt)
        proof['identity'] = identity; validate_identity(identity, cases); check()
        immutable(attempt / 'identity.json', identity)
        for index, case in enumerate(cases['cases']):
            receipt = {'id': case['id'], 'rowSha256': case['rowSha256'], 'status': 'incomplete'}
            frozen = rows[case['corpusIndex']]
            try:
                check(); remaining = soft_deadline - clock()
                if remaining <= 1.1: raise TimeoutError('development search budget insufficient')
                guarded = GuardedModel(model, frozen, check)
                result = search_reference(frozen['state'], guarded, 'mps', 107 + case['corpusIndex'], PROFILE,
                                          bound_seconds=min(10., remaining))
                check()
                if result.get('status') == 'recovery' or result.get('stopped') == 'deadline' or result.get('legality', {}).get('complete') is False:
                    if result.get('stopped') not in ('deadline', 'node-limit'):
                        raise ValueError('unexpected development search recovery')
                    receipt.update(reason='bounded-search-incomplete', searched={'id': case['id'], 'seed': 107 + case['corpusIndex'], 'result': result})
                else:
                    receipt.update(status='complete', raw=guarded.raw, rootEncodingSha256=checksum(frozen['encoded']),
                                   searched={'id': case['id'], 'seed': 107 + case['corpusIndex'], 'result': result})
                    validate_case(case, frozen, receipt)
            except TimeoutError as error: receipt.update(reason=str(error))
            receipt_path = attempt / f'case-{index:02d}.json'; immutable(receipt_path, receipt)
            proof['receipts'].append(reference(receipt_path))
        check()
        current_source = source_identity()
        if current_source != {key: identity[key] for key in current_source} or runtime_identity() != identity['runtime']:
            raise ValueError('development source or runtime changed')
        if model_weights(model) != identity['modelWeightsSha256']: raise ValueError('development model weights changed')
        validate_identity(identity, cases); check()
        proof['complete'] = proof['passed'] = all(read(ref['path'])['status'] == 'complete' for ref in proof['receipts'])
        if not proof['complete']: proof['reason'] = 'one or more frozen cases incomplete'
    except TimeoutError as error: proof['reason'] = str(error)
    except BaseException as error:
        proof.update(failed=True, reason=str(error)); failure = error
    finally:
        proof['elapsedSeconds'] = max(0, clock() - start)
        proof_path = attempt / 'proof.json'; immutable(proof_path, proof)
    try:
        if failure: raise failure
        report_path = attempt / 'report.json'; immutable(report_path, report(cases_path, proof_path))
    finally:
        atomic_json(operation, {'schema': 1, 'pid': os.getpid(), 'status': 'idle', 'deadlineMonotonic': None, 'observedAt': time.time()})
    return {'proof': str(proof_path), 'report': str(report_path), 'complete': proof['complete'], 'reason': proof.get('reason')}
