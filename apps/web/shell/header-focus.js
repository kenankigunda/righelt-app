// Rendering live data must not take keyboard focus away from persistent chrome.
export const captureHeaderFocus = (header, activeElement) => {
  if (!activeElement || !header?.contains(activeElement)) return null;
  // Alert controls can share an action but represent different operations.
  if (activeElement.closest?.("[data-shell-alert-zone]")) return null;
  for (const attribute of ["data-flyout-link", "data-action"]) {
    const value = activeElement.getAttribute(attribute);
    if (value) return { element: activeElement, attribute, value };
  }
  return null;
};

export const restoreHeaderFocus = (header, saved, documentObject) => {
  if (!saved || saved.element.isConnected || !header) return;
  // Never override focus deliberately moved by another handler.
  if (documentObject.activeElement && documentObject.activeElement !== documentObject.body) return;
  const replacement = [...header.querySelectorAll(`[${saved.attribute}]`)]
    .find((element) => element.getAttribute(saved.attribute) === saved.value);
  if (!replacement || replacement.disabled || replacement.getAttribute("tabindex") === "-1" ||
      replacement.closest('[aria-hidden="true"], [inert]')) return;
  replacement.focus({ preventScroll: true });
};
