// A server refresh can replace a clean field, but never an unsaved local draft.
// Version individual decisions so unrelated notes retain their mounted inputs.
export function applyDecisionNotes(state, notes) {
  state.noteVersions ??= new Map();
  const before = new Map(state.notes.map(note => [note.decisionId, note]));
  const after = new Map(notes.map(note => [note.decisionId, note]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!state.drafts.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) {
      state.noteVersions.set(id, (state.noteVersions.get(id) ?? 0) + 1);
    }
  }
  state.notes = notes;
}
