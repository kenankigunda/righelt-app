"""Opt-in consumption barrier. Ambiguous claims never grant game replay."""
import hashlib
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
import time
import re


class HostedInfrastructureError(RuntimeError):
    pass


def _unavailable(message):
    marker=os.environ.get('RIGHELT_HOSTED_FAILURE_FILE')
    if marker:
        from .checkpoint import atomic_json
        atomic_json(marker,{'kind':'infrastructure','observedAt':time.time()})
    raise HostedInfrastructureError(message)


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


def request(action, payload=None, *, raw=None, method=None, record_failure=True):
    base = os.environ['COMPUTE_URL'].rstrip('/')
    if not base.startswith('https://'):
        raise ValueError('hosted controller requires HTTPS')
    session=os.environ.get('COMPUTE_STARTUP_SESSION')
    if session is not None and not re.fullmatch('[a-f0-9]{32}',session):raise ValueError('invalid private worker session')
    req = urllib.request.Request(
        base + '/v1/' + os.environ['COMPUTE_ID'] + '/' + action,
        data=raw if raw is not None else json.dumps(payload, allow_nan=False).encode() if payload is not None else None,
        method=method or ('GET' if payload is None and raw is None else 'POST'),
        headers={'Authorization': 'Bearer ' + os.environ['COMPUTE_WORKER_TOKEN'],
                 'X-Compute-Generation': os.environ['COMPUTE_GENERATION'],
                 'Content-Type': 'application/json',**({'X-Compute-Startup-Session':session} if session is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read() if method == 'GET' else json.load(response)
    except Exception as error:
        if isinstance(error,(ValueError,TypeError)):raise ValueError('hosted controller response malformed') from None
        if isinstance(error, urllib.error.HTTPError) and error.code != 429 and error.code < 500:
            raise ValueError('hosted controller contract rejected') from None
        # Do not leak headers or response bodies containing credentials.
        marker = os.environ.get('RIGHELT_HOSTED_FAILURE_FILE') if record_failure else None
        if marker:
            from .checkpoint import atomic_json
            atomic_json(marker, {'kind': 'infrastructure', 'observedAt': time.time()})
        raise HostedInfrastructureError('hosted durable work barrier unavailable') from None


def claim(namespace, identity):
    if not enabled():
        return True
    key = hashlib.sha256((namespace + ':' + identity).encode()).hexdigest()
    return request('claim', {'key': key})['created'] is True


def _safe_read(action):
    try:return request(action,method='GET',record_failure=False)
    except HostedInfrastructureError:return request(action,method='GET')


def _upload(raw):
    digest=hashlib.sha256(raw).hexdigest()
    try:uploaded=request('objects/'+digest,raw=raw,method='PUT',record_failure=False)
    except HostedInfrastructureError:uploaded=request('objects/'+digest,raw=raw,method='PUT')
    if uploaded.get('sha256')!=digest or uploaded.get('bytes')!=len(raw):raise ValueError('remote evaluation evidence upload mismatch')
    return uploaded


def evaluation_pending(namespace,identities):
    """Inspect claim metadata only. No new consumption or game-object reads."""
    if not identities:return False
    if not enabled():return True
    for identity in identities:
        key=hashlib.sha256((namespace+':'+identity).encode()).hexdigest()
        try:record=request('claim',{'key':key,'allowCreate':False},record_failure=False)
        except HostedInfrastructureError:record=request('claim',{'key':key,'allowCreate':False})
        if record.get('created') is not False:raise ValueError('read-only claim metadata differs')
        if record.get('unclaimed'):return True
        if not isinstance(record.get('record'),dict):raise ValueError('read-only claim metadata missing')
    return False


def evaluation_claim(namespace, identity, *, create=True):
    if not enabled(): return {'created':True} if create else {'created':False,'unclaimed':True}
    key=hashlib.sha256((namespace+':'+identity).encode()).hexdigest()
    try:record=request('claim',{'key':key,'allowCreate':create},record_failure=False)
    except HostedInfrastructureError:
        # Reconcile the SAME key, without another create. Even an existing
        # unsettled claim is consumed, so the player must never run for it.
        record=request('claim',{'key':key,'allowCreate':False})
        if create and record.get('unclaimed'):_unavailable('claim acceptance remains uncertain')
        record['created']=False
    result=record.get('record',{}).get('result')
    if result:
        raw=_safe_read('objects/'+result['sha256'])
        if len(raw)!=result['bytes'] or hashlib.sha256(raw).hexdigest()!=result['sha256']:raise ValueError('remote evaluation evidence changed')
        record['result']=json.loads(raw)
    return record


def settle(namespace, identity, result):
    if not enabled():return
    raw=json.dumps(result,sort_keys=True,allow_nan=False).encode();uploaded=_upload(raw)
    key=hashlib.sha256((namespace+':'+identity).encode()).hexdigest()
    try:request('settle',{'key':key,'result':uploaded},record_failure=False)
    except HostedInfrastructureError:
        observed=request('claim',{'key':key,'allowCreate':False})
        existing=observed.get('record',{}).get('result')
        if existing is not None:
            if existing.get('sha256')!=uploaded['sha256'] or existing.get('bytes')!=uploaded['bytes']:raise ValueError('settlement reconciliation differs')
            return
        if observed.get('unclaimed'):_unavailable('settlement ownership remains uncertain')
        # Identical bytes, same key and same generation: one idempotent write.
        request('settle',{'key':key,'result':uploaded})


def publish_progress(raw):
    if not enabled():return
    uploaded=_upload(raw)
    try:request('progress',{'log':uploaded},record_failure=False)
    except HostedInfrastructureError:request('progress',{'log':uploaded})


def counter(namespace, minimum):
    if not enabled():
        return minimum
    key = hashlib.sha256(namespace.encode()).hexdigest()
    return request('counter', {'key': key, 'minimum': minimum})['value']
