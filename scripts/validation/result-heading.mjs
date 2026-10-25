import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

// Choose the source contract before the journey. A failed heading assertion
// never switches to another contract or accepts both old and new copy.
export function expectedResultHeading({contract = 'legacy', outcome, viewerSide = null, winnerName, controlsBothSides = false}) {
  assert.ok(['legacy', 'perspective-v1', 'perspective-v2'].includes(contract), 'Unsupported result heading contract');
  assert.ok(['p1_win', 'p2_win', 'draw'].includes(outcome), 'Expected a terminal outcome');
  assert.ok([null, 'p1', 'p2'].includes(viewerSide), 'Expected a player side or neutral observer');
  assert.equal(typeof controlsBothSides, 'boolean', 'Expected explicit both-side ownership');
  assert.ok(!controlsBothSides || contract === 'perspective-v2', 'Both-side ownership requires the named result contract');
  if (outcome === 'draw') return 'Draw';
  const winner = outcome.slice(0, 2);
  if (controlsBothSides) return 'You won';
  if (viewerSide === null && contract === 'perspective-v2') {
    assert.ok(typeof winnerName === 'string' && winnerName.trim().length > 0, 'Named observer result requires the captured winner name');
    return `${winnerName} won`;
  }
  if (viewerSide === null) return `Player ${winner === 'p1' ? '1' : '2'} wins`;
  const won = viewerSide === winner;
  return contract !== 'legacy' ? won ? 'You won' : 'Your opponent won' : won ? 'Win' : 'Loss';
}

export async function assertResultHeading(result, options, assertionOptions) {
  await expect(result.getByRole('heading', {name: expectedResultHeading(options), exact: true})).toBeVisible(assertionOptions);
}
