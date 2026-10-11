// Presentation only: callers own operation state, cancellation, and recovery.
export const LOADING_CUE_DELAY_MS = 200;
export const LOADING_CONTEXT_DELAY_MS = 5000;
export const loadingPhase = elapsed => elapsed >= LOADING_CONTEXT_DELAY_MS ? 'slow' : elapsed >= LOADING_CUE_DELAY_MS ? 'visible' : 'quiet';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export const loadingAttributes = (key, message = 'Still loading…') => `data-loading-state="pending" data-loading-key="${escape(key)}" data-loading-message="${escape(message)}" aria-busy="true"`;
export const loadingCue = () => '<span class="loading-pieces" aria-hidden="true"><i></i><i></i><i></i></span>';

// Tracks continuous operations through synchronous DOM patches without restarting
// their clocks. A removed operation is retired, not replayed when revisited.
export function mountLoadingFeedback(document, { now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const selector = '[data-loading-key], [data-loading-state]';
  const episodes = new Map();
  const contexts = new Map();
  let timer = null, destroyed = false;
  const window = document.defaultView;
  const sync = () => {
    if (destroyed) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    const active = new Set();
    let next = Infinity;
    for (const element of document.querySelectorAll(selector)) {
      const isButton = element.tagName === 'BUTTON';
      if (isButton) element.classList.add('loading-control');
      const pending = element.dataset.loadingState === 'pending' || element.dataset.pending === 'true';
      const key = element.dataset.loadingKey || element;
      if (!pending || element.closest('dialog:not([open]), [hidden], [inert]')) {
        element.removeAttribute('data-loading-phase');
        element.querySelector(':scope > .loading-pieces')?.remove();
        element.querySelector(':scope > .loading-context')?.remove();
        continue;
      }
      active.add(key);
      if (!episodes.has(key)) episodes.set(key, now());
      const elapsed = now() - episodes.get(key);
      const phase = loadingPhase(elapsed);
      if (isButton && phase === 'slow' && element.dataset.loadingContext !== 'external') {
        let status = contexts.get(key);
        if (!status?.isConnected) {
          status = document.createElement('span'); status.className = 'loading-context';
          status.setAttribute('role','status');
          status.textContent = element.dataset.loadingMessage || 'This is taking a little longer than usual.';
          element.insertAdjacentElement('afterend',status); contexts.set(key,status);
        }
      }
      if (element.dataset.loadingPhase !== phase) element.dataset.loadingPhase = phase;
      if (!element.querySelector(':scope > .loading-pieces')) element.insertAdjacentHTML('beforeend', loadingCue());
      // The label remains unchanged. Status has no role in accessible button names.
      if (!isButton && element.dataset.loadingContext !== 'external' && phase === 'slow' && !element.querySelector(':scope > .loading-context')) {
        const status = document.createElement('span');
        status.className = 'loading-context';
        status.textContent = element.dataset.loadingMessage || "This is taking a little longer than usual.";
        element.append(status);
        // Busy regions may defer live announcements until completion, when this
        // message is removed. Announce outside that subtree while keeping the
        // visible context beside its operation.
        if (!contexts.get(key)?.isConnected) {
          const announcement = document.createElement('span');
          announcement.className = 'sr-only'; announcement.setAttribute('role','status');
          document.body.append(announcement);
          announcement.textContent = status.textContent;
          contexts.set(key,announcement);
        }
      }
      if (elapsed < LOADING_CUE_DELAY_MS) next = Math.min(next, LOADING_CUE_DELAY_MS - elapsed);
      else if (elapsed < LOADING_CONTEXT_DELAY_MS) next = Math.min(next, LOADING_CONTEXT_DELAY_MS - elapsed);
    }
    for (const key of episodes.keys()) if (!active.has(key)) { episodes.delete(key); contexts.get(key)?.remove(); contexts.delete(key); }
    if (Number.isFinite(next)) timer = setTimer(sync, Math.max(1,next));
  };
  const visibility = () => document.documentElement.toggleAttribute('data-loading-hidden',document.hidden);
  const observer = new window.MutationObserver(sync);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-loading-state','data-loading-key','data-pending','open','hidden','inert']});
  document.addEventListener('visibilitychange',visibility);
  visibility(); sync();
  return () => { destroyed=true;observer.disconnect();if(timer!==null)clearTimer(timer);episodes.clear();for(const status of contexts.values())status.remove();contexts.clear();document.removeEventListener('visibilitychange',visibility); };
}
