"""Compact square attention with the unchanged public policy/value outputs."""
import math
import torch
from torch import nn
from .architecture import DEFINITIONS, validate_architecture
from .config import CONFIG


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
        nn.init.normal_(self.position, std=0.02)

    def forward(self, inputs):
        # Plane-major board input becomes row-major square tokens. Channel
        # order stays exactly the existing28actions per square, then Pass.
        tokens = inputs.flatten(2).transpose(1, 2)
        x = self.final_norm(self.blocks(self.input(tokens) + self.position))
        mean = x.mean(dim=1)
        policy = torch.cat((self.policy(x).flatten(1), self.pass_head(mean)), dim=1)
        pooled = torch.cat((mean, x.amax(dim=1)), dim=1)
        value = torch.tanh(self.value(pooled)).clamp(-1., 1.).squeeze(-1)
        return policy, value
