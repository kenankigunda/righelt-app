"""One bounded, shuffled replay-buffer pass per generation round."""
from contextlib import nullcontext
import math
import random
import time
import torch
from .config import CONFIG
from .model import training_loss
from .sequence_targets import future_batch,FUTURE_LOSS_WEIGHT


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
                on_batch=lambda metrics: None, clock=time.monotonic, start_batch=0, operation=lambda name,seconds:nullcontext(),
                evidence_game_ids=None, certificate_policy_weight=1, planned_batch=None, planned_count=None):
    if certificate_policy_weight not in (1,2):raise ValueError('unsupported certificate policy weight')
    from .execution_recipe import verify_runtime
    execution=verify_runtime(model=model, optimizer=optimizer)
    if execution and execution['settings'].get('policyRefresh'):
        from .hosted_science import apply_policy_refresh
        positions=apply_policy_refresh(positions,execution['settings']['policyRefresh'],annotate=True)
    order = list(range(len(positions)))
    random.Random(seed).shuffle(order)
    batch_size = CONFIG['training']['batchSize']
    if planned_batch is not None and (positions or not callable(planned_batch) or
            type(planned_count) is not int or not 0 < planned_count <= CONFIG['training']['maxMinibatches']):
        raise ValueError('explicit bounded batch schedule required')
    if planned_batch is None and planned_count is not None:
        raise ValueError('missing batch schedule')
    result = {'updates': 0, 'positions': 0, 'nonzeroUpdates': 0, 'skippedUnsupervisedBatches': 0, 'batches': [], 'stopped': 'complete'}
    batch_bound = 30.0
    model.train()
    count = planned_count * batch_size if planned_batch is not None else min(len(order), batch_size * CONFIG['training']['maxMinibatches'])
    for start in range(0, count, batch_size):
        if start // batch_size < start_batch:
            continue
        if should_pause():
            result['stopped'] = 'resource-pause'; break
        # Reserve time for an atomic checkpoint; never start an unbounded batch.
        if deadline - clock() < batch_bound + 10:
            result['stopped'] = 'budget'; break
        with operation('training-minibatch',batch_bound):
            before = clock()
            batch = (planned_batch(start // batch_size) if planned_batch is not None
                     else [positions[i] for i in order[start:start + batch_size]])
            if planned_batch is not None and len(batch) != batch_size:
                raise ValueError('incomplete planned training batch')
            inputs, legal, target, value, mask, policy_mask = tensor_batch(batch, device)
            future_values,future_masks=future_batch(batch)
            has_future=hasattr(model,'forward_with_future') and any(any(row) for row in future_masks)
            preferences = [p for p in batch if 'preference' in p]
            if preferences and planned_batch is None:
                raise ValueError('tactical preferences require an explicit schedule')
            if not (mask.any() or policy_mask.any() or has_future or preferences):
                if planned_batch is not None:raise ValueError('unlabelled planned batch cannot advance a matched schedule')
                result['skippedUnsupervisedBatches'] += 1
                continue
            optimizer.zero_grad(set_to_none=True)
            future_loss=None
            if hasattr(model,'forward_with_future'):
                logits,values,future=model.forward_with_future(inputs)
                if not torch.isfinite(future).all():raise ValueError('Nonfinite future predictions')
                if has_future:
                    future_target=torch.tensor(future_values,dtype=torch.float32,device=device)
                    future_mask=torch.tensor(future_masks,dtype=torch.bool,device=device)
                    future_loss=((future[future_mask]-future_target[future_mask])**2).mean()
            else:logits, values = model(inputs)
            loss, policy_loss, value_loss = training_loss(logits, values, legal, target, value, mask, policy_mask,
                                                         preference_rows=batch if preferences else None)
            if certificate_policy_weight==2:
                selected=torch.tensor([bool(p.get('certificateEvidence')) for p in batch],device=device)&policy_mask
                if selected.any():
                    log_prob=torch.log_softmax(logits.masked_fill(~legal,torch.finfo(logits.dtype).min),dim=1)
                    # Double only the admitted demonstration rows, retaining the native denominator.
                    loss=loss-(target[selected]*log_prob[selected]).sum()/policy_mask.sum()
            if future_loss is not None:loss=loss+FUTURE_LOSS_WEIGHT*future_loss
            if not torch.isfinite(loss):
                raise ValueError('nonfinite loss')
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), CONFIG['training']['gradientClip'], error_if_nonfinite=True)
            head_gradients = {head: sum(float(p.grad.detach().abs().sum()) for name,p in model.named_parameters()
                if p.grad is not None and name.startswith(prefixes))
                for head,prefixes in {'policy': ('policy.', 'pass_head.'),
                                      'terminalValue': ('value_spatial.', 'value_hidden.', 'value_out.', 'value.'),
                                      'futureFacts': ('future_facts.',)}.items()}
            previous = [p.detach().clone() for p in model.parameters()]
            optimizer.step()
            delta = sum((p.detach() - old).abs().sum().item() for p, old in zip(model.parameters(), previous))
            if not math.isfinite(delta) or delta <= 0:
                raise ValueError('training update was nonfinite or zero')
            metrics = {'headGradientL1': head_gradients, 'loss': loss.item(), 'policyLoss': policy_loss.item(), 'valueLoss': value_loss.item(),
                       'gradientNorm': norm.item(), 'parameterDelta': delta, 'positions': len(batch),
                       'seconds': clock() - before, 'batchIndex': start // batch_size,
                       'policyPositions': int(policy_mask.sum()), 'valuePositions': int(mask.sum())}
            if certificate_policy_weight!=1:metrics['certificatePolicyWeight']=certificate_policy_weight
            if planned_batch is not None:
                from .tactical_practice import sample_identity
                ordinary = [position for position in batch if 'preference' not in position]
                metrics.update(sampleSha256=sample_identity(batch), ordinarySampleSha256=sample_identity(ordinary),
                               ordinarySamples=len(ordinary), certifiedSamples=[p['id'] for p in preferences])
            if execution and execution['settings'].get('policyRefresh'):
                metrics['policyRefreshBindingSha256']=execution['settings']['policyRefresh']['sha256']
                metrics['policyRefreshSampledIds']=[p['_policyRefreshId'] for p in batch if p.get('_policyRefreshId') and p.get('policyMask',True)]
            if future_loss is not None:
                metrics.update(futureFactLoss=future_loss.item(),futureFactLabels=sum(sum(row) for row in future_masks))
            # Aggregate the actual sampled rows, without changing order, masks,
            # loss or RNG. Legacy fixtures without game identities stay unknown.
            if all(p.get('gameId') for p in batch):
                sampled = {}
                for p in batch:
                    row = sampled.setdefault(p['gameId'], {'gameId': p['gameId'], 'positions': 0,
                                                          'policyPositions': 0, 'valuePositions': 0})
                    row['positions'] += 1
                    row['policyPositions'] += int(p.get('policyMask', True))
                    row['valuePositions'] += int(p['terminalMask'])
                metrics['sampledGames'] = [sampled[k] for k in sorted(sampled)]
            if evidence_game_ids is not None:
                # These are the actual shuffled batch members and masks used by
                # training_loss, not counts inferred from the replay buffer.
                metrics['policyExamples'] = [
                    {'gameId': p['gameId'], 'positionId': p['id']} for p in batch
                    if p.get('gameId') in evidence_game_ids and p.get('policyMask', True)]
                metrics['valueExamples'] = [
                    {'gameId': p['gameId'], 'positionId': p['id']} for p in batch
                    if p.get('gameId') in evidence_game_ids and p['terminalMask']]
            batch_bound = max(batch_bound, metrics['seconds'] * 2)
        result['updates'] += 1
        result['nonzeroUpdates'] += 1
        result['positions'] += len(batch)
        result['batches'].append(metrics)
        on_batch(metrics)
    model.eval()
    return result
