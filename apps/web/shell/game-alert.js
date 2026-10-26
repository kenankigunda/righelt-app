import { normalizeActivitySide } from './activity-affiliation.js';
import { renderDiagnosticDisclosure } from "./diagnostic-disclosure.js";

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Body and actions are trusted markup prepared by the game alert owner.
export const renderGameAlertCard = ({ tone = "", body = "", action = "", testId = "", incidentId = null, activity = "static", actorSide = null } = {}) => {
  const actor=normalizeActivitySide(actorSide);
  const actorAttribute=actor ? ` data-activity-side="${actor}"` : "";
  const toneClass = tone ? ` ${escape(tone)}` : "";
  const testIdAttr = testId ? ` data-testid="${escape(testId)}"` : "";
  return `<div class="alert${toneClass} shell-game-alert${tone === "danger" ? " sync-failure-banner" : ""}"${testIdAttr}${actorAttribute} data-notification-activity="${["processing", "waiting"].includes(activity) && tone !== "danger" ? activity : "static"}">
    <div class="shell-game-alert-copy${tone === "danger" ? " sync-failure-copy" : ""}">${body}</div>
    ${action ? `<div class="shell-game-alert-actions">${action}</div>` : ""}
    ${renderDiagnosticDisclosure(incidentId)}
  </div>`;
};
