/*
 * Mode hors ligne : la coque de l'application (page, scripts, styles, polices, icônes) reste disponible sans
 * réseau. Les données de jeu ne sont jamais mises en cache : l'API, les connexions temps réel et toute requête
 * autre que GET passent toujours par le réseau. Sans connexion, une partie reste impossible ; l'application
 * s'ouvre et explique pourquoi.
 *
 * __SW_VERSION__ est remplacé à chaque build (voir vite.config.ts) : un nouveau build installe un nouveau
 * service worker, qui purge les caches de la version précédente.
 */

const CACHE_PREFIX = 'partyhub-shell-';
const CACHE = CACHE_PREFIX + '__SW_VERSION__';
const SHELL_PATHS = ['/', '/manifest.webmanifest', '/icons/icon.svg'];
const STATIC_PREFIXES = ['/assets/', '/fonts/', '/icons/'];
const NEVER_CACHED_PREFIXES = ['/api', '/socket.io'];
const OFFLINE_MESSAGE = 'PartyHub a besoin de la connexion pour afficher cette page.';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_PATHS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (SHELL_PATHS.includes(url.pathname) || STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/** La page d'accueil vient du réseau quand il répond (pour charger la dernière version), sinon du cache. */
async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/');
    if (cached) return cached;
    return new Response(OFFLINE_MESSAGE, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Fichiers statiques : la copie du cache sert tout de suite, et le réseau la rafraîchit en arrière-plan. */
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then((response) => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  });
  event.waitUntil(refresh.catch(() => undefined));
  return cached || refresh;
}
