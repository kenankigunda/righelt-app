import { buildLocalApiOrigin, isLocalDevHost } from "../../local-dev-ports.js";

const CACHE_NO_STORE = "no-store";
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
  const upstream = new URL(`${url.pathname}${url.search}`, buildLocalApiOrigin(url.port, url.hostname));
  return new Request(upstream.toString(), request);
};

export const onRequest = async (context) => {
  if (isLocalDevRequest(context.request)) {
    try {
      return await fetch(buildLocalUpstreamRequest(context.request));
    } catch {
      return json({ ok: false, error: LOCAL_API_UNAVAILABLE_ERROR }, 503);
    }
  }

  if (hasApiServiceBinding(context.env)) {
    return context.env.API_SERVICE.fetch(context.request);
  }

  return json({ ok: false, error: API_SERVICE_BINDING_ERROR }, 500);
};
