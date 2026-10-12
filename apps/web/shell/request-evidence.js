// Request evidence excludes bodies, query strings, credentials and raw headers.
const latest = new Map();
export const latestRequestEvidence = operation => structuredClone(latest.get(operation) ?? { requestId: "unavailable", serverBuild: "unavailable" });
export const withRequestEvidence = (fetcher, operation) => async (url, init = {}) => {
  const started = Date.now();
  const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...init.headers };
  const incoming = new Headers(headers).get("X-Righelt-Request-Id") ?? "";
  const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming) ? incoming : crypto.randomUUID();
  headers["X-Righelt-Request-Id"] = requestId;
  const record = { operation, requestId, stage: "request_started", deadlineMs: 5000, status: null, serverBuild: "unavailable" };
  if (operation !== "account" || /\/api\/(auth|account)(?:\/|$)/.test(String(url))) latest.set(operation, record);
  try {
    const response = await fetcher(url, { ...init, headers });
    Object.assign(record, { stage: "response_received", status: response.status, durationMs: Date.now() - started, serverBuild: response.headers?.get?.("X-Righelt-Server-Build") ?? "unavailable" });
    response.righeltDiagnosticEvidence = record;
    return response;
  } catch(error) { Object.assign(record, { stage: "request_failed", durationMs: Date.now() - started, code: error.code ?? "unavailable" }); if (error && typeof error === "object") error.diagnosticEvidence = record; throw error; }
};
