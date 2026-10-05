"""The screen's accounting boundary and one immutable report/recipe publication."""
import time
from pathlib import Path
import psutil

from .allocation import BudgetExhausted
from .development_probe import checked_ref, reference
from .exploration_journal import Journal
from .exploration_metrics import summarize
from .exploration_plan import KIND, LIMITS, validate
from .sequence import immutable, read
from .training_recipe import recipe_binding

PHASE = 'exploration-screen'


def elapsed(row):
    duration = max(0., time.time() - row['wall'])
    if row['boot'] == psutil.boot_time(): duration = max(duration, time.monotonic() - row['monotonic'])
    return duration


def accounting(allocation):
    creation, closed, pending = allocation.accounting()
    events = allocation.events()
    starts = {row['id']: row for row in events if row['event'] == 'started'}
    finished = [row for row in events if row['event'] == 'finished' and starts[row['id']]['phase'] == PHASE]
    for row in finished:
        floor = allocation.charge_floor(row['id'])
        if row.get('chargeFloor') != floor or (floor and row['chargedSeconds'] < floor['minimumSeconds']):
            raise ValueError('screen publication floor changed or was not charged')
    screen = sum(row['chargedSeconds'] for row in finished)
    live = sum(elapsed(row) for row in pending)
    screen += sum(elapsed(row) for row in pending if row['phase'] == PHASE)
    return {'creation': creation, 'global': closed + live, 'screen': screen, 'pending': pending, 'finished': finished}


def validate_identity(allocation, plan, directory):
    """Read-only binding shared by normal, recovery and receipt-validation paths.

    Recovery can run without constructing ScreenBudget. It must still belong to
    the same six-hour allocation and frozen checkpoint, in its canonical folder.
    This deliberately grants no permission to begin or reuse an active interval.
    """
    canonical = allocation.directory / 'exploration-screen'
    if Path(directory).resolve() != canonical:
        raise ValueError('screen evidence must use the allocation\'s canonical screen directory')
    state = accounting(allocation); creation = state['creation']; contract = creation.get('continuation', {})
    if (creation['id'] != plan['seedPlan']['allocationId'] or creation['seconds'] != 21600
            or contract.get('phase') != 'six-hour' or contract.get('reserveSeconds') != 3600
            or contract.get('recoveryCheckpoint') != plan['seedPlan']['checkpoint']['path']
            or contract.get('recoverySha256') != plan['seedPlan']['checkpoint']['sha256']):
        raise ValueError('screen must belong to the approved six-hour continuation and frozen checkpoint')
    return state


class ScreenBudget:
    def __init__(self, allocation, plan):
        self.allocation = allocation; self.plan = plan
        state = validate_identity(allocation, plan, allocation.directory / 'exploration-screen')
        if state['pending']: raise ValueError('screen cannot nest inside another accounting owner')
        self.interval = None

    def begin(self):
        if self.remaining() <= LIMITS['publicationSeconds']: raise BudgetExhausted('screen has no publication allowance')
        self.interval, _, _ = self.allocation.begin(PHASE)
        return self.interval

    def state(self): return accounting(self.allocation)

    def remaining(self):
        state = self.state()
        return max(0., min(LIMITS['screenSeconds'] - state['screen'],
                          state['creation']['seconds'] - state['global'] - LIMITS['validationReserveSeconds']))

    def admit_pair(self): return self.remaining() >= LIMITS['pairAdmissionSeconds']

    def bound(self, seconds):
        return max(0., min(seconds, self.remaining() - LIMITS['publicationSeconds'] - LIMITS['cleanupSeconds']))

    def finish(self, reason):
        if self.interval:
            self.allocation.finish(self.interval['id'], reason=reason)


def report_from_journal(plan, journal, charged):
    results, refs = journal.results()
    arm_seconds = sum(row['activeSeconds'] + row['pauseSeconds'] for row in results)
    common = charged - arm_seconds
    if common < -1e-6: raise ValueError('screen arm cost exceeds durable charged allowance')
    return summarize(plan, results, common_seconds=max(0., common), total_charged_seconds=charged), refs


def publish(plan_path, launch_path, journal, budget):
    """The final ten seconds are explicitly charged even if publication is faster.

    That conservative floor makes report and choice atomic without leaving a
    final file write outside accounting. Later admission requires settlement.
    """
    if read(plan_path) != journal.plan or journal.plan != budget.plan:
        raise ValueError('publication plan differs from frozen journal and budget')
    validate_identity(budget.allocation, journal.plan, journal.directory)
    intent_path = journal.directory / 'publication-intent.json'
    receipt_path = journal.directory / 'receipt.json'
    if receipt_path.exists(): raise ValueError('screen already published; validate and reuse it')
    if intent_path.exists():
        intent = read(intent_path)
        if intent['interval'] != budget.interval['id']: raise ValueError('publication intent belongs to prior interval')
    else:
        state = budget.state()
        if budget.remaining() < LIMITS['publicationSeconds']: raise BudgetExhausted('screen publication reserve exhausted')
        current = elapsed(budget.interval)
        floor = current + LIMITS['publicationSeconds']
        charged = sum(row['chargedSeconds'] for row in state['finished']) + floor
        report, refs = report_from_journal(journal.plan, journal, charged)
        intent = {'schema': 1, 'kind': KIND + '-publication', 'interval': budget.interval['id'],
                  'minimumSeconds': floor, 'plan': reference(plan_path), 'launch': reference(launch_path),
                  'outcomes': refs, 'report': report, 'publicationAllowanceSeconds': LIMITS['publicationSeconds'],
                  'accountingBefore': [row for row in state['finished']],
                  'allocationChargedAtPublication': budget.allocation.accounting()[1] + floor}
        immutable(intent_path, intent)
    floor = budget.allocation.set_charge_floor(intent['interval'], intent['minimumSeconds'], reason=KIND + '-publication')
    receipt = {**intent, 'kind': KIND + '-receipt', 'intent': reference(intent_path), 'chargeFloor': floor,
               'selectedRecipe': intent['report']['selectedRecipe']}
    immutable(receipt_path, receipt)
    budget.finish('screen-published')
    return validate_receipt(receipt_path, budget.allocation, verify_plan=False)


def recover_publication(directory, allocation):
    """An interrupted publication is settled, never a second screen."""
    directory = Path(directory); intent_path = directory / 'publication-intent.json'
    if not intent_path.exists(): return None
    intent = read(intent_path)
    validate_identity(allocation, read(checked_ref(intent['plan'])), directory)
    # A floor can be absent only if interruption happened before compute stopped
    # and before publication. Recovery must preserve the reserved charge then.
    _, _, pending = allocation.accounting()
    if any(row['id'] == intent['interval'] for row in pending):
        allocation.set_charge_floor(intent['interval'], intent['minimumSeconds'], reason=KIND + '-publication')
    return intent


def validate_receipt(path, allocation, *, verify_plan=True):
    path = Path(path); receipt = read(path)
    validate_identity(allocation, read(checked_ref(receipt['plan'])), path.parent)
    if receipt.get('kind') == KIND + '-resolution':
        return validate_resolution(path, allocation, verify_plan=verify_plan)
    if receipt.get('kind') == KIND + '-terminal':
        return validate_terminal(path, allocation, verify_plan=verify_plan)
    if receipt.get('kind') == KIND + '-repair':
        return validate_repair(path, allocation, verify_plan=verify_plan)
    intent = read(checked_ref(receipt['intent']))
    if receipt != {**intent, 'kind': KIND + '-receipt', 'intent': receipt['intent'],
                   'chargeFloor': allocation.charge_floor(intent['interval']),
                   'selectedRecipe': intent['report']['selectedRecipe']}:
        raise ValueError('atomic screen choice differs from publication intent')
    plan = read(checked_ref(receipt['plan'])); checked_ref(receipt['launch'])
    if verify_plan: validate(plan)
    journal = Journal(path.parent, plan); state = accounting(allocation)
    if state['pending']: raise ValueError('screen receipt is not settled')
    last = [row for row in state['finished'] if row['id'] == receipt['interval']]
    if len(last) != 1 or state['finished'] != [*receipt['accountingBefore'], last[0]]:
        raise ValueError('screen accounting changed after publication')
    if abs(state['screen'] - receipt['report']['chargedSeconds']) > 1e-6:
        raise ValueError('screen publication exceeded reserved charge; repair required')
    prefix = []
    for event in allocation.events():
        if event['event'] == 'finished': prefix.append(event)
        if event['event'] == 'finished' and event['id'] == receipt['interval']: break
    if abs(sum(row['chargedSeconds'] for row in prefix) - receipt['allocationChargedAtPublication']) > 1e-6:
        raise ValueError('screen allocation settlement differs from receipt')
    if (state['screen'] > LIMITS['screenSeconds'] or receipt['allocationChargedAtPublication'] >
            state['creation']['seconds'] - LIMITS['validationReserveSeconds']):
        raise ValueError('screen publication exceeded aggregate allowance or validation reserve')
    report, refs = report_from_journal(plan, journal, state['screen'])
    if refs != receipt['outcomes'] or report != receipt['report'] or receipt['selectedRecipe'] != report['selectedRecipe']:
        raise ValueError('screen receipt does not match independently replayed evidence')
    return receipt


def resolve_publication(directory, allocation, *, verify_plan=True):
    """Stopped repair bookkeeping for an interrupted/overrun publication.

    No compute is dispatched and no allocation is extended. This conservative
    baseline resolution retains the superseded atomic intent/receipt. A spent
    allocation remains spent; the caller's ordinary budget gate still applies.
    """
    directory = Path(directory); intent_path = directory / 'publication-intent.json'
    intent = read(intent_path)
    state = validate_identity(allocation, read(checked_ref(intent['plan'])), directory)
    if state['pending']: raise ValueError('resolve publication only after verified cleanup and settlement')
    if state['screen'] == intent['report']['chargedSeconds']:
        raise ValueError('settled publication does not need baseline resolution')
    # Corrupted proofs are correctness failures, not a cheap baseline decision.
    checked_ref(intent['plan']); checked_ref(intent['launch'])
    for ref in intent['outcomes']: checked_ref(ref)
    plan = read(intent['plan']['path'])
    if verify_plan: validate(plan)
    report, refs = report_from_journal(plan, Journal(directory, plan), state['screen'])
    if refs != intent['outcomes']: raise ValueError('screen outcomes changed after publication')
    reason = 'interrupted publication exceeded its reserved charge; baseline retained without repeated attempts'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    value = {'schema': 1, 'kind': KIND + '-resolution', 'intent': reference(intent_path),
             'originalReceipt': reference(directory / 'receipt.json') if (directory / 'receipt.json').exists() else None,
             'plan': intent['plan'], 'launch': intent['launch'], 'outcomes': refs, 'report': report,
             'selectedRecipe': recipe_binding(), 'accounting': state['finished'], 'reason': reason,
             'bookkeeping': 'autonomous repair after verified cleanup; no further model/rule work or allocation reset'}
    target = directory / 'receipt-resolution.json'; immutable(target, value)
    return validate_resolution(target, allocation, verify_plan=verify_plan)


def validate_resolution(path, allocation, *, verify_plan=True):
    value = read(path); intent = read(checked_ref(value['intent']))
    state = validate_identity(allocation, read(checked_ref(value['plan'])), Path(path).parent)
    if value.get('originalReceipt'): checked_ref(value['originalReceipt'])
    if (state['pending'] or state['finished'] != value['accounting']
            or state['screen'] == intent['report']['chargedSeconds']
            or value['plan'] != intent['plan'] or value['launch'] != intent['launch']
            or value['selectedRecipe'] != recipe_binding()):
        raise ValueError('invalid settled baseline publication resolution')
    plan = read(checked_ref(value['plan'])); checked_ref(value['launch'])
    if verify_plan: validate(plan)
    report, refs = report_from_journal(plan, Journal(Path(path).parent, plan), state['screen'])
    reason = 'interrupted publication exceeded its reserved charge; baseline retained without repeated attempts'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    if report != value['report'] or refs != value['outcomes'] or refs != intent['outcomes'] or value['reason'] != reason:
        raise ValueError('baseline resolution differs from settled replay evidence')
    return value


def terminal_baseline(directory, plan_path, allocation, *, verify_plan=True):
    """Stop-only recovery when an overrun consumed publication's reserved time."""
    directory = Path(directory); plan = read(plan_path)
    state = validate_identity(allocation, plan, directory)
    if state['pending']: raise ValueError('terminal receipt requires settled accounting')
    remaining = min(LIMITS['screenSeconds'] - state['screen'],
                    state['creation']['seconds'] - state['global'] - LIMITS['validationReserveSeconds'])
    if remaining >= LIMITS['publicationSeconds']:
        raise ValueError('publication allowance remains; use the normal charged publication')
    if verify_plan: validate(plan)
    journal = Journal(directory, plan); report, refs = report_from_journal(plan, journal, state['screen'])
    reason = 'publication reserve exhausted after verified cleanup; baseline retained without a second screen'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    value = {'schema': 1, 'kind': KIND + '-terminal', 'plan': reference(plan_path), 'outcomes': refs,
             'accounting': state['finished'], 'allocationChargedSeconds': state['global'], 'report': report,
             'reason': reason, 'selectedRecipe': recipe_binding(),
             'bookkeeping': 'autonomous repair after verified cleanup; no further model/rule work or allocation reset'}
    path = directory / 'receipt-terminal.json'; immutable(path, value)
    return validate_terminal(path, allocation, verify_plan=verify_plan)


def validate_terminal(path, allocation, *, verify_plan=True):
    value = read(path); plan = read(checked_ref(value['plan']))
    state = validate_identity(allocation, plan, Path(path).parent)
    if verify_plan: validate(plan)
    if (state['pending'] or state['finished'] != value['accounting'] or value['selectedRecipe'] != recipe_binding()
            or min(LIMITS['screenSeconds'] - state['screen'], state['creation']['seconds'] -
                   value['allocationChargedSeconds'] - LIMITS['validationReserveSeconds']) >= LIMITS['publicationSeconds']):
        raise ValueError('invalid terminal baseline accounting')
    # Later training accounting may exist, but cannot erase the charged prefix.
    prefix = 0.; last_id = value['accounting'][-1]['id'] if value['accounting'] else None
    for event in allocation.events():
        if event['event'] == 'finished': prefix += event['chargedSeconds']
        if event['event'] == 'finished' and event['id'] == last_id: break
    if prefix != value['allocationChargedSeconds']: raise ValueError('terminal allocation prefix changed')
    report, refs = report_from_journal(plan, Journal(Path(path).parent, plan), state['screen'])
    reason = 'publication reserve exhausted after verified cleanup; baseline retained without a second screen'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    if report != value['report'] or refs != value['outcomes'] or value['reason'] != reason:
        raise ValueError('terminal baseline differs from settled replay evidence')
    return value


def checked_amendment(reference_value, plan, current_source=None):
    amendment = read(checked_ref(reference_value))
    if (amendment.get('oldSourceRevision') != plan['seedPlan']['source']['sourceRevision']
            or not amendment.get('newSourceRevision') or not amendment.get('cause')
            or amendment.get('artifactDisposition') != 'quarantine-screen-pairs'
            or (current_source is not None and amendment['newSourceRevision'] != current_source['sourceRevision'])):
        raise ValueError('source repair must identify frozen/current revisions and screen quarantine')
    for key in ('reviewEvidence', 'regressionEvidence'):
        if not isinstance(amendment.get(key), list) or not amendment[key]: raise ValueError('source repair proof missing')
        for ref in amendment[key]: checked_ref(ref)
    return amendment


def repair_baseline(directory, plan_path, allocation, amendment_ref, current_source):
    """Reviewed incompatible-source recovery closes this screen; never remeasures."""
    directory = Path(directory); plan = read(plan_path)
    state = validate_identity(allocation, plan, directory)
    if state['pending']: raise ValueError('source repair requires stopped and settled compute')
    amendment = checked_amendment(amendment_ref, plan, current_source)
    journal = Journal(directory, plan)
    for pair in range(120):
        slots = plan['slots'][pair * 2:pair * 2 + 2]
        if any(journal.path(slot, 'start').exists() for slot in slots):
            journal.quarantine(pair, cause=amendment['cause'], amendment=amendment_ref)
    report, refs = report_from_journal(plan, journal, state['screen'])
    reason = 'reviewed source repair made the frozen screen incompatible; baseline retained without repeated attempts'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    value = {'schema': 1, 'kind': KIND + '-repair', 'plan': reference(plan_path), 'amendment': amendment_ref,
             'outcomes': refs, 'accounting': state['finished'], 'report': report, 'selectedRecipe': recipe_binding(),
             'reason': reason, 'sourceAfterRepair': current_source,
             'bookkeeping': 'autonomous repair after verified cleanup; no further model/rule work or allocation reset'}
    path = directory / 'receipt-repair.json'; immutable(path, value)
    return validate_repair(path, allocation)


def validate_repair(path, allocation, *, verify_plan=True):
    value = read(path); plan = read(checked_ref(value['plan']))
    state = validate_identity(allocation, plan, Path(path).parent)
    if verify_plan: validate(plan)
    checked_amendment(value['amendment'], plan, value['sourceAfterRepair'])
    if state['pending'] or state['finished'] != value['accounting'] or value['selectedRecipe'] != recipe_binding():
        raise ValueError('invalid settled source-repair screen receipt')
    report, refs = report_from_journal(plan, Journal(Path(path).parent, plan), state['screen'])
    reason = 'reviewed source repair made the frozen screen incompatible; baseline retained without repeated attempts'
    report.update(adopted=False, selectedRecipe=recipe_binding(), reasons=[*report['reasons'], reason])
    if report != value['report'] or refs != value['outcomes'] or value['reason'] != reason:
        raise ValueError('source repair receipt differs from quarantined evidence')
    return value
