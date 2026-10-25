import { CACHE_NO_STORE } from "../../generated/packages/shared-types/src/http.js";
import { buildLocalApiOrigin, isLocalDevHost } from "../../local-dev-ports.js";
import { localApiFailure } from "../../local-api-diagnostics.js";
const API_SERVICE_BINDING_ERROR = "server_misconfigured_api_service_binding";
const LOCAL_API_UNAVAILABLE_ERROR = "local_api_unavailable";

const json = (body, status = 200, cacheControl = CACHE_NO_STORE) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });

const hasApiServiceBinding = (env) => Boolean(env?.API_SERVICE && typeof env.API_SERVICE.fetch === "function");

const isLocalDevRequest = (request) => {
  const url = new URL(request.url);
  return isLocalDevHost(url.hostname);
};

const buildLocalUpstreamRequest = (request) => {
  const url = new URL(request.url);
  const upstream = new URL(`${url.pathname}${url.search}`, buildLocalApiOrigin(url.port));
  return new Request(upstream.toString(), request);
};

const canRepeatProjectionRead = (request, error) => {
  const url = new URL(request.url);
  try {
    return request.method === "GET" && request.body === null && !request.signal.aborted
      && /^\/api\/shell\/games\/[^/]+$/.test(url.pathname)
      && [...url.searchParams.keys()].every(key => key === "identityId")
      && !request.headers.has("Upgrade")
      && !request.headers.get("Connection")?.split(",").some(value => value.trim().toLowerCase() === "upgrade")
      && error?.name === "Error" && error?.message === "Network connection lost.";
  } catch { return false; }
};

const repeatedReadResponse = (response) => {
  const headers = new Headers(response.headers);
  headers.set("X-Righelt-Local-Forward-Attempts", "2");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const forwardRequest = async (context) => {
  if (isLocalDevRequest(context.request)) {
    let stage = 'request';
    let repeated = false;
    const recovery = outcome => console.info('[local-api-forwarding-recovery]', JSON.stringify({
      requestId: context.request.headers.get("X-Righelt-Request-Id"), attempts: 2, outcome,
    }));
    try {
      const upstream = buildLocalUpstreamRequest(context.request);
      stage = 'fetch';
      if (context.request.signal.aborted) throw context.request.signal.reason;
      try { return await fetch(upstream); }
      catch (error) {
        if (!canRepeatProjectionRead(context.request, error)) throw error;
        // Keep the original failure visible. Only this local, bodyless projection
        // read can repeat, with the same identity, correlation and abort signal.
        console.error('[local-api-forwarding-failure]', JSON.stringify(localApiFailure(error, context.request, stage)));
        const next = buildLocalUpstreamRequest(context.request);
        if (context.request.signal.aborted) throw context.request.signal.reason;
        repeated = true;
        const response = await fetch(next);
        recovery(response.ok ? 'recovered' : 'upstream_response');
        return repeatedReadResponse(response);
      }
    } catch (error) {
      console.error('[local-api-forwarding-failure]', JSON.stringify(localApiFailure(error, context.request, stage)));
      const response = json({ ok: false, error: LOCAL_API_UNAVAILABLE_ERROR }, 503);
      if (repeated) { recovery('failed'); return repeatedReadResponse(response); }
      return response;
    }
  }

  if (hasApiServiceBinding(context.env)) {
    return context.env.API_SERVICE.fetch(context.request);
  }

  return json({ ok: false, error: API_SERVICE_BINDING_ERROR }, 500);
};

// Preserve attempt correlation even when the proxy cannot reach the API.
export const onRequest = async context => {
  const incoming = context.request.headers.get("X-Righelt-Request-Id") ?? "";
  const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(context.request.headers); headers.set("X-Righelt-Request-Id", requestId);
  let response;
  try { response = await forwardRequest({ ...context, request: new Request(context.request, { headers }) }); }
  catch { response = json({ ok: false, error: "upstream_unavailable" }, 503); }
  if (response.status === 101) return response;
  const responseHeaders = new Headers(response.headers); responseHeaders.set("X-Righelt-Request-Id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
};
