const interactingNotification = () => {
  const doc = globalThis.document;
  const region = doc?.getElementById('shell-game-alerts');
  if (!region) return null;
  const cards = [...region.children];
  const focused = cards.find(card => card.contains(doc.activeElement));
  const expanded = cards.find(card => card.classList.contains('is-active') && card.querySelector('details[open], .issue-details, [aria-expanded="true"]'));
  return (focused ?? expanded)?.getAttribute('data-key') ?? null;
};

// Selection is an incident identity, never a position in a changing stack.
export const createNotificationStack = ({getInteractionKey = interactingNotification} = {}) => {
  const selected = new Map();
  const preferred = new Map();
  return {
    prefer(scope,key) {
      if(!key){preferred.delete(scope);return;}
      if(preferred.get(scope)?.key!==key)preferred.set(scope,{key,suppressed:false});
    },
    order(scope, items) {
      if (!items.length) { selected.delete(scope); return []; }
      const previous = selected.get(scope);
      const urgent = items.find(item => item.priority === 'urgent' && previous?.known.get(item.key) !== 'urgent');
      const pendingUrgent = urgent?.key ?? previous?.pendingUrgent;
      const held = previous?.releaseHoldOnce ? null : getInteractionKey(scope);
      const heldKey = items.some(item => item.key === held) ? held : null;
      // Keep a focused/expanded surface usable. The urgent card is immediately
      // in the stack, then takes priority after interaction ends. Explicit cycle
      // always wins, even when the outgoing card contains keyboard focus.
      const pendingKey = items.some(item => item.key === pendingUrgent) ? pendingUrgent : null;
      const preference=preferred.get(scope);
      const preferredKey=!preference?.suppressed&&items.some(item=>item.key===preference?.key)?preference.key:null;
      const currentUrgent=items.some(item=>item.key===previous?.key&&item.priority==='urgent')?previous.key:null;
      const active = heldKey ?? pendingKey ?? currentUrgent ?? preferredKey ?? (items.some(item => item.key === previous?.key) ? previous.key : items[0].key);
      selected.set(scope, {
        key: active,
        known: new Map(items.map(item => [item.key, item.priority])),
        pendingUrgent: heldKey && pendingKey !== heldKey ? pendingKey : null,
      });
      const start = items.findIndex(item => item.key === active);
      return [...items.slice(start), ...items.slice(0, start)];
    },
    advance(scope, items) {
      const ordered = this.order(scope, items);
      if (ordered.length < 2) return false;
      if(preferred.has(scope))preferred.get(scope).suppressed=true;
      Object.assign(selected.get(scope), {key: ordered[1].key, pendingUrgent: null, releaseHoldOnce: true});
      return true;
    },
  };
};

export const recoveryActivity = game => {
  if (!game || game.storageBlocked || game.upgradeRequired || game.recoveryIssue) return 'static';
  return game.recovering || game.syncStatus === 'confirming' || game.pendingCommandCount > 0 ? 'processing' : 'static';
};
