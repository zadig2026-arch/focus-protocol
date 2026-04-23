/* =========================================================
   Focus Protocol — service-worker.js
   Cache-first pour le shell, network-first pour suggestions.json
   et l'API Claude/GitHub (réseau frais quand possible).
   ========================================================= */

const VERSION = 'fp-v1.2-lotD';
const SHELL_CACHE = `${VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './storage.js',
  './expert.js',
  './api.js',
  './manifest.json',
  './vapid-public.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/* Install — précache du shell */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

/* Activate — nettoyage des anciens caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch — stratégies différenciées */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne jamais cacher les POST (API Claude)
  if (request.method !== 'GET') return;

  // API Anthropic + GitHub API → network-only, pas de cache
  if (url.hostname === 'api.anthropic.com' || url.hostname === 'api.github.com') {
    return;
  }

  // suggestions.json local → network-first, fallback cache
  if (url.pathname.endsWith('/suggestions.json')) {
    event.respondWith(
      fetch(request).then(res => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Fonts Google → cache-first après fetch initial
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // Shell (même origine) → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'))) // SPA fallback
    );
  }
});

/* =========================================================
   Web Push — affichage de notifications envoyées par le scanner
   Payload JSON attendu : { title, body, url?, tag? }
   ========================================================= */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'Focus Protocol';
  const body = data.body || '';
  const tag = data.tag || 'focus-push';
  const url = data.url || './';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) self.clients.openWindow(target);
    })
  );
});
