const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

// Place beside an input inside .input-with-action. The host handles the named
// action, while the shared component owns non-submit semantics and appearance.
export const renderInputAction = ({ label, accessibleLabel = label, action, controls }) =>
  `<button type="button" class="input-action" data-input-action="${escape(action)}" aria-controls="${escape(controls)}" aria-label="${escape(accessibleLabel)}">${escape(label)}</button>`;
