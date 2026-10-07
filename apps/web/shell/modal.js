import { animateOverlayEntry, animateOverlayExit } from './overlay-motion.js';
import { lockOverlayScroll } from './overlay-scroll.js';
// Native modal dialogs provide background inertness and the browser focus trap.
export const createModal = ({ document = globalThis.document, labelId, className = "", blocking = false, onClose = () => {} }) => {
  const element = document.createElement("dialog");
  element.className = `story-modal ${className}`;
  element.setAttribute("aria-labelledby", labelId);
  document.body.append(element);
  let sizeAnimation = null;
  let entryAnimation = null;
  let lastHeight = null;
  const content = document.createElement("div");
  content.className = "modal-content";
  const controls = document.createElement("div");
  controls.className = "modal-controls";
  element.append(controls);
  element.append(content);
  const resizeObserver = typeof globalThis.ResizeObserver === "function" ? new ResizeObserver(() => {
    if (!element.open) { lastHeight = null; return; }
    const style = getComputedStyle(element);
    const next = Math.min(content.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), innerHeight - 40);
    const from = sizeAnimation ? element.getBoundingClientRect().height : lastHeight;
    sizeAnimation?.cancel();sizeAnimation = null;lastHeight = next;
    if (from === null || Math.abs(next-from)<1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    sizeAnimation = element.animate([{height:`${from}px`},{height:`${next}px`}],{duration:180,easing:'ease-out'});
    sizeAnimation.onfinish = () => { sizeAnimation = null; };
  }) : null;
  resizeObserver?.observe(content);
  let releaseScroll = null;
  element.addEventListener("close", () => { if (!element.open) {releaseScroll?.();releaseScroll = null;} });
  let trigger = null;
  let resolveTrigger = null;
  const close = (reason = "dismiss") => {
    if (!element.open) return;
    sizeAnimation?.cancel();sizeAnimation = null;lastHeight = null;
    entryAnimation?.cancel();entryAnimation = null;
    // Restore the page before measuring the return target; native dialog focus
    // may have changed the underlying document's programmatic scroll offset.
    releaseScroll?.();releaseScroll = null;
    const animationSource = trigger?.isConnected ? trigger : resolveTrigger?.();
    if (reason === 'dismiss') animateOverlayExit(element, animationSource);
    element.close();
    releaseScroll?.();releaseScroll = null;
    onClose(reason);
    const replacement = !trigger?.isConnected ? resolveTrigger?.() : null;
    const target = trigger?.isConnected ? trigger : replacement?.isConnected ? replacement : document.querySelector("main h1, main h2, .shell-header-title-link");
    if (target) { if (!target.matches("a, button, input, [tabindex]")) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  };
  let backdropPress = false;
  const outside = event => {const r=element.getBoundingClientRect();return event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom;};
  element.addEventListener('pointerdown',event=>{backdropPress=event.button===0 && event.target===element && outside(event);});
  element.addEventListener('pointercancel',()=>{backdropPress=false;});
  element.addEventListener("cancel", event => { event.preventDefault(); if(!blocking)close(); });
  element.addEventListener("click", event => { const dismiss=!blocking && backdropPress && event.target===element && outside(event);backdropPress=false;if (dismiss || event.target.closest("[data-modal-close]")) close(); });
  return { element, close, open(html, source = document.activeElement, findTrigger = null) { trigger = source; resolveTrigger = findTrigger; element.dataset.actionAffiliation = document.querySelector("#app")?.dataset.actionAffiliation || "red"; content.innerHTML = html; content.scrollTop = 0; controls.replaceChildren(); const closeControl = content.querySelector(".story-close"); if (closeControl) controls.append(closeControl); const view = document.defaultView; const position = {left:view.scrollX, top:view.scrollY, behavior:"instant"}; if (!element.open) {releaseScroll = lockOverlayScroll(document);element.showModal();} element.querySelector("[autofocus], button")?.focus({preventScroll:true}); content.scrollTop = 0; view.scrollTo(position); entryAnimation?.cancel(); entryAnimation = animateOverlayEntry(element, trigger); }, destroy() { close(); resizeObserver?.disconnect(); element.remove(); } };
};
