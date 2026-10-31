const scrollIntents=new WeakMap();
const scrollIntent = document => {
  if(!document || typeof document!=='object')return {generation:0};
  if(scrollIntents.has(document))return scrollIntents.get(document);
  const intent={generation:0};scrollIntents.set(document,intent);
  const advance=event=>{if(event.isTrusted)intent.generation++;};
  document.addEventListener?.('wheel',advance,{passive:true,capture:true});
  document.addEventListener?.('touchmove',advance,{passive:true,capture:true});
  document.addEventListener?.('keydown',event=>{
    if(event.isTrusted && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)
      && !event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))intent.generation++;
  },true);
  document.addEventListener?.('pointerdown',event=>{
    const viewport=document.documentElement;
    if(event.isTrusted && viewport && (event.clientX>=viewport.clientWidth || event.clientY>=viewport.clientHeight))intent.generation++;
  },true);
  return intent;
};

/** Capture the reading location before a coherent Home list refresh. */
export function captureHomeFocus(root, document) {
  const active = document?.activeElement;
  const section = active?.closest?.('[data-home-section-root]');
  if (!section || !root?.contains?.(section)) return null;
  const cards = [...section.querySelectorAll('a[data-game-id]')];
  const card = active.closest?.('a[data-game-id]');
  return {active, sectionKey:section.getAttribute('data-home-section-root'), gameId:card?.getAttribute('data-game-id') ?? null,
    cardIndex:card ? cards.indexOf(card) : 0, sectionTop:section.getBoundingClientRect?.().top,scrollIntentGeneration:scrollIntent(document).generation};
}

/** Retain the old section rather than jumping to a newly populated section. */
export function refreshHomeFocus(root, captured, document = root?.ownerDocument) {
  const active = document?.activeElement;
  if (captured && active?.isConnected && active !== document?.body && active !== captured.active) return captureHomeFocus(root,document);
  if (!captured) return captured;
  const section=[...root.querySelectorAll('[data-home-section-root]')].find(node=>node.getAttribute('data-home-section-root')===captured.sectionKey);
  const generation=scrollIntent(document).generation;
  // Internal patches may temporarily clamp document scroll while miniatures
  // mount. Keep the original anchor until actual user scrolling supersedes it.
  if(captured.scrollIntentGeneration===generation)return captured;
  return {...captured,sectionTop:section?.getBoundingClientRect?.().top,scrollIntentGeneration:generation};
}

/** Anchor the old section through each synchronous list patch, including loading. */
export function restoreHomeReadingPosition(root,captured,document=root?.ownerDocument) {
  const active=document?.activeElement;
  if (!captured || (active?.isConnected && active!==document?.body && active!==captured.active)) return;
  const section=[...root.querySelectorAll('[data-home-section-root]')].find(node=>node.getAttribute('data-home-section-root')===captured.sectionKey);
  const top=section?.getBoundingClientRect?.().top;
  if(Number.isFinite(top)&&Number.isFinite(captured.sectionTop)) {
    const view=document?.defaultView,beforeY=view?.scrollY;
    view?.scrollBy?.({top:top-captured.sectionTop,behavior:'instant'});
    if(view?.__RIGHELT_VERBOSE_CLIENT_LOGS)console.log(JSON.stringify({event:'home_reading_anchor',top,capturedTop:captured.sectionTop,beforeY,afterY:view.scrollY,maxScrollY:document.documentElement.scrollHeight-view.innerHeight}));
  }
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
