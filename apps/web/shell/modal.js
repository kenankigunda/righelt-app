// Native modal dialogs provide background inertness and the browser focus trap.
export const createModal = ({ document = globalThis.document, labelId, className = "", onClose = () => {} }) => {
  const element = document.createElement("dialog");
  element.className = `story-modal ${className}`;
  element.setAttribute("aria-labelledby", labelId);
  document.body.append(element);
  let sizeAnimation = null;
  let lastHeight = null;
  const content = document.createElement("div");
  content.className = "modal-content";
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
  let trigger = null;
  let resolveTrigger = null;
  const close = (reason = "dismiss") => {
    if (!element.open) return;
    sizeAnimation?.cancel();sizeAnimation = null;lastHeight = null;
    element.close();
    onClose(reason);
    const replacement = !trigger?.isConnected ? resolveTrigger?.() : null;
    const target = trigger?.isConnected ? trigger : replacement?.isConnected ? replacement : document.querySelector("main h1, main h2, .shell-header-title-link");
    if (target) { if (!target.matches("a, button, input, [tabindex]")) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  };
  element.addEventListener("cancel", event => { event.preventDefault(); close(); });
  element.addEventListener("click", event => { if (event.target.closest("[data-modal-close]")) close(); });
  return { element, close, open(html, source = document.activeElement, findTrigger = null) { trigger = source; resolveTrigger = findTrigger; element.dataset.actionAffiliation = document.querySelector("#app")?.dataset.actionAffiliation || "red"; content.innerHTML = html; if (!element.open) element.showModal(); element.querySelector("[autofocus], button")?.focus(); }, destroy() { close(); resizeObserver?.disconnect(); element.remove(); } };
};
