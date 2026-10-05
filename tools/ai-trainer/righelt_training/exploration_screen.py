"""Externally supervised development comparison, invoked as an allocation phase.

This command never creates an allocation and cannot run within a supervisor's
open interval. The sequence coordinator must call it before training admission.
"""
import argparse
from dataclasses import replace
import fcntl
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import uuid

from .allocation import Allocation, BudgetExhausted, alive, append, validate_contract
from .bootstrap import source_identity, runtime_identity
from .config import ROOT
from .development_probe import checked_ref, reference, corpus_rows
from .exploration_journal import Journal, observations
from .exploration_plan import LIMITS, validate
from .exploration_receipt import ScreenBudget, accounting, publish, recover_publication, resolve_publication, terminal_baseline, repair_baseline, validate_receipt, KIND
from .processes import start_group, stop_group, register_owned, cleanup_owned, install_stop_handlers
from .resource_policy import LIMITS as RESOURCE_LIMITS
from .resources import AdaptivePolicy
from .sequence import immutable, read
from .telemetry import Telemetry


class ResourcePause(Exception): pass


def compatible_source(plan):
    source = source_identity(); expected = plan['seedPlan']['source']
    # An unrelated commit does not change rule/model/source proof dependencies.
    return (all(source[key] == expected[key] for key in ('configSha256', 'proofDependencies', 'bootstrapDependencies'))
            and runtime_identity() == plan['seedPlan']['runtime'])


class ComputeProcess:
    """No inference in this process. Even a blocked MPS call is killable here."""
    def __init__(self, directory, launch, session, *, argv=None):
        self.directory = Path(directory); self.session = Path(session)
        self.session.mkdir(parents=True, exist_ok=True)
        self.stderr = (self.session / 'worker.stderr').open('ab')
        self.process = start_group(argv or [sys.executable, '-m', 'righelt_training.exploration_worker',
                                           '--launch', str(launch), '--session', str(session)],
                                   cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr)
        try: register_owned(directory, self.process)
        except BaseException:
            stop_group(self.process); self.process.stdin.close(); self.process.stdout.close(); self.stderr.close()
            raise
        self.selector = selectors.DefaultSelector(); self.selector.register(self.process.stdout, selectors.EVENT_READ)
        os.set_blocking(self.process.stdin.fileno(), False)
        self.buffer = b''; self.started = time.monotonic()

    def send(self, command, seconds, check):
        deadline = time.monotonic() + seconds
        data = memoryview((json.dumps(command, allow_nan=False) + '\n').encode())
        if len(data) > 16 * 1024 * 1024: raise ValueError('oversized screen dispatch')
        writer = selectors.DefaultSelector()
        try:
            writer.register(self.process.stdin, selectors.EVENT_WRITE)
            while data:
                check()
                if time.monotonic() >= deadline: raise TimeoutError('external screen dispatch deadline')
                for key, _ in writer.select(timeout=min(.1, max(0., deadline - time.monotonic()))):
                    try: data = data[os.write(key.fd, data):]
                    except BlockingIOError: pass
        finally: writer.close()

    def receive(self, seconds, check):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            check()
            if b'\n' in self.buffer:
                line, self.buffer = self.buffer.split(b'\n', 1)
                answer = json.loads(line)
                if answer.get('type') == 'error': raise ValueError('screen worker correctness error: ' + str(answer))
                return answer
            for key, _ in self.selector.select(timeout=min(.1, max(0., deadline - time.monotonic()))):
                data = os.read(key.fd, 65536)
                if not data:
                    status_path = self.session / 'operation-status.json'
                    if status_path.exists() and read(status_path).get('status') == 'timed-out':
                        raise TimeoutError('independent model watchdog expired')
                    raise RuntimeError('screen worker exited without a disposition')
                self.buffer += data
                if len(self.buffer) > 16 * 1024 * 1024: raise ValueError('oversized screen worker output')
        raise TimeoutError('external screen operation deadline')

    def stop(self):
        try:
            stop_group(self.process)
            cleanup_owned(self.directory)
        finally:
            self.selector.close()
            self.process.stdin.close(); self.process.stdout.close(); self.stderr.close()


class Screen:
    def __init__(self, allocation, plan_path, gate_path, activity, *, process_factory=ComputeProcess, repair_amendment=None):
        self.allocation = allocation; self.plan_path = Path(plan_path); self.plan = read(plan_path)
        self.directory = allocation.directory / 'exploration-screen'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.journal = Journal(self.directory, self.plan); self.activity = Path(activity)
        self.gate_path = Path(gate_path); self.process_factory = process_factory
        self.policy = AdaptivePolicy(); self.worker = None; self.next_sample = 0.; self.grant = None
        self.history = None; self.budget = None; self.launch_path = self.directory / 'launch.json'
        self.telemetry = None; self.telemetry_pid = None
        self.repair_amendment = repair_amendment

    def sample(self, *, starting=False, force=False):
        if not force and time.monotonic() < self.next_sample: return self.grant
        pid = self.worker.process.pid if self.worker else None
        if self.telemetry is None or self.telemetry_pid != pid:
            self.telemetry = Telemetry(self.allocation.root, self.activity,
                                       self.worker.session / 'device-memory.json' if self.worker else None, pid)
            self.telemetry_pid = pid
        sample = self.telemetry.sample()
        # Only the startup interval permits an absent first heartbeat. Host memory
        # and pressure limits still apply; no arm is dispatched until model ready.
        if starting and not sample.device_memory_known and time.monotonic() - self.worker.started < LIMITS['startupSeconds']:
            sample = replace(sample, device_memory_known=True)
        self.grant = self.policy.decide(sample).record()
        self.next_sample = time.monotonic() + RESOURCE_LIMITS['sampleSeconds']
        append(self.directory / 'resources.jsonl', {'observedAt': time.time(), 'grant': self.grant,
                                                  'screenChargedSeconds': self.budget.state()['screen']})
        if self.history is not None: self.history.append(self.grant)
        if self.grant['stop']: raise ResourcePause('resource stop: ' + self.grant['reason'])
        return self.grant

    def check(self, *, starting=False):
        if self.budget.bound(1) <= 0: raise TimeoutError('screen or validation reserve reached')
        if self.sample(starting=starting)['paused']: raise ResourcePause(self.grant['reason'])

    def wait_resources(self):
        started = time.monotonic()
        while self.budget.bound(1) > 0:
            grant = self.sample(force=True)
            if not grant['paused']: return time.monotonic() - started
            time.sleep(min(RESOURCE_LIMITS['sampleSeconds'], self.budget.bound(RESOURCE_LIMITS['sampleSeconds'])))
        raise BudgetExhausted('screen allowance consumed by supervised resource wait')

    def stop_worker(self):
        if self.worker:
            started = time.monotonic()
            try:
                self.worker.stop()
                if time.monotonic() - started > LIMITS['cleanupSeconds']:
                    raise RuntimeError('screen cleanup exceeded verified five-second allowance')
            finally: self.worker = None; self.next_sample = 0.

    def start_worker(self, seconds=None):
        if self.worker: return
        bound = self.budget.bound(min(LIMITS['startupSeconds'], seconds) if seconds is not None else LIMITS['startupSeconds'])
        if bound <= 0: raise BudgetExhausted('no allowance for model restoration')
        session = self.directory / 'sessions' / uuid.uuid4().hex
        self.worker = self.process_factory(self.allocation.directory, self.launch_path, session)
        self.next_sample = 0.
        answer = self.worker.receive(bound, lambda: self.check(starting=True))
        if answer.get('type') != 'ready' or answer.get('checkpoint') != self.plan['seedPlan']['checkpoint']:
            raise ValueError('screen model restoration identity mismatch')
        gate = read(self.gate_path)['resumeCheckpoint']
        audit = answer.get('audit', {})
        if (audit.get('checkpoint') != gate['checkpoint'] or audit.get('sha256') != gate['sha256']
                or audit.get('updates', 0) <= 0 or not answer.get('recoveryReferences')):
            raise ValueError('screen lacks audited optimizer/replay lineage')
        for ref in answer['recoveryReferences']: checked_ref(ref)
        immutable(session / 'restoration.json', answer)
        self.sample(force=True)

    def arm(self, slot, state):
        self.history = [self.grant]
        self.journal.start(slot, charged=self.budget.state()['screen'], interval=self.budget.interval['id'], resources=self.grant)
        timings = {}; pauses = 0.; status = 'unfinished'; reason = None; proof = None
        try:
            wait_start = time.monotonic()
            try: self.wait_resources()
            finally: pauses += time.monotonic() - wait_start
            selection_start = time.monotonic()
            selection_deadline = selection_start + self.budget.bound(LIMITS['selectionSeconds'])
            self.start_worker(max(0., selection_deadline - time.monotonic()))
            timings['modelStartupSeconds'] = time.monotonic() - selection_start
            self.check()
            if time.monotonic() >= selection_deadline: raise TimeoutError('restoration consumed selection allowance')
            self.worker.send({'type': 'select', 'slot': slot, 'state': state},
                             max(0., selection_deadline - time.monotonic()), self.check)
            answer = self.worker.receive(max(0., selection_deadline - time.monotonic()), self.check)
            timings['selectionSeconds'] = time.monotonic() - selection_start
            immutable(self.journal.path(slot, 'selection'), answer)
            if answer.get('type') != 'selected' or answer.get('slotId') != slot['id']: raise ValueError('selection slot mismatch')
            result = answer['answer']
            if result.get('type') == 'unfinished': reason = 'selection-' + result.get('reason', 'limit')
            elif result.get('type') != 'searched': raise ValueError('unknown selection disposition')
            elif result['result']['status'] == 'recovery':
                reason = 'selection-' + result['result'].get('reason', 'recovery'); status = 'failed'
            elif result['result']['status'] != 'ready': raise ValueError('invalid selection state')
            else:
                self.check(); start = time.monotonic(); record_deadline = start + self.budget.bound(LIMITS['replaySeconds'])
                self.worker.send({'type': 'record', 'slotId': slot['id']}, max(0., record_deadline - time.monotonic()), self.check)
                recorded = self.worker.receive(max(0., record_deadline - time.monotonic()), self.check)
                if recorded.get('type') != 'recorded' or recorded.get('slotId') != slot['id']: raise ValueError('record slot mismatch')
                result = recorded['answer']
                if result.get('type') == 'unfinished': reason = 'replay-' + result.get('reason', 'limit')
                elif result.get('type') != 'exploration-recorded': raise ValueError('unknown record disposition')
                else:
                    proof = result['proof']
                    observations(self.plan, slot, proof)
                    immutable(self.journal.path(slot, 'proof'), proof)
                    status = 'verified'
                timings['recordReplaySeconds'] = time.monotonic() - start
                if timings['recordReplaySeconds'] > LIMITS['replaySeconds']:
                    proof = None; status = 'unfinished'; reason = 'record-publication-deadline'
            if status != 'verified':
                start = time.monotonic(); self.stop_worker(); timings['cleanupSeconds'] = time.monotonic() - start
        except (TimeoutError, ResourcePause, BudgetExhausted) as error:
            reason = str(error); start = time.monotonic(); self.stop_worker(); timings['cleanupSeconds'] = time.monotonic() - start
        except BaseException as error:
            start = time.monotonic(); self.stop_worker(); timings['cleanupSeconds'] = time.monotonic() - start
            self.journal.complete(slot, charged=self.budget.state()['screen'], status='correctness-error', reason=str(error),
                                  pauses=pauses, timings=timings, resource_history=self.history)
            raise
        finally:
            history = self.history; self.history = None
        self.journal.complete(slot, charged=self.budget.state()['screen'], status=status, reason=reason, proof=proof,
                              pauses=pauses, timings=timings, resource_history=history)

    def run(self):
        # Caller holds supervisor.lock. This module deliberately owns the normal
        # Allocation interval rather than nesting one beneath the stage runner.
        creation, _, pending = self.allocation.accounting()
        if any(alive(row['owner']) for row in pending): raise ValueError('another accounting coordinator still owns allocation')
        cleanup_owned(self.allocation.directory)
        intent = recover_publication(self.directory, self.allocation)
        self.allocation.recover_abandoned(cleanup_owned)
        repaired = self.directory / 'receipt-repair.json'
        if repaired.exists(): return validate_receipt(repaired, self.allocation)
        if self.repair_amendment and not compatible_source(self.plan):
            self.journal.interrupted(accounting(self.allocation)['screen'])
            return repair_baseline(self.directory, self.plan_path, self.allocation,
                                   reference(self.repair_amendment), source_identity())
        terminal = self.directory / 'receipt-terminal.json'
        if terminal.exists(): return validate_receipt(terminal, self.allocation)
        receipt_path = self.directory / 'receipt.json'
        if intent:
            resolution = self.directory / 'receipt-resolution.json'
            if resolution.exists(): return validate_receipt(resolution, self.allocation)
            if accounting(self.allocation)['screen'] != intent['report']['chargedSeconds']:
                return resolve_publication(self.directory, self.allocation)
            # A crash after intent but before receipt cannot dispatch more slots.
            immutable(receipt_path, {**intent, 'kind': KIND + '-receipt', 'intent': reference(self.directory / 'publication-intent.json'),
                                    'chargeFloor': self.allocation.charge_floor(intent['interval']),
                                    'selectedRecipe': intent['report']['selectedRecipe']})
            return validate_receipt(receipt_path, self.allocation)
        self.budget = ScreenBudget(self.allocation, self.plan)
        self.journal.interrupted(self.budget.state()['screen'])
        if any(row['status'] == 'correctness-error' for row in self.journal.results()[0]):
            raise ValueError('unresolved screen correctness failure requires reviewed repair')
        try: self.budget.begin()
        except BudgetExhausted:
            return terminal_baseline(self.directory, self.plan_path, self.allocation)
        try:
            validate(self.plan)
            if not compatible_source(self.plan): raise ValueError('screen dependencies changed; quarantine incompatible pairs before recovery')
            contract = validate_contract(creation['continuation'], self.allocation.root)
            if str(checked_ref(self.plan['seedPlan']['checkpoint'])) != contract['recoveryCheckpoint']:
                raise ValueError('screen checkpoint differs from approved continuation')
            # Compatible repair/source changes retain the immutable original
            # launch/gate. A newly supplied gate never rewrites prior evidence.
            if self.launch_path.exists():
                original = read(self.launch_path)
                if (original['plan'] != reference(self.plan_path) or original['contract'] != contract
                        or original['allocation'] != str(self.allocation.directory)):
                    raise ValueError('frozen screen launch changed')
                self.gate_path = checked_ref(original['gate'])
            gate = read(self.gate_path); resume = gate['resumeCheckpoint']
            if (resume['checkpoint'] != contract['recoveryCheckpoint'] or resume['sha256'] != contract['recoverySha256']):
                raise ValueError('screen gate has different audited checkpoint')
            checked_ref({'path': resume['auditPath'], 'sha256': resume['auditSha256']})
            immutable(self.launch_path, {'schema': 1, 'plan': reference(self.plan_path), 'gate': reference(self.gate_path),
                                        'allocation': str(self.allocation.directory), 'contract': contract})
            self.wait_resources(); self.start_worker()  # common setup, before pair admission
            rows = corpus_rows(checked_ref(self.plan['seedPlan']['corpus']))
            for offset in range(0, len(self.plan['slots']), 2):
                pair = self.plan['slots'][offset:offset + 2]
                remaining = [slot for slot in pair if not self.journal.path(slot, 'outcome').exists()]
                if not remaining: continue
                if not self.budget.admit_pair(): break
                for slot in remaining:
                    if self.budget.bound(LIMITS['selectionSeconds']) <= 0: break
                    root = self.plan['seedPlan']['roots'][slot['rootOrdinal']]
                    self.arm(slot, rows[root['corpusIndex']]['state'])
            self.stop_worker()
            return publish(self.plan_path, self.launch_path, self.journal, self.budget)
        except (ResourcePause, BudgetExhausted, TimeoutError):
            self.stop_worker()
            if self.budget.remaining() < LIMITS['publicationSeconds']:
                cleanup_owned(self.allocation.directory); self.budget.finish('publication-reserve-exhausted')
                return terminal_baseline(self.directory, self.plan_path, self.allocation)
            return publish(self.plan_path, self.launch_path, self.journal, self.budget)
        finally:
            self.stop_worker(); cleanup_owned(self.allocation.directory)
            self.budget.finish('screen-coordinator-stopped')


def main():
    install_stop_handlers()
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('allocation', 'plan', 'gate', 'activity'): parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--repair-amendment', type=Path)
    args = parser.parse_args(); allocation = Allocation(args.allocation.parent, args.allocation)
    with (allocation.root / 'supervisor.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = Screen(allocation, args.plan, args.gate, args.activity, repair_amendment=args.repair_amendment).run()
        receipt_name = ('receipt-resolution.json' if result['kind'].endswith('-resolution') else
                        'receipt-terminal.json' if result['kind'].endswith('-terminal') else 'receipt.json')
        if result['kind'].endswith('-repair'): receipt_name = 'receipt-repair.json'
        print(json.dumps({'receipt': str(allocation.directory / 'exploration-screen' / receipt_name),
                          'selectedRecipe': result['selectedRecipe'], 'chargedSeconds': result['report']['chargedSeconds']}))


if __name__ == '__main__': main()
