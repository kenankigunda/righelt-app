"""One bounded, shuffled replay-buffer pass per generation round."""
from contextlib import nullcontext
import math
import random
import time
import torch
from .config import CONFIG
from .model import training_loss


def make_optimizer(model):
    return torch.optim.AdamW(model.parameters(), lr=CONFIG['training']['learningRate'],
                             weight_decay=CONFIG['training']['weightDecay'])


def tensor_batch(positions, device):
    n = len(positions)
    if not n:
        raise ValueError('empty training batch')
    inputs = torch.tensor([p['encoded'] for p in positions], dtype=torch.float32, device=device)
    inputs = inputs.reshape(n, CONFIG['inputPlanes'], CONFIG['boardSize'], CONFIG['boardSize'])
    if not torch.isfinite(inputs).all():
        raise ValueError('nonfinite encoded state')
    legal = torch.zeros((n, CONFIG['actionCount']), dtype=torch.bool, device=device)
    targets = torch.zeros((n, CONFIG['actionCount']), dtype=torch.float32, device=device)
    for row, position in enumerate(positions):
        indices = position['legal']
        if not indices or len(indices) != len(set(indices)) or any(type(i) is not int or not 0 <= i < CONFIG['actionCount'] for i in indices):
            raise ValueError('invalid legal mask')
        legal[row, indices] = True
        seen = set()
        for target in position['policy']:
            i, probability = target['index'], target['probability']
            if i in seen or not isinstance(i, int) or not 0 <= i < CONFIG['actionCount'] or not math.isfinite(probability) or probability < 0:
                raise ValueError('invalid policy target')
            seen.add(i)
            targets[row, i] = probability
    values = torch.tensor([p['terminalValue'] for p in positions], dtype=torch.float32, device=device)
    mask = torch.tensor([p['terminalMask'] for p in positions], dtype=torch.bool, device=device)
    if any(type(p.get('policyMask', True)) is not bool or type(p['terminalMask']) is not bool for p in positions):
        raise ValueError('invalid policy mask')
    policy_mask = torch.tensor([p.get('policyMask', True) for p in positions], dtype=torch.bool, device=device)
    if any(not p.get('policyMask', True) and p['policy'] for p in positions):
        raise ValueError('masked policy must be empty')
    return inputs, legal, targets, values, mask, policy_mask


def train_round(model, optimizer, positions, *, device, seed, deadline, should_pause=lambda: False,
                on_batch=lambda metrics: None, clock=time.monotonic, start_batch=0, operation=lambda name,seconds:nullcontext()):
    order = list(range(len(positions)))
    random.Random(seed).shuffle(order)
    batch_size = CONFIG['training']['batchSize']
    result = {'updates': 0, 'positions': 0, 'nonzeroUpdates': 0, 'skippedUnsupervisedBatches': 0, 'batches': [], 'stopped': 'complete'}
    batch_bound = 30.0
    model.train()
    for start in range(0, min(len(order), batch_size * CONFIG['training']['maxMinibatches']), batch_size):
        if start // batch_size < start_batch:
            continue
        if should_pause():
            result['stopped'] = 'resource-pause'; break
        # Reserve time for an atomic checkpoint; never start an unbounded batch.
        if deadline - clock() < batch_bound + 10:
            result['stopped'] = 'budget'; break
        with operation('training-minibatch',batch_bound):
            before = clock()
            batch = [positions[i] for i in order[start:start + batch_size]]
            inputs, legal, target, value, mask, policy_mask = tensor_batch(batch, device)
            if not (mask.any() or policy_mask.any()):
                result['skippedUnsupervisedBatches'] += 1
                continue
            optimizer.zero_grad(set_to_none=True)
            logits, values = model(inputs)
            loss, policy_loss, value_loss = training_loss(logits, values, legal, target, value, mask, policy_mask)
            if not torch.isfinite(loss):
                raise ValueError('nonfinite loss')
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), CONFIG['training']['gradientClip'], error_if_nonfinite=True)
            previous = [p.detach().clone() for p in model.parameters()]
            optimizer.step()
            delta = sum((p.detach() - old).abs().sum().item() for p, old in zip(model.parameters(), previous))
            if not math.isfinite(delta) or delta <= 0:
                raise ValueError('training update was nonfinite or zero')
            metrics = {'loss': loss.item(), 'policyLoss': policy_loss.item(), 'valueLoss': value_loss.item(),
                       'gradientNorm': norm.item(), 'parameterDelta': delta, 'positions': len(batch),
                       'seconds': clock() - before, 'batchIndex': start // batch_size,
                       'policyPositions': int(policy_mask.sum()), 'valuePositions': int(mask.sum())}
            batch_bound = max(batch_bound, metrics['seconds'] * 2)
        result['updates'] += 1
        result['nonzeroUpdates'] += 1
        result['positions'] += len(batch)
        result['batches'].append(metrics)
        on_batch(metrics)
    model.eval()
    return result
