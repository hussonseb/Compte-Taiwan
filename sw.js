/* Service worker : met l'application en cache pour l'ouvrir hors connexion.
 * Seuls les fichiers de l'application sont mis en cache, jamais vos donnees
 * ni les echanges avec Google. Changer VERSION a chaque mise a jour. */
const VERSION = 'ct-v2';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/engine.js', 'js/patch.js', 'js/drive.js', 'js/app.js',
  'vendor/jszip.min.js', 'vendor/chart.umd.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // reseau d'abord (pour recevoir les mises a jour), cache si hors ligne
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
