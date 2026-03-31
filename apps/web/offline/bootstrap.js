export const OFFLINE_SHELL_CACHE = "righelt-offline-shell-v2";

export const OFFLINE_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/main.js",
  "/shell/shell.css",
  "/shell/app.js",
  "/shell/bootstrap.js",
  "/shell/live-sync.js",
  "/shell/live-transport.js",
  "/shell/optimistic-live.js",
  "/shell/persistence.js",
  "/shell/routes.js",
  "/shell/runtime-sync.js",
  "/shell/scenarios.js",
  "/shell/tutorial.js",
  "/board/client-move-generation.js",
  "/board/mini-board-preview.js",
  "/board/runtime/board-runtime.js",
  "/board/hosts/shell-host.js",
  "/board-adapters/engine-playground-adapter.js",
  "/hover-capability.js",
  "/interaction.js",
  "/legend.js",
  "/generated/packages/game-engine/src/index.js",
  "/generated/packages/game-engine/src/apply.js",
  "/generated/packages/game-engine/src/deterministic.js",
  "/generated/packages/game-engine/src/fixtures.js",
  "/generated/packages/game-engine/src/hash.js",
  "/generated/packages/game-engine/src/legal.js",
  "/generated/packages/game-engine/src/replay.js",
  "/generated/packages/game-engine/src/resolve.js",
  "/generated/packages/game-engine/src/serialize.js",
  "/generated/packages/game-engine/src/state.js",
  "/generated/packages/game-engine/src/types.js",
  "/generated/packages/shared-types/src/engine.js",
];

export const isOfflineShellRequest = (request) => {
  if (!(request instanceof Request)) {
    return false;
  }
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return false;
  }
  return OFFLINE_SHELL_ASSETS.includes(url.pathname) || request.mode === "navigate";
};

export const handleOfflineShellFetch = async ({
  request,
  cacheStorage,
  fetcher = fetch,
  cacheName = OFFLINE_SHELL_CACHE,
}) => {
  const cache = await cacheStorage.open(cacheName);
  try {
    const networkResponse = await fetcher(request);
    if (networkResponse?.ok) {
      await cache.put(request, networkResponse.clone());
      if (request.mode === "navigate") {
        const cachedIndex = await cache.match("/index.html");
        if (!cachedIndex) {
          await cache.put("/index.html", networkResponse.clone());
        }
      }
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const fallback = await cache.match("/index.html");
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
};

export const registerOfflineShellServiceWorker = async (
  navigatorLike = globalThis.navigator,
  locationLike = globalThis.location,
) => {
  if (!navigatorLike?.serviceWorker?.register) {
    return { ok: false, reason: "unsupported" };
  }
  const scriptUrl = new URL("./offline-sw.js", locationLike?.href ?? "https://example.test/").pathname;
  const registration = await navigatorLike.serviceWorker.register(scriptUrl, { scope: "/", type: "module" });
  return { ok: true, registration };
};
