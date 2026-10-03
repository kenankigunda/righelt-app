import torch
from torch import nn
from .config import CONFIG

class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.first = nn.Conv2d(channels, channels, 3, padding=1)
        self.second = nn.Conv2d(channels, channels, 3, padding=1)

    def forward(self, x):
        return torch.relu(x + self.second(torch.relu(self.first(x))))

class PolicyValueNet(nn.Module):
    def __init__(self):
        super().__init__()
        c = CONFIG['model']; n = c['channels']
        self.stem = nn.Conv2d(CONFIG['inputPlanes'], n, 3, padding=1)
        self.blocks = nn.Sequential(*(ResidualBlock(n) for _ in range(c['residualBlocks'])))
        self.policy = nn.Conv2d(n, 28, 1)
        self.pass_head = nn.Linear(n, 1)
        self.value_spatial = nn.Conv2d(n, c['valueChannels'], 1)
        self.value_hidden = nn.Linear(c['valueChannels'] * CONFIG['boardSize'] ** 2, c['valueHidden'])
        self.value_out = nn.Linear(c['valueHidden'], 1)

    def forward(self, x):
        x = self.blocks(torch.relu(self.stem(x)))
        # Square-major action layout: ((row * 10 + col) * 28 + channel).
        spatial = self.policy(x).permute(0, 2, 3, 1).flatten(1)
        policy = torch.cat((spatial, self.pass_head(x.mean(dim=(2, 3)))), dim=1)
        value = self.value_out(torch.relu(self.value_hidden(torch.relu(self.value_spatial(x)).flatten(1))))
        return policy, torch.tanh(value).squeeze(-1)


def training_loss(logits, values, legal, targets, terminal_values, terminal_mask):
    if not torch.isfinite(logits).all() or not torch.isfinite(values).all():
        raise ValueError('nonfinite model output')
    if not legal.any(dim=1).all():
        raise ValueError('empty legal mask')
    if not torch.isfinite(targets).all() or (targets < 0).any() or (targets[~legal] != 0).any():
        raise ValueError('invalid policy target')
    if not torch.allclose(targets.sum(dim=1), torch.ones_like(values), atol=1e-5):
        raise ValueError('policy target must sum to one')
    if not torch.isfinite(terminal_values[terminal_mask]).all() or (terminal_values[terminal_mask].abs() > 1).any():
        raise ValueError('invalid terminal value')
    log_prob = torch.log_softmax(logits.masked_fill(~legal, torch.finfo(logits.dtype).min), dim=1)
    policy = -(targets * log_prob).sum(dim=1).mean()
    # An all-truncated batch has zero value loss, not a draw target.
    value = ((values[terminal_mask] - terminal_values[terminal_mask]) ** 2).mean() if terminal_mask.any() else values.sum() * 0
    return policy + value, policy.detach(), value.detach()
