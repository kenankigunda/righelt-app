// Native modal dialogs provide background inertness and the browser focus trap.
export const createModal = ({ document = globalThis.document, labelId, className = "", onClose = () => {} }) => {
  const element = document.createElement("dialog");
  element.className = `story-modal ${className}`;
  element.setAttribute("aria-labelledby", labelId);
  document.body.append(element);
  let trigger = null;
  const close = (reason = "dismiss") => {
    if (!element.open) return;
    element.close();
    onClose(reason);
    const target = trigger?.isConnected ? trigger : document.querySelector("main h1, main h2, .shell-header-title-link");
    if (target) { if (!target.matches("a, button, input, [tabindex]")) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  };
  element.addEventListener("cancel", event => { event.preventDefault(); close(); });
  element.addEventListener("click", event => { if (event.target.closest("[data-modal-close]")) close(); });
  return { element, close, open(html, source = document.activeElement) { trigger = source; element.innerHTML = html; if (!element.open) element.showModal(); element.querySelector("[autofocus], button")?.focus(); }, destroy() { close(); element.remove(); } };
};
