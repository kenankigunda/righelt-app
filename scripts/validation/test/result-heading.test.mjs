import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedResultHeading} from '../result-heading.mjs';

test('source-selected contracts assert exact winner and loser perspective for either side', () => {
  for (const [contract, win, loss] of [['legacy', 'Win', 'Loss'], ['perspective-v1', 'You won', 'Your opponent won']]) {
    for (const [outcome, winner, loser] of [['p1_win', 'p1', 'p2'], ['p2_win', 'p2', 'p1']]) {
      assert.equal(expectedResultHeading({contract, outcome, viewerSide: winner}), win);
      assert.equal(expectedResultHeading({contract, outcome, viewerSide: loser}), loss);
    }
  }
});

test('draws and neutral observers retain their exact contracts independently of player perspective', () => {
  for (const contract of ['legacy', 'perspective-v1']) {
    for (const viewerSide of [null, 'p1', 'p2']) assert.equal(expectedResultHeading({contract, outcome: 'draw', viewerSide}), 'Draw');
    assert.equal(expectedResultHeading({contract, outcome: 'p1_win'}), 'Player 1 wins');
    assert.equal(expectedResultHeading({contract, outcome: 'p2_win'}), 'Player 2 wins');
  }
});

test('unknown contracts, nonterminal states and invalid sides fail instead of weakening assertions', () => {
  for (const options of [{contract: 'future-v2', outcome: 'p1_win'}, {outcome: 'ongoing'}, {outcome: 'p1_win', viewerSide: 'Player 1'}]) {
    assert.throws(() => expectedResultHeading(options));
  }
});
