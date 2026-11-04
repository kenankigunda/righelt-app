// A pending copy can outlive the Players panel node that started it.
// Keep the user's intent in the invitation scope, never in a detached root.
export function createPendingInvitationFocus({ document, getScope }) {
  let intent = null;
  const sameScope = (a, b) => a && b && a.owner === b.owner &&
    a.generation === b.generation && a.visit === b.visit &&
    a.route === b.route && a.panel === b.panel;
  const matches = (node, value) => node?.getAttribute?.('data-action') === 'copy-invite' &&
    node.getAttribute('data-game-id') === value.gameId &&
    node.getAttribute('data-invite-role') === value.role;
  const clear = () => { intent = null; };
  return {
    clear,
    begin(control, pendingKey) {
      clear();
      if (document.activeElement !== control || document.hidden || document.hasFocus?.() === false) return;
      const gameId = control.getAttribute('data-game-id');
      const role = control.getAttribute('data-invite-role');
      if (!gameId || !role || control.getAttribute('data-action') !== 'copy-invite') return;
      intent = { scope: { ...getScope() }, gameId, role, pendingKey };
    },
    noteFocus(target) {
      if (intent && target !== document.body && !matches(target, intent)) clear();
    },
    notePointer(target) {
      if (intent && !matches(target?.closest?.('[data-action]') ?? target, intent)) clear();
    },
    restore({ root, pending }) {
      const saved = intent;
      if (!saved) return false;
      if (!sameScope(saved.scope, getScope()) || document.hidden || document.hasFocus?.() === false) { clear(); return false; }
      const active = document.activeElement;
      if (active !== document.body && !matches(active, saved)) { clear(); return false; }
      if (pending(saved.pendingKey)) return false;
      const target = [...root.querySelectorAll('[data-action="copy-invite"]')].find(node => matches(node, saved));
      clear();
      if (!target || !target.isConnected || target.disabled || target.getAttribute('aria-disabled') === 'true' || target.closest('[inert], [aria-hidden="true"]')) return false;
      target.focus({ preventScroll: true });
      return document.activeElement === target;
    },
  };
}
