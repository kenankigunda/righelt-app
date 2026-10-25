// Selection is an incident identity, never a position in a changing stack.
export const createNotificationStack = () => {
  const selected = new Map();
  return {
    order(scope, items) {
      if (!items.length) { selected.delete(scope); return []; }
      const previous = selected.get(scope);
      // A newly arriving blocking failure takes precedence once. Users can then
      // deliberately cycle without the same failure continually stealing focus.
      const urgent = items.find(item => item.priority === 'urgent' && previous?.known.get(item.key) !== 'urgent');
      const active = urgent?.key ?? (items.some(item => item.key === previous?.key) ? previous.key : items[0].key);
      selected.set(scope, { key: active, known: new Map(items.map(item => [item.key, item.priority])) });
      const start = items.findIndex(item => item.key === active);
      return [...items.slice(start), ...items.slice(0, start)];
    },
    advance(scope, items) {
      const ordered = this.order(scope, items);
      if (ordered.length < 2) return false;
      selected.get(scope).key = ordered[1].key;
      return true;
    },
  };
};

export const recoveryActivity = game => {
  if (!game || game.storageBlocked || game.upgradeRequired || game.recoveryIssue) return 'static';
  return game.recovering || game.syncStatus === 'confirming' || game.pendingCommandCount > 0 ? 'processing' : 'static';
};
