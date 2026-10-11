// Local, explicitly allowlisted evidence. Never store whole requests or game models.
export const DIAGNOSTIC_LIMITS = Object.freeze({ ageMs: 86400000, events: 200, reports: 20, bytes: 1048576 });
const KEY = "righelt.issues.v1";
const fields = new Set("gameId gameLink mode browser clientBuild serverBuild deploymentVersion commandId fingerprint requestId status durationMs elapsedMs socketGeneration deadlineMs stage retry generation recoveryEpisodeId closeCode closeClean online visibility pendingCount appliedEventSeq advertisedEventSeq gameplayRevision operation code receipt authoritativeState tentativeState action continuation timezone".split(" "));
const safe = (value, depth = 0) => {
  if (depth > 12) return "[truncated]";
  if (value === undefined) return "[unavailable]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 2048);
  if (Array.isArray(value)) return [...value.slice(0, 200).map(v => safe(v, depth + 1)), ...(value.length > 200 ? ["[truncated]"] : [])];
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => /^(clientCommandId|fingerprint|eventSeq|gameplayRevision|gameId|id|type|side|owner|x|y|position|row|col|kind|coordinate|square|from|to|phase|attacker|defender|pushed|pusher|pieceId|retreatSquares|followSquare|pieces|sideToMove|turnIndex|continuation|supplied|commanded|displaySupplied|displayCommanded|shifted|attackerOwner|followPoint|pushedPieceId|followGroupPieceIds|rushedPieceIds|rushChainPieceIds|frozenOwner|frozenPieceStatesById|chainLength|actorId|targetId|outcome|status|reason|boardSize|moveCount|consecutivePasses|turnActions)$/.test(k)).map(([k,v]) => [k, k === "frozenPieceStatesById" ? Object.fromEntries(Object.entries(v ?? {}).slice(0,200).map(([id,state]) => [id.slice(0,128), safe(state, depth + 1)])) : safe(v, depth + 1)]));
  return "[unavailable]";
};
export const sanitizeDiagnostic = data => Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => fields.has(k)).map(([k,v]) => [k, typeof v === "object" ? safe(v) : safe(v)]));
const diagnosticEnvironment = () => {
  const read = getter => { try { return getter() ?? "unavailable"; } catch { return "unavailable"; } };
  return {
    browser: read(() => globalThis.navigator?.userAgent),
    clientBuild: read(() => globalThis.__righeltClientBuild),
    timezone: read(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    online: read(() => globalThis.navigator?.onLine),
    visibility: read(() => globalThis.document?.visibilityState),
  };
};
export function createIssueDiagnostics({ storage, now = Date.now, schedule = setTimeout, environment = diagnosticEnvironment } = {}) {
  let reports = [], timer;
  try { const parsed = JSON.parse(storage?.getItem(KEY) ?? "[]"); if (Array.isArray(parsed)) reports = parsed.filter(r => r?.schemaVersion === 1 && typeof r.id === "string" && Number.isFinite(r.startedAt)).map(r => ({ schemaVersion: 1, id: r.id, key: String(r.key).slice(0,256), startedAt: r.startedAt, resolvedAt: Number.isFinite(r.resolvedAt) ? r.resolvedAt : null, initial: sanitizeDiagnostic(r.initial), truncated: r.truncated === true, events: (r.events ?? []).slice(-200).map(e => ({ at: e.at, ...sanitizeDiagnostic(e) })) })); } catch {}
  const trim = () => {
    reports = reports.filter(r => now() - r.startedAt < DIAGNOSTIC_LIMITS.ageMs).slice(-DIAGNOSTIC_LIMITS.reports);
    let excess = reports.reduce((sum, report) => sum + report.events.length, 0) - DIAGNOSTIC_LIMITS.events;
    for (const report of reports) while (excess > 0 && report.events.length) { report.events.shift(); report.truncated = true; excess--; }
    while (reports.length && new TextEncoder().encode(JSON.stringify(reports)).length > DIAGNOSTIC_LIMITS.bytes) {
      const oldestWithEvents = reports.find(report => report.events.length);
      if (oldestWithEvents) { oldestWithEvents.events.shift(); oldestWithEvents.truncated = true; }
      else reports.shift();
    }
  };
  const persist = () => { trim(); if (!timer) timer = schedule(() => { timer = null; try { storage?.setItem(KEY, JSON.stringify(reports)); } catch {} }, 100); };
  const api = {
    capture(key, data = {}) {
      let context; try { context = environment(); } catch { context = { browser: "unavailable", clientBuild: "unavailable", timezone: "unavailable", online: "unavailable", visibility: "unavailable" }; }
      data = { ...context, ...data };
      trim(); let report = reports.find(r => r.key === key && !r.resolvedAt);
      if (!report) { report = { schemaVersion: 1, id: crypto.randomUUID(), key, startedAt: now(), initial: sanitizeDiagnostic(data), events: [] }; reports.push(report); }
      report.events.push({ at: now(), ...sanitizeDiagnostic(data) }); if (report.events.length > DIAGNOSTIC_LIMITS.events) { report.events = report.events.slice(-DIAGNOSTIC_LIMITS.events); report.truncated = true; } persist(); return report.id;
    },
    resolve(key) { for (const r of reports) if (r.key === key && !r.resolvedAt) r.resolvedAt = now(); persist(); },
    list() { trim(); return structuredClone(reports); },
    get(id) { trim(); return structuredClone(reports.find(r => r.id === id) ?? null); },
    clear() { reports = []; try { storage?.removeItem(KEY); } catch {} },
    text(id) { const r = api.get(id); if (!r) return "Details unavailable"; return `${r.resolvedAt ? "Resolved issue" : "Issue"}: ${r.initial.operation ?? "recovery"}\nIncident: ${r.id}\nTime: ${new Date(r.startedAt).toISOString()}\nGame: ${r.initial.gameLink ?? r.initial.gameId ?? "unavailable"}\nStage: ${r.initial.stage ?? "unavailable"}\n\n${JSON.stringify(r, null, 2)}`; }
  }; trim(); return api;
}
let localStorage; try { if (typeof window !== "undefined") localStorage = window.localStorage; } catch {}
export const issueDiagnostics = createIssueDiagnostics({ storage: localStorage });
