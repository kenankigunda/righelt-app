export const OFFLINE_SHELL_CACHE = "righelt-offline-shell-v1";

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
