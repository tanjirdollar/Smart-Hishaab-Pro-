/**
 * Smart Hisab Pro - Service Worker
 * Cache-first for app shell assets, Network-first for Google Apps Script endpoints
 */

const CACHE_NAME = 'smart-hisab-v1.0';
const RUNTIME_API_CACHE = 'smart-hisab-api-v1.0';

// Core assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline app shell');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache non-fatal error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== RUNTIME_API_CACHE) {
            console.log('[SW] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event Strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Google Apps Script Web App Endpoint -> Network-First
  const isGoogleAppsScript = url.hostname.includes('script.google.com') || url.pathname.includes('/exec');
  
  if (isGoogleAppsScript) {
    event.respondWith(
      fetch(event.request.clone())
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(RUNTIME_API_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback from runtime cache
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline simulated response if nothing cached
            return new Response(JSON.stringify({
              status: 'offline',
              message: 'অফলাইন মোড সক্রিয় - লোকাল ডাটা ব্যবহৃত হচ্ছে',
              offline: true
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // 2. Google Fonts & CDN Libraries -> Stale While Revalidate
  if (url.origin.includes('fonts.googleapis.com') || 
      url.origin.includes('fonts.gstatic.com') || 
      url.origin.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              cache.put(event.request, networkRes.clone());
            }
            return networkRes;
          }).catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // 3. App Shell & Local Assets -> Cache-First with Network Fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Fetch in background to update cache for next time
        fetch(event.request).then((fresh) => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh));
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // If requesting an HTML page, return root cached index.html
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html') || caches.match('/');
        }
      });
    })
  );
});
