import { OFFLINE_SHELL_ASSETS, OFFLINE_SHELL_CACHE, handleOfflineShellFetch, isOfflineShellRequest } from "./offline/bootstrap.js";

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
  if (!isOfflineShellRequest(event.request)) {
    return;
  }
  event.respondWith(
    handleOfflineShellFetch({
      request: event.request,
      cacheStorage: caches,
      fetcher: fetch,
      cacheName: OFFLINE_SHELL_CACHE,
    }),
  );
});
