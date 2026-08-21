// Service Worker — ImpactoTV Mídia (PWA)
// Cache-first para assets estáticos, network-first para navegação HTML.

const CACHE_NAME = "impactotv-cache-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./comprobante.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./LaVisualMk_Logo.jpeg",
  "./impacto3d_logo_v3.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Navegação (HTML): tenta rede primeiro, cai para cache se offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          const fallback = request.url.includes("comprobante.html") ? "./comprobante.html" : "./index.html";
          return caches.match(request).then((r) => r || caches.match(fallback));
        })
    );
    return;
  }

  // Demais assets: cache-first, atualizando em segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});