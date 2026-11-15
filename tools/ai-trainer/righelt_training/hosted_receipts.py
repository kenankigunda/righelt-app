"""Opt-in remote consumption barrier. Network uncertainty never grants a retry."""
import hashlib
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
import time


class HostedInfrastructureError(RuntimeError):
    pass


def verify_recipe(recipe):
    if not enabled(): return
    from .training_recipe import validate_recipe
    raw = Path(os.environ['RIGHELT_EXPECTED_RECIPE_PATH']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != os.environ['RIGHELT_EXPECTED_RECIPE_SHA256'] or validate_recipe(json.loads(raw)) != recipe:
        raise ValueError('hosted pilot training recipe differs from approved artifact')
    from .execution_recipe import verify_runtime
    verify_runtime(recipe)


def enabled():
    return os.environ.get('RIGHELT_HOSTED') == '1'


def request(action, payload=None, *, raw=None, method=None):
    base = os.environ['COMPUTE_URL'].rstrip('/')
    if not base.startswith('https://'):
        raise ValueError('hosted controller requires HTTPS')
    req = urllib.request.Request(
        base + '/v1/' + os.environ['COMPUTE_ID'] + '/' + action,
        data=raw if raw is not None else json.dumps(payload, allow_nan=False).encode() if payload is not None else None,
        method=method or ('GET' if payload is None and raw is None else 'POST'),
        headers={'Authorization': 'Bearer ' + os.environ['COMPUTE_WORKER_TOKEN'],
                 'X-Compute-Generation': os.environ['COMPUTE_GENERATION'],
                 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read() if method == 'GET' else json.load(response)
    except Exception as error:
        if isinstance(error, urllib.error.HTTPError) and error.code != 429 and error.code < 500:
            raise ValueError('hosted controller contract rejected') from None
        # Do not leak headers or response bodies containing credentials.
        marker = os.environ.get('RIGHELT_HOSTED_FAILURE_FILE')
        if marker:
            from .checkpoint import atomic_json
            atomic_json(marker, {'kind': 'infrastructure', 'observedAt': time.time()})
        raise HostedInfrastructureError('hosted durable work barrier unavailable') from None


def claim(namespace, identity):
    if not enabled():
        return True
    key = hashlib.sha256((namespace + ':' + identity).encode()).hexdigest()
    return request('claim', {'key': key})['created'] is True


def evaluation_claim(namespace, identity, *, create=True):
    if not enabled(): return {'created': True} if create else {'created':False,'unclaimed':True}
    key = hashlib.sha256((namespace + ':' + identity).encode()).hexdigest()
    record = request('claim', {'key': key,'allowCreate':create})
    result = record.get('record', {}).get('result')
    if result:
        raw = request('objects/' + result['sha256'], method='GET')
        if len(raw) != result['bytes'] or hashlib.sha256(raw).hexdigest() != result['sha256']:
            raise ValueError('remote evaluation evidence changed')
        record['result'] = json.loads(raw)
    return record


def settle(namespace, identity, result):
    if not enabled(): return
    raw = json.dumps(result, sort_keys=True, allow_nan=False).encode()
    digest = hashlib.sha256(raw).hexdigest()
    uploaded = request('objects/' + digest, raw=raw, method='PUT')
    if uploaded.get('sha256') != digest or uploaded.get('bytes') != len(raw):
        raise ValueError('remote evaluation evidence upload mismatch')
    key = hashlib.sha256((namespace + ':' + identity).encode()).hexdigest()
    request('settle', {'key': key, 'result': uploaded})


def counter(namespace, minimum):
    if not enabled():
        return minimum
    key = hashlib.sha256(namespace.encode()).hexdigest()
    return request('counter', {'key': key, 'minimum': minimum})['value']
