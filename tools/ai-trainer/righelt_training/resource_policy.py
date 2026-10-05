"""Operational limits, versioned separately from immutable model configuration.

The resources block in experiment-v1.json remains historical provenance so old
checkpoint checksums stay valid. Runtime consumers use these limits instead.
Changing this record requires a reviewed source amendment, never a new budget.
"""
import hashlib
import json
from types import MappingProxyType

POLICY_ID = 'adaptive-headroom-v2'
LIMITS = MappingProxyType({
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
})
POLICY_SHA256 = hashlib.sha256(json.dumps(
    {'id': POLICY_ID, 'limits': dict(LIMITS)}, sort_keys=True, allow_nan=False,
).encode()).hexdigest()


def manifest_fields():
    return {'resourcePolicy': POLICY_ID, 'resourcePolicySha256': POLICY_SHA256,
            'resourceLimits': dict(LIMITS)}
