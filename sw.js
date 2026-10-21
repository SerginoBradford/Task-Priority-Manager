// Service worker : permet d'ouvrir l'appli sans connexion.
// Pense à changer VERSION après chaque mise à jour des fichiers.
const VERSION = 'v1';
const CACHE = 'mes-priorites-' + VERSION;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './vendor/supabase.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mes-priorites-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Les échanges avec Supabase passent toujours par le réseau
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  // Polices Google : cache d'abord
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Fichiers de l'appli : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
    );
  }
});
