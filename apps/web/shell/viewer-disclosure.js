import {patchSectionContent} from './dom-patch.js';

export function recordViewerDisclosure(event, expandedGames) {
  const disclosure=event.target;
  if(!disclosure.isConnected || !disclosure.matches?.('[data-viewer-disclosure]'))return;
  if(disclosure.open)expandedGames.add(disclosure.dataset.gameId);else expandedGames.delete(disclosure.dataset.gameId);
}

export function recordViewerDisclosureClick(event, expandedGames) {
  const summary=event.target.closest?.('[data-viewer-disclosure] summary');
  if(!summary || event.defaultPrevented || event.button>0)return;
  const disclosure=summary.parentElement;
  // Native toggle events are queued. Capture the native click intent now so a
  // same-task presence refresh cannot restore the previous open attribute.
  if(disclosure.open)expandedGames.delete(disclosure.dataset.gameId);else expandedGames.add(disclosure.dataset.gameId);
}

// A roster can lose its disclosure as the audience shrinks. Retain only the
// focus that control owned; a background refresh must not claim other focus.
export function patchViewerSection(section, markup, {document=globalThis.document}={}) {
  const focused=document.activeElement;
  const owned=section.contains(focused) && focused?.matches?.('[data-viewer-disclosure] summary');
  const next=document.createElement('div');next.innerHTML=markup;
  const currentAudience=section.querySelector('[data-viewer-audience]'),nextAudience=next.querySelector('[data-viewer-audience]');
  // The parent Players patch owns invitation controls and their pending focus.
  // Presence-only audience refreshes must not disable those controls first.
  if(currentAudience && nextAudience)patchSectionContent(currentAudience,nextAudience);
  else patchSectionContent(section,next.firstElementChild);
  if(owned && !focused.isConnected && document.activeElement===document.body)section.querySelector('h3')?.focus({preventScroll:true});
}

// A fixed mobile navigation bar is outside normal page flow. Keyboard focus
// must reveal the audience control above it without moving pointer targets.
export function revealViewerKeyboardFocus(event, {document=globalThis.document}={}) {
  const target=event.target;
  if(!target.closest?.('[data-testid="viewers-section"]') || !target.matches?.(':focus-visible'))return;
  const navigation=document.querySelector('.shell-mobile-tabbar[data-visible="true"] [data-mobile-nav-controls]');
  if(!navigation)return;
  const control=target.getBoundingClientRect(),bar=navigation.getBoundingClientRect();
  if(control.bottom>bar.top && control.top<bar.bottom && control.right>bar.left && control.left<bar.right)target.scrollIntoView({block:'center',behavior:'instant'});
}
