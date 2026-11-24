"""Compact square attention with the unchanged public policy/value outputs."""
import math
import copy
import torch
from torch import nn
from .architecture import DEFINITIONS, validate_architecture
from .config import CONFIG
from .sequence_targets import TARGET_COUNT

PAIRWISE_INFERENCE = 'pairwise-fp32-v1'


def pairwise_mean(values, dim, *, keepdim=False):
    """A fixed adjacent-pair tree, retaining every term and FP32 operation."""
    axis = dim % values.ndim
    last = values.ndim - 1
    count = values.shape[axis]
    reduced = values.movedim(axis, last)
    width = count
    while width > 1:
        pairs = width // 2
        terms = reduced[..., :2 * pairs].reshape(*reduced.shape[:-1], pairs, 2)
        combined = terms[..., 0] + terms[..., 1]
        reduced = torch.cat((combined, reduced[..., -1:]), dim=-1) if width % 2 else combined
        width = pairs + width % 2
    result = (reduced / float(count)).movedim(last, axis)
    return result if keepdim else result.squeeze(axis)


class PairwiseLayerNorm(nn.LayerNorm):
    def forward(self, inputs):
        if len(self.normalized_shape) != 1:
            raise ValueError('pairwise inference requires one normalization axis')
        centered = inputs - pairwise_mean(inputs, -1, keepdim=True)
        variance = pairwise_mean(centered * centered, -1, keepdim=True)
        normalized = centered / torch.sqrt(variance + self.eps)
        if self.weight is not None: normalized = normalized * self.weight
        if self.bias is not None: normalized = normalized + self.bias
        return normalized


class BoardAttentionBlock(nn.Module):
    def __init__(self, width, heads, expansion, board):
        super().__init__()
        self.heads = heads
        self.head_width = width // heads
        self.norm_attention = nn.LayerNorm(width)
        self.qkv = nn.Linear(width, 3 * width)
        self.project = nn.Linear(width, width)
        self.norm_ff = nn.LayerNorm(width)
        self.ff = nn.Sequential(nn.Linear(width, expansion * width), nn.ReLU(),
                                nn.Linear(expansion * width, width))
        self.relative_bias = nn.Parameter(torch.zeros(heads, (2 * board - 1) ** 2))
        locations = torch.arange(board * board)
        rows, cols = locations // board, locations % board
        relative = ((rows[:, None] - rows[None, :] + board - 1) * (2 * board - 1)
                    + cols[:, None] - cols[None, :] + board - 1)
        self.register_buffer('relative_index', relative, persistent=False)

    def forward(self, x):
        batch, squares, width = x.shape
        qkv = self.qkv(self.norm_attention(x)).reshape(batch, squares, 3, self.heads, self.head_width)
        q, k, v = qkv.permute(2, 0, 3, 1, 4).unbind(0)
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.head_width)
        scores = scores + self.relative_bias[:, self.relative_index].unsqueeze(0)
        context = torch.matmul(torch.softmax(scores, dim=-1), v)
        x = x + self.project(context.transpose(1, 2).reshape(batch, squares, width))
        return x + self.ff(self.norm_ff(x))


class BoardAttentionNet(nn.Module):
    def __init__(self, binding):
        super().__init__()
        self.model_architecture = validate_architecture(binding)
        self.inference_implementation = 'native-v1'
        definition = DEFINITIONS[self.model_architecture['id']]
        if definition['kind'] != 'board-attention':
            raise ValueError('Board attention architecture required')
        width, board = definition['width'], CONFIG['boardSize']
        self.input = nn.Linear(CONFIG['inputPlanes'], width)
        self.position = nn.Parameter(torch.zeros(1, board * board, width))
        self.blocks = nn.Sequential(*(BoardAttentionBlock(width, definition['heads'],
            definition['expansion'], board) for _ in range(definition['blocks'])))
        self.final_norm = nn.LayerNorm(width)
        channels = (CONFIG['actionCount'] - 1) // (board * board)
        self.policy = nn.Linear(width, channels)
        self.pass_head = nn.Linear(width, 1)
        self.value = nn.Sequential(nn.Linear(2 * width, 64), nn.ReLU(), nn.Linear(64, 1))
        self.future_facts = nn.Linear(2 * width, TARGET_COUNT)
        nn.init.normal_(self.position, std=0.02)

    def features(self, inputs):
        # Plane-major board input becomes row-major square tokens. Channel
        # order stays exactly the existing28actions per square, then Pass.
        tokens = inputs.flatten(2).transpose(1, 2)
        x = self.final_norm(self.blocks(self.input(tokens) + self.position))
        return x

    def outputs(self,x):
        mean = pairwise_mean(x, 1) if self.inference_implementation == PAIRWISE_INFERENCE else x.mean(dim=1)
        policy = torch.cat((self.policy(x).flatten(1), self.pass_head(mean)), dim=1)
        pooled = torch.cat((mean, x.amax(dim=1)), dim=1)
        value = torch.tanh(self.value(pooled)).clamp(-1., 1.).squeeze(-1)
        return policy, value, pooled

    def forward(self,inputs):
        policy,value,_=self.outputs(self.features(inputs))
        return policy,value

    def for_inference(self, implementation):
        if implementation not in ('native-v1', PAIRWISE_INFERENCE):
            raise ValueError('unsupported attention inference implementation')
        if self.inference_implementation != 'native-v1':
            raise ValueError('inference implementation must start from the native model')
        if any(p.dtype != torch.float32 for p in self.parameters()):
            raise ValueError('FP32 inference parameters required')
        result = copy.deepcopy(self)
        if implementation == PAIRWISE_INFERENCE:
            for name, layer in list(result.named_modules()):
                if isinstance(layer, nn.LayerNorm):
                    replacement = PairwiseLayerNorm(layer.normalized_shape, eps=layer.eps,
                        elementwise_affine=layer.elementwise_affine, bias=layer.bias is not None)
                    replacement.to(device=layer.weight.device, dtype=layer.weight.dtype)
                    replacement.load_state_dict(layer.state_dict())
                    parent, _, key = name.rpartition('.')
                    setattr(result.get_submodule(parent) if parent else result, key, replacement)
        result.inference_implementation = implementation
        return result.eval().requires_grad_(False)

    def forward_with_future(self,inputs):
        policy,value,pooled=self.outputs(self.features(inputs))
        return policy,value,torch.sigmoid(self.future_facts(pooled))
