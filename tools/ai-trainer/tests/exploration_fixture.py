"""Synthetic screen evidence only. Never evaluates or trains a model."""
from unittest.mock import patch
from righelt_training import exploration_adoption as adoption
from righelt_training.development_probe import reference
from righelt_training.exploration_plan import freeze
from righelt_training.exploration_journal import Journal
from righelt_training.exploration_receipt import ScreenBudget, publish, validate_receipt
from righelt_training.sequence import immutable
from test_exploration_plan_metrics import fixture_plan
from test_exploration_journal_receipt import proof, GRANT


def receipt_fixture_validation():
    # Actual receipt, identity, accounting and rederived metric checks remain.
    # These fixture board rows are intentionally not real engine positions.
    return patch.object(adoption, 'validate_receipt',
                        side_effect=lambda *a, **kw: validate_receipt(*a, **kw, verify_plan=False))


def publish_selection(allocation, *, enabled=False):
    creation = allocation.accounting()[0]
    contract = creation['continuation']
    original, cases, rows = fixture_plan(checkpoint=reference(contract['recoveryCheckpoint']))
    seed = original['seedPlan']
    plan = freeze(cases, rows, cases_ref=seed['cases'], checkpoint=seed['checkpoint'],
                  allocation_id=creation['id'], source=seed['source'], runtime=seed['runtime'])
    directory = allocation.directory / 'exploration-screen'
    journal = Journal(directory, plan)
    immutable(directory / 'plan.json', plan)
    immutable(directory / 'launch.json', {'fixture': True})
    now = [1000.]
    with patch('time.time', side_effect=lambda: now[0]), patch('time.monotonic', side_effect=lambda: now[0]):
        budget = ScreenBudget(allocation, plan); budget.begin()
        if enabled:
            for slot in plan['slots']:
                journal.start(slot, charged=budget.state()['screen'], interval=budget.interval['id'], resources=GRANT)
                record = proof(plan, slot)
                if slot['arm'] == 'on':
                    record['record'].update(actionIndex=slot['replicate'] % 2,
                        policy=[{'index': 0, 'probability': .25}, {'index': 1, 'probability': .75}],
                        search={'reason': 'search', 'actions': [{'index': 0, 'visits': 16}, {'index': 1, 'visits': 48}]})
                    record['record']['rootExploration']['applied'] = True
                now[0] += 1
                journal.complete(slot, charged=budget.state()['screen'], status='verified', proof=record)
        publish(directory / 'plan.json', directory / 'launch.json', journal, budget)
    with receipt_fixture_validation():
        return adoption.publish(allocation.directory, directory / 'receipt.json')
