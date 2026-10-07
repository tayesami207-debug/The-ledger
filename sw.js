// The Ledger — offline service worker for the installed web app (PWA).
//
// Hand-written on purpose: it is ~90 lines and needs no build step, no workbox and
// no dependencies, which keeps it in keeping with the rest of this project. It is
// copied verbatim to the build output by Vite (everything in public/ is).
//
// Every path here is RELATIVE. A service worker resolves them against its own
// script URL, so one file works at a host's root (https://host/) and equally in a
// sub-folder (https://user.github.io/the-ledger/) without a rebuild.
//
// What it does
//   * caches the app shell (the HTML, the manifest and the icons) so the journal
//     opens with no connection at all;
//   * serves navigations network-first, so a new deployment is picked up the next
//     time the phone is online, and falls back to the cached shell offline;
//   * serves the hashed build assets (JS/CSS, which have a new name every build)
//     cache-first, since an unchanged URL can never mean different bytes.
//
// What it deliberately does NOT do
//   * it never touches /api/ — those requests must always hit the network. On the
//     installed web app there is no local server to answer them anyway (that is
//     what src/platform.js detects), and caching an API response would be wrong on
//     the desktop app, where /api/ is the live Telegram and MT5 route.
//   * it never caches anything cross-origin (Telegram, the AI providers), so those
//     calls are unaffected.
//
// Bump CACHE when the shell changes in a way that must invalidate old copies; the
// old caches are deleted on activation.

const CACHE = 'the-ledger-shell-v1';
const SHELL_ENTRY = './index.html';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './pwa-192.png',
  './pwa-512.png',
  './pwa-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // allSettled, not addAll: one missing optional file must not fail the install.
      await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

/** Fresh when online, the cached shell when not. */
async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(SHELL_ENTRY, response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) || (await cache.match(SHELL_ENTRY));
    return cached || Response.error();
  }
}

/** Cached bytes when we have them, the network when we do not. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The app's own API (desktop / dev server only). Never cached, never offline.
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
