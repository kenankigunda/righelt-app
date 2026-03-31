import { OFFLINE_SHELL_ASSETS, OFFLINE_SHELL_CACHE } from "./offline/bootstrap.js";

const isShellAssetRequest = (request) => {
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_SHELL_CACHE).then((cache) => cache.addAll(OFFLINE_SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isShellAssetRequest(event.request)) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      if (event.request.mode === "navigate") {
        return caches.match("/index.html");
      }
      return fetch(event.request);
    }),
  );
});
