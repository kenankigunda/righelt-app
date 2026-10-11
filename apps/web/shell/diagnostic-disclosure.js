import { issueDiagnostics } from "./issue-diagnostics.js";
const open = new Set(), fallback = new Set();
const escape = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const closeDiagnostic = id => open.delete(id);
export const isDiagnosticOpen = id => open.has(id);
export const renderDiagnosticDisclosure = id => {
  if (!id) return ""; const expanded = open.has(id);
  const report = issueDiagnostics.get(id);
  const summary = [report?.resolvedAt ? "Resolved" : "", report?.initial.operation?.replaceAll("_", " ") ?? "Issue", report?.initial.stage?.replaceAll("_", " ") ?? "Details unavailable"].filter(Boolean).join(" · ");
  return `<div class="issue-diagnostic" data-incident-id="${escape(id)}"><button class="issue-caret" data-action="toggle-diagnostic" data-incident-id="${escape(id)}" aria-label="Diagnostic details" aria-expanded="${expanded}" aria-controls="issue-${escape(id)}">${expanded ? "⌄" : "›"}</button>${expanded ? `<div id="issue-${escape(id)}" class="issue-details"><p>${escape(summary)}</p>${issueDiagnostics.get(id)?.resolvedAt ? `<button class="secondary mini-button" data-action="dismiss-diagnostic" data-incident-id="${escape(id)}">Dismiss</button>` : ""}<button class="secondary mini-button" data-action="copy-diagnostic" data-incident-id="${escape(id)}">Copy</button>${fallback.has(id) ? '<p>Copy the details below</p>' : ""}<pre tabindex="0">${escape(issueDiagnostics.text(id))}</pre></div>` : ""}</div>`;
};
export async function handleDiagnosticAction(target) {
  const action = target?.dataset?.action, id = target?.dataset?.incidentId;
  if (action === "dismiss-diagnostic") { open.delete(id); fallback.delete(id); return true; }
  if (action === "toggle-diagnostic") { if (open.has(id)) open.delete(id); else open.add(id); return true; }
  if (action === "copy-diagnostic") { try { await navigator.clipboard.writeText(issueDiagnostics.text(id)); } catch { fallback.add(id); } return true; }
  return false;
}
