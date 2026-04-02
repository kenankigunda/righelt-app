export const LOCAL_DEV_PORT_VARIANTS = Object.freeze([
  { suffix: "", webPort: 8788, apiPort: 8787 },
  { suffix: "a", webPort: 8789, apiPort: 8792 },
  { suffix: "b", webPort: 8790, apiPort: 8793 },
  { suffix: "c", webPort: 8791, apiPort: 8794 },
  { suffix: "e2e", webPort: 9888, apiPort: 9887 },
]);

const DEFAULT_LOCAL_DEV_VARIANT = LOCAL_DEV_PORT_VARIANTS[0];

const LOCAL_DEV_VARIANT_BY_WEB_PORT = new Map(
  LOCAL_DEV_PORT_VARIANTS.map((variant) => [String(variant.webPort), variant]),
);

const normalizePort = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
};

export const resolveLocalDevVariant = (webPort) => {
  const normalized = normalizePort(webPort);
  return LOCAL_DEV_VARIANT_BY_WEB_PORT.get(normalized) ?? DEFAULT_LOCAL_DEV_VARIANT;
};

export const resolveLocalApiPort = (webPort) => resolveLocalDevVariant(webPort).apiPort;

export const buildLocalApiOrigin = (webPort) => `http://127.0.0.1:${resolveLocalApiPort(webPort)}`;

export const buildLocalApiWsHost = (webPort) => `127.0.0.1:${resolveLocalApiPort(webPort)}`;

export const buildLocalApiPersistPath = (webPort) => {
  const variant = resolveLocalDevVariant(webPort);
  return variant.suffix ? `.wrangler/state/api-local-dev-${variant.suffix}` : ".wrangler/state/api-local-dev";
};

export const isLocalDevHost = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
