"""Operational limits, versioned separately from immutable model configuration.

The resources block in experiment-v1.json remains historical provenance so old
checkpoint checksums stay valid. Runtime consumers use these limits instead.
Changing this record requires a reviewed source amendment, never a new budget.
"""
import hashlib
import json
import os
from types import MappingProxyType

POLICY_ID = os.environ.get('RIGHELT_RESOURCE_POLICY', 'adaptive-headroom-v2')
if POLICY_ID not in ('adaptive-headroom-v2', 'production-headroom-v3'):
    raise ValueError('unknown operational resource policy')
_limits = {
    'minWorkers': 2,
    'maxWorkers': 4,
    'minMemoryGiB': 16,
    'maxMemoryGiB': 24,
    'pauseAvailableGiB': 8,
    'resumeAvailableGiB': 12,
    'recoverySeconds': 120,
    'sampleSeconds': 5,
    'startupHeartbeatSeconds': 30,
    'quietSeconds': 120,
    'activityFreshSeconds': 60,
    'rampSeconds': 60,
    'externalCpuBusyPercent': 150,
    'externalCpuQuietPercent': 50,
    'artifactGiB': 100,
    'freeDiskFloorGiB': 20,
}
if POLICY_ID == 'production-headroom-v3':
    _limits.update(maxWorkers=8, maxMemoryGiB=36, pauseAvailableGiB=6,
                   resumeAvailableGiB=10)
LIMITS = MappingProxyType(_limits)
POLICY_SHA256 = hashlib.sha256(json.dumps(
    {'id': POLICY_ID, 'limits': dict(LIMITS)}, sort_keys=True, allow_nan=False,
).encode()).hexdigest()


def manifest_fields():
    return {'resourcePolicy': POLICY_ID, 'resourcePolicySha256': POLICY_SHA256,
            'resourceLimits': dict(LIMITS)}
