/** Capture the reading location before a coherent Home list refresh. */
export function captureHomeFocus(root, document) {
  const active = document?.activeElement;
  const section = active?.closest?.('[data-home-section-root]');
  if (!section || !root?.contains?.(section)) return null;
  const cards = [...section.querySelectorAll('a[data-game-id]')];
  const card = active.closest?.('a[data-game-id]');
  return {active, sectionKey:section.getAttribute('data-home-section-root'), gameId:card?.getAttribute('data-game-id') ?? null,
    cardIndex:card ? cards.indexOf(card) : 0};
}

/** Retain the old section rather than jumping to a newly populated section. */
export function refreshHomeFocus(root, captured, document = root?.ownerDocument) {
  const active = document?.activeElement;
  if (captured && active?.isConnected && active !== document?.body && active !== captured.active) return captureHomeFocus(root,document);
  return captured;
}

export function restoreHomeFocus(root, captured, document = root?.ownerDocument) {
  const active = document?.activeElement;
  if (active?.isConnected && active !== document?.body && active !== captured?.active) return false;
  if (!captured || captured.active?.isConnected) return false;
  const section = [...root.querySelectorAll('[data-home-section-root]')]
    .find(node => node.getAttribute('data-home-section-root') === captured.sectionKey);
  const cards = [...(section?.querySelectorAll('a[data-game-id]') ?? [])];
  const target = cards.find(node => node.getAttribute('data-game-id') === captured.gameId)
    ?? cards[Math.min(Math.max(captured.cardIndex,0),cards.length-1)]
    ?? section?.querySelector('h2') ?? root.querySelector('.home-start-title');
  if (!target) return false;
  if (!target.matches?.('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
  return true;
}
