"""Architecture identity is separate from the historical46-plane/action ABI."""
import hashlib
import json
from .sequence_targets import HORIZONS,FACTS,FUTURE_LOSS_WEIGHT,TERMINAL_CONVENTION

BASELINE = 'residual-32x4-v1'
DEFINITIONS = {
    BASELINE: {'kind': 'residual', 'channels': 32, 'blocks': 4,
               'encoding': 'absolute-v1', 'inputPlanes': 46, 'actionCount': 2801},
    'board-attention-48x2-v1': {'kind': 'board-attention', 'width': 48, 'blocks': 2,
        'heads': 4, 'expansion': 2, 'relativeGeometry': True, 'encoding': 'absolute-v1',
        'inputPlanes': 46, 'actionCount': 2801, 'futureFacts': {'horizons':list(HORIZONS),
        'facts':list(FACTS),'lossWeight':FUTURE_LOSS_WEIGHT,'terminalConvention':TERMINAL_CONVENTION}},
    'board-attention-64x2-v1': {'kind': 'board-attention', 'width': 64, 'blocks': 2,
        'heads': 4, 'expansion': 2, 'relativeGeometry': True, 'encoding': 'absolute-v1',
        'inputPlanes': 46, 'actionCount': 2801, 'futureFacts': {'horizons':list(HORIZONS),
        'facts':list(FACTS),'lossWeight':FUTURE_LOSS_WEIGHT,'terminalConvention':TERMINAL_CONVENTION}},
}


def architecture_binding(identifier=BASELINE):
    if identifier not in DEFINITIONS:
        raise ValueError('Unknown model architecture')
    raw = json.dumps(DEFINITIONS[identifier], sort_keys=True, separators=(',', ':')).encode()
    return {'id': identifier, 'sha256': hashlib.sha256(raw).hexdigest()}


def validate_architecture(binding):
    if not isinstance(binding, dict) or set(binding) != {'id', 'sha256'}:
        raise ValueError('Explicit architecture binding required')
    expected = architecture_binding(binding['id'])
    if binding != expected:
        raise ValueError('Architecture checksum mismatch')
    return expected


def record_architecture(record):
    # True absence alone means the historical baseline, never explicit null.
    return validate_architecture(record['modelArchitecture']) if 'modelArchitecture' in record else architecture_binding()


def model_architecture(model):
    return validate_architecture(model.model_architecture) if hasattr(model, 'model_architecture') else architecture_binding()
