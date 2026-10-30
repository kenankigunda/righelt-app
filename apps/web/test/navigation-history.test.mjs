import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationHistory } from '../shell/navigation-history.js';

test('Home creates a top visit while Back and Forward restore the individual visit', () => {
  let hash = '#/', y = 600, pages = { my: 2 }, nextId = 0;
  const history = { state: null, replaceState(state) { this.state = structuredClone(state); } };
  const visits = createNavigationHistory({ history, getHash: () => hash, capture: () => ({ y, pages }), id: () => String(++nextId) });
  visits.save({ focusGameId: 'a' });
  const home = structuredClone(history.state);
  hash = '#/game/a'; history.state = null;
  assert.deepEqual(visits.arrive(), { restore: null, direction: null, traversed: false });
  y = 120; visits.save();
  const game = structuredClone(history.state);
  hash = '#/'; history.state = home; visits.observePop(home);
  assert.deepEqual(visits.arrive(), { restore: { y: 600, pages: { my: 2 }, focusGameId: 'a' }, direction: 'back', traversed: true });
  hash = '#/game/a'; history.state = game; visits.observePop(game);
  assert.equal(visits.arrive().restore.y, 120);
  hash = '#/'; history.state = null;
  assert.equal(visits.arrive().restore, null);
});

test('late scroll events cannot overwrite the newly traversed browser entry', () => {
  let hash = '#/', nextId = 0;
  const history = { state: { unrelated: true }, replaceState(state) { this.state = structuredClone(state); } };
  const visits = createNavigationHistory({ history, getHash: () => hash, capture: () => ({ y: 42 }), id: () => String(++nextId) });
  visits.save();
  assert.equal(history.state.unrelated, true);
  const before = structuredClone(history.state);
  hash = '#/game/a'; history.state = null;
  visits.save();
  assert.equal(history.state, null);
  visits.arrive();
  hash = '#/'; history.state = before; visits.observePop(before);
  assert.equal(visits.arrive().restore.y, 42);
});

test('closing a utility replaces the current visit without losing its scroll ownership', () => {
  let hash = '#/game/a?debug=1';
  const history = { state: null, replaceState(state, title, url) { this.state = structuredClone(state); if (url) hash = url; } };
  const visits = createNavigationHistory({ history, getHash: () => hash, capture: () => ({ y: 250 }), id: () => 'visit' });
  visits.replaceHash('#/game/a');
  visits.save();
  assert.equal(history.state.righeltVisit.hash, '#/game/a');
  assert.equal(history.state.righeltVisit.view.y, 250);
});

test('Back between two visits with the same URL signals restoration without hashchange', () => {
  let hash = '#/game/a', y = 80, nextId = 0;
  const history = { state: null, replaceState(state, title, url) { this.state = structuredClone(state); if (url) hash = url; } };
  const visits = createNavigationHistory({ history, getHash: () => hash, capture: () => ({ y }), id: () => String(++nextId) });
  visits.save(); const first = structuredClone(history.state);
  hash = '#/game/a?debug=1'; history.state = null; visits.arrive();
  visits.replaceHash('#/game/a'); y = 340; visits.save();
  history.state = first;
  assert.equal(visits.observePop(first), true);
  assert.deepEqual(visits.arrive().restore, { y: 80 });
  assert.equal(visits.observePop(first), false);
});
