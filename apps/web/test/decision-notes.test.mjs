import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDecisionNotes } from '../shell/decision-notes.js';

test('late persisted notes replace empty fields and remote deletions clear clean fields', () => {
  const state = { notes: [], drafts: new Map() };
  const notes = [{ decisionId: 'a', text: 'Saved', flagged: true }];
  applyDecisionNotes(state, notes);
  assert.equal(state.noteVersions.get('a'), 1);
  applyDecisionNotes(state, structuredClone(notes));
  assert.equal(state.noteVersions.get('a'), 1);
  applyDecisionNotes(state, []);
  assert.equal(state.noteVersions.get('a'), 2);
});
test('refresh retains dirty drafts and updates only changed clean decisions', () => {
  const draft = { text: 'Still typing', flagged: false };
  const state = { notes: [], drafts: new Map([['a', draft]]) };
  applyDecisionNotes(state, [{ decisionId: 'a', text: 'From elsewhere' }, { decisionId: 'b', text: 'Saved' }]);
  assert.equal(state.drafts.get('a'), draft);
  assert.equal(state.noteVersions.has('a'), false);
  assert.equal(state.noteVersions.get('b'), 1);
  state.drafts.delete('a');
  applyDecisionNotes(state, [{ decisionId: 'a', ...draft }, { decisionId: 'b', text: 'Saved' }]);
  assert.equal(state.noteVersions.get('a'), 1);
  assert.equal(state.noteVersions.get('b'), 1);
});
