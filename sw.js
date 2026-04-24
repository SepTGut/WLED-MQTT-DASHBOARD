const CACHE_NAME = 'mqttctrl-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/themes.css',
  '/css/app.css',
  '/js/core-utils.js',
  '/js/mqtt.js',
  '/js/relays.js',
  '/js/wled.js',
  '/js/sensors.js',
  '/js/app.js',
  '/manifest.json',
  'https://unpkg.com/mqtt/dist/mqtt.min.js'
];

// Install: cache everything
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

// Fetch: cache-first for local assets, network-first for MQTT
self.addEventListener('fetch', event => {
  // Let MQTT WebSocket connections pass through (the browser handles them natively)
  if (event.request.url.startsWith('ws') || event.request.url.startsWith('wss')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cached); // offline fallback
      return cached || fetchPromise;
    })
  );
});