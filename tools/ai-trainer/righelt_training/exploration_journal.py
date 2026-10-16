"""Immutable screen attempts and evidence; no replay-buffer or stage mutations."""
import math
from pathlib import Path
import re

from .development_probe import checked_ref, reference
from .exploration_metrics import finite_nonnegative
from .exploration_plan import slot_name
from .sequence import immutable, read
from .training_recipe import recipe_binding


def observations(plan, slot, proof):
    """Derive metrics from the independently replayed decision, never its summary."""
    record = proof.get('record', {}); replay = proof.get('replay', {})
    root = plan['seedPlan']['roots'][slot['rootOrdinal']]
    recipe = plan['seedPlan']['recipes'][slot['arm']]
    model = proof.get('model', {}); audit = model.get('audit', {})
    if (model.get('checkpoint') != plan['seedPlan']['checkpoint']
            or audit.get('checkpoint') != model['checkpoint']['path'] or audit.get('sha256') != model['checkpoint']['sha256']
            or type(audit.get('updates')) is not int or audit['updates'] <= 0
            or not re.fullmatch('[0-9a-f]{64}', model.get('weightsSha256', '')) or not model.get('recoveryReferences')):
        raise ValueError('screen decision lacks audited frozen model identity')
    if (proof.get('kind') != 'exploration-decision-proof' or proof.get('partition') != 'development'
            or proof.get('trainingData') is not False or replay.get('passed') is not True
            or record.get('id') != slot['id'] or record.get('seed') != slot['seed']
            or record.get('beforeHash') != root['stateHash'] or record.get('controller') != root['controller']
            or record.get('trainingRecipe') != recipe or recipe != recipe_binding(recipe['id'])
            or replay.get('beforeHash') != record.get('beforeHash') or not record.get('afterHash')
            or replay.get('afterHash') != record.get('afterHash')):
        raise ValueError('screen replay identity differs from frozen slot')
    legal = record.get('legal'); mask = record.get('policyMask'); fallback = record.get('fallback')
    action = record.get('actionIndex'); policy = record.get('policy'); search = record.get('search', {})
    actions = search.get('actions', []); exploration = record.get('rootExploration', {})
    if (not isinstance(legal, list) or not legal or len(set(legal)) != len(legal)
            or any(type(index) is not int or not 0 <= index < 2801 for index in legal)
            or type(mask) is not bool or bool(fallback) == mask or action not in legal
            or type(action) is not int or record.get('legality', {}).get('indices') != legal
            or exploration.get('recipe') != recipe or type(exploration.get('applied')) is not bool
            or not isinstance(policy, list) or not isinstance(actions, list)):
        raise ValueError('invalid screen decision provenance')
    visits = {}
    for item in actions:
        index, count = item.get('index'), item.get('visits')
        if index in visits or index not in legal or type(count) is not int or count < 0:
            raise ValueError('invalid screen root visits')
        visits[index] = count
    usable = mask and record['legality'].get('complete') is True and not fallback
    if mask:
        indices = [item.get('index') for item in policy]
        total = sum(visits.get(index, 0) for index in indices)
        if (not policy or not usable or len(set(indices)) != len(indices) or total <= 0
                or any(index not in visits for index in indices)
                or any(not finite_nonnegative(item.get('probability')) or
                       abs(item['probability'] - visits[item['index']] / total) > 1e-10 for item in policy)
                or abs(sum(item['probability'] for item in policy) - 1) > 1e-10):
            raise ValueError('invalid screen policy target')
    elif policy:
        raise ValueError('fallback has a policy target')
    return {'policyUsable': usable, 'fallback': bool(fallback), 'actionIndex': action,
            'searchReason': search.get('reason'), 'rootVisits': sorted([index, count] for index, count in visits.items()),
            'explorationApplied': exploration['applied'],
            'visitedLegalCoverage': sum(count > 0 for count in visits.values()) / len(legal),
            'policyEntropy': -sum(item['probability'] * math.log(item['probability']) for item in policy if item['probability'] > 0)}


class Journal:
    def __init__(self, directory, plan):
        self.directory = Path(directory); self.plan = plan
        self.slots = {slot['id']: slot for slot in plan['slots']}
        self.directory.mkdir(parents=True, exist_ok=True)

    def path(self, slot, suffix):
        if self.slots.get(slot['id']) != slot:
            raise ValueError('unscheduled screen attempt')
        return self.directory / 'slots' / (slot_name(slot) + '.' + suffix + '.json')

    def start(self, slot, *, charged, interval, resources):
        if self.path(slot, 'start').exists() or self.path(slot, 'outcome').exists():
            raise ValueError('screen slot was already dispatched; no silent retry')
        if not finite_nonnegative(charged): raise ValueError('invalid slot accounting')
        value = {'schema': 1, 'slot': slot, 'planSha256': self.plan['seedPlanSha256'],
                 'chargedStart': charged, 'interval': interval, 'resources': resources}
        immutable(self.path(slot, 'start'), value)
        return value

    def complete(self, slot, *, charged, status, reason=None, proof=None, pauses=0., timings=None, resource_history=None):
        start_path = self.path(slot, 'start'); start = read(start_path)
        duration = charged - start['chargedStart']
        if not finite_nonnegative(duration) or not finite_nonnegative(pauses) or pauses > duration:
            raise ValueError('invalid arm time attribution')
        if status not in ('verified', 'failed', 'unfinished', 'correctness-error'):
            raise ValueError('invalid attempted disposition')
        proof_ref = None
        if status == 'verified':
            observations(self.plan, slot, proof)
            path = self.path(slot, 'proof'); immutable(path, proof); proof_ref = reference(path)
        elif proof is not None:
            raise ValueError('unsuccessful arm cannot carry verified proof')
        outcome = {'schema': 1, 'slotId': slot['id'], 'start': reference(start_path), 'status': status,
                   'chargedEnd': charged, 'pauseSeconds': pauses, 'reason': reason, 'proof': proof_ref,
                   'timings': timings or {}, 'resources': resource_history or [start['resources']]}
        immutable(self.path(slot, 'outcome'), outcome)
        return outcome

    def interrupted(self, charged):
        """Only after external cleanup and settling abandoned accounting intervals."""
        pending = [slot for slot in self.slots.values() if self.path(slot, 'start').exists()
                   and not self.path(slot, 'outcome').exists()]
        if len(pending) > 1: raise ValueError('more than one active engine slot')
        for slot in pending:
            self.complete(slot, charged=charged, status='unfinished', reason='interrupted-conservatively-charged')

    def quarantine(self, pair, *, cause, amendment):
        if type(pair) is not int or not 0 <= pair < 120 or not cause:
            raise ValueError('invalid quarantine')
        checked_ref(amendment)
        immutable(self.directory / 'quarantine' / f'{pair}.json', {'pair': pair, 'cause': cause, 'amendment': amendment})

    def results(self):
        results = []; refs = []; envelopes = {}; recovery_refs = {}; model_identity = None
        for slot in self.plan['slots']:
            path = self.path(slot, 'outcome')
            if not path.exists():
                if self.path(slot, 'start').exists(): raise ValueError('unsettled screen attempt')
                results.append({'slotId': slot['id'], 'status': 'unstarted', 'activeSeconds': 0., 'pauseSeconds': 0.})
                continue
            value = read(path); refs.append(reference(path)); start = read(checked_ref(value['start']))
            if (Path(value['start']['path']) != self.path(slot, 'start').resolve() or start['slot'] != slot
                    or start['planSha256'] != self.plan['seedPlanSha256'] or value['slotId'] != slot['id']):
                raise ValueError('screen outcome identity changed')
            duration = value['chargedEnd'] - start['chargedStart']; pauses = value['pauseSeconds']
            if not finite_nonnegative(duration) or not finite_nonnegative(pauses) or pauses > duration:
                raise ValueError('invalid persisted screen time')
            row = {'slotId': slot['id'], 'status': value['status'], 'activeSeconds': duration - pauses,
                   'pauseSeconds': pauses, 'comparable': True}
            quarantine = self.directory / 'quarantine' / f'{slot["pair"]}.json'
            quarantined = quarantine.exists()
            if quarantined:
                resolution = read(quarantine); checked_ref(resolution['amendment']); refs.append(reference(quarantine))
                row.update(status='quarantined', policyUsable=False)
            if value['status'] == 'verified' and not quarantined:
                if Path(value['proof']['path']) != self.path(slot, 'proof').resolve(): raise ValueError('proof outside slot')
                proof = read(checked_ref(value['proof']))
                row.update(observations(self.plan, slot, proof))
                if model_identity is not None and proof['model'] != model_identity:
                    raise ValueError('screen arms used different frozen model or recovery lineage')
                model_identity = proof['model']
                for ref in proof['model']['recoveryReferences']:
                    if ref['path'] in recovery_refs and recovery_refs[ref['path']] != ref:
                        raise ValueError('screen recovery reference changed')
                    recovery_refs[ref['path']] = ref
            elif value['status'] != 'verified' and value['proof'] is not None: raise ValueError('failed slot has a proof')
            envelope = [start['resources'], *value['resources']]
            envelopes.setdefault(slot['pair'], []).extend(envelope)
            results.append(row)
        for ref in recovery_refs.values(): checked_ref(ref)
        for row, slot in zip(results, self.plan['slots'], strict=True):
            # Reasons and observation times may differ without changing granted limits.
            limits = {(grant['workers'], grant['memory_gib'], grant['paused'], grant['stop'])
                      for grant in envelopes.get(slot['pair'], [])}
            row['comparable'] = len(limits) == 1
        return results, refs
