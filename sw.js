const CACHE_NAME = "airhand-shell-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./android-guide.html",
  "./app.js?v=airhand-20261015-3d-1",
  "./car3d-engine.js",
  "./pwa.js?v=airhand-pwa-2",
  "./manifest.webmanifest",
  "./airhand-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("airhand-shell-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const is3DDependency = url.origin === "https://cdn.jsdelivr.net" &&
    (/\/@dimforge\/rapier3d-compat@|\/three@|\.wasm$|\/\+esm$/.test(url.pathname));
  if (url.origin !== self.location.origin && !is3DDependency) return;

  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin) return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(url.pathname.endsWith("/android-guide.html") ? "./android-guide.html" : "./index.html", response.clone()).catch(() => {});
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) ||
          (url.pathname.endsWith("/android-guide.html") ? await caches.match("./android-guide.html") : null) ||
          (await caches.match("./index.html")) ||
          new Response("AirHand is offline and its saved app shell is not available yet. Reconnect once and reload.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && (response.type === "basic" || (is3DDependency && response.type === "cors"))) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      return cached || new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
