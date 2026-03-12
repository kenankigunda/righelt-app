const CACHE_NO_STORE = "no-store";
const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
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

const isLocalDevHostname = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
const isLocalDevRequest = (request, env) => {
  const url = new URL(request.url);
  return isLocalDevHostname(url.hostname) || typeof env?.API_ORIGIN === "string";
};

const resolveLocalApiOrigin = (env) =>
  typeof env?.API_ORIGIN === "string" && env.API_ORIGIN.trim().length > 0 ? env.API_ORIGIN.trim() : LOCAL_API_ORIGIN;

const isMissingLocalServiceSessionMessage = (text) =>
  typeof text === "string" && text.includes(`Couldn't find a local dev session for the "default" entrypoint of service "righelt-api"`);

const buildLocalUpstreamRequest = (request, env) => {
  const url = new URL(request.url);
  const upstream = new URL(`${url.pathname}${url.search}`, resolveLocalApiOrigin(env));
  return new Request(upstream.toString(), request);
};

export const onRequest = async (context) => {
  if (isLocalDevRequest(context.request, context.env)) {
    try {
      return await fetch(buildLocalUpstreamRequest(context.request, context.env));
    } catch {
      return json({ ok: false, error: LOCAL_API_UNAVAILABLE_ERROR }, 503);
    }
  }

  if (hasApiServiceBinding(context.env)) {
    const response = await context.env.API_SERVICE.fetch(context.request);
    if (response.status >= 500) {
      const responseText = await response.clone().text();
      if (isMissingLocalServiceSessionMessage(responseText)) {
        return json({ ok: false, error: API_SERVICE_BINDING_ERROR }, 500);
      }
    }
    return response;
  }

  return json({ ok: false, error: API_SERVICE_BINDING_ERROR }, 500);
};
