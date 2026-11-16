"""Versioned common hosted arithmetic, independent of either learning arm."""
from contextlib import contextmanager, ExitStack
from functools import wraps
import os
import platform
import json
from pathlib import Path
import torch

POLICY = json.loads(Path(__file__).with_name('arithmetic-policy-v1.json').read_text())


def _controls():
    # Use only the post-2.9 API. Matmul precision alone does not control conv.
    return [(torch.backends, 'fp32_precision'),
            (torch.backends.cuda.matmul, 'fp32_precision'),
            (torch.backends.cudnn, 'fp32_precision'),
            (torch.backends.cudnn.conv, 'fp32_precision')]


def arithmetic_record():
    precision=dict(zip(('global', 'cudaMatmul', 'cudnn', 'cudnnConvolution'),
                       [getattr(obj, key) for obj, key in _controls()]))
    autocast={kind: torch.is_autocast_enabled(kind) for kind in ('cpu', 'cuda')}
    return {'policy': dict(POLICY), 'policyApplied':all(v=='ieee' for v in precision.values()) and not any(autocast.values()), 'pythonVersion': platform.python_version(),
            'machine': platform.machine(), 'torchVersion': torch.__version__,
            'cudaVersion': torch.version.cuda, 'cudnnVersion': torch.backends.cudnn.version(),
            'precision':precision, 'autocast':autocast,
            'cudnnEnabled': torch.backends.cudnn.enabled,
            'cudnnBenchmark': torch.backends.cudnn.benchmark,
            'cudnnDeterministic': torch.backends.cudnn.deterministic,
            'deterministicAlgorithms': torch.are_deterministic_algorithms_enabled()}


@contextmanager
def ieee_fp32():
    controls = _controls()
    previous = [getattr(obj, key) for obj, key in controls]
    try:
        for obj, key in controls:
            setattr(obj, key, 'ieee')
        with ExitStack() as stack:
            for kind in ('cpu', 'cuda'):
                stack.enter_context(torch.autocast(kind, enabled=False))
            if any(getattr(obj, key) != 'ieee' for obj, key in controls):
                raise RuntimeError('IEEE FP32 arithmetic read-back failed')
            yield arithmetic_record()
    finally:
        # Restore parent before child overrides, including inherited "none".
        for (obj, key), value in zip(controls, previous):
            setattr(obj, key, value)


def hosted_arithmetic(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if os.environ.get('RIGHELT_HOSTED') != '1':
            return function(*args, **kwargs)
        with ieee_fp32():
            return function(*args, **kwargs)
    return wrapped
