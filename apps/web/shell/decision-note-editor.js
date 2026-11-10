export function mountDecisionNoteEditor({document,getCurrentViewedGameId,getDecisionDebugState,updateComputerUi}) {
document.addEventListener('toggle', event => {
  const key = event.target?.dataset?.debugSection;
  if (!key) return;
  const state = getDecisionDebugState(getCurrentViewedGameId());
  const changed = state.open.has(key) !== event.target.open;
  if (event.target.open) state.open.add(key); else state.open.delete(key);
  if (changed && !event.target.open && key === 'notes') delete state.noteDecisionId;
  if (changed && event.target.open && (key === 'position' || key === 'notes')) updateComputerUi();
}, true);
document.addEventListener('focusin', event => {
  if (!event.target?.dataset?.debugNote) return;
  // Focus precedes typing: retain this editor's identity before any playback render.
  getDecisionDebugState(getCurrentViewedGameId()).noteDecisionId = event.target.dataset.decisionId;
});
document.addEventListener('input', event => {
  const field = event.target?.dataset?.debugNote;
  if (!field) return;
  const state = getDecisionDebugState(getCurrentViewedGameId()), id = event.target.dataset.decisionId;
  const note = { ...(state.drafts.get(id) ?? state.notes.find(note => note.decisionId === id) ?? { text: '', flagged: false }) };
  note[field] = field === 'flagged' ? event.target.checked : event.target.value;
  state.drafts.set(id, note);
});
}
