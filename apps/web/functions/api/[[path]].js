const CACHE_NO_STORE = "no-store";
const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
const API_SERVICE_BINDING_ERROR = "server_misconfigured_api_service_binding";

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

const resolveLocalApiOrigin = (env) =>
  typeof env?.API_ORIGIN === "string" && env.API_ORIGIN.trim().length > 0 ? env.API_ORIGIN.trim() : LOCAL_API_ORIGIN;

const buildLocalUpstreamRequest = (request, env) => {
  const url = new URL(request.url);
  const upstream = new URL(`${url.pathname}${url.search}`, resolveLocalApiOrigin(env));
  return new Request(upstream.toString(), request);
};

export const onRequest = async (context) => {
  if (hasApiServiceBinding(context.env)) {
    return context.env.API_SERVICE.fetch(context.request);
  }

  const url = new URL(context.request.url);
  if (isLocalDevHostname(url.hostname) || typeof context.env?.API_ORIGIN === "string") {
    return fetch(buildLocalUpstreamRequest(context.request, context.env));
  }

  return json({ ok: false, error: API_SERVICE_BINDING_ERROR }, 500);
};
