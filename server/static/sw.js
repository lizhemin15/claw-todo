const CACHE_NAME = 'claw-todo-v85';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/favicon.svg'
];

// Workout images and audio are small enough to cache on first use
const WORKOUT_CACHE = 'claw-todo-workout-v61';

// Install - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== WORKOUT_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // API requests - try network, queue on failure
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 503
        });
      })
    );
    return;
  }
  
  // Static assets - network first, fallback to cache
  if (event.request.method !== 'GET') return;
  
  // Skip range requests
  if (event.request.headers.has('range')) return;
  
  // Workout images (webp) and audio (mp3) - cache first for speed, update in background
  if (/\/(workout_guide|workout_covers|meditate)\//i.test(url.pathname) && /\.(webp|mp3)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(WORKOUT_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          // Return cached immediately if available
          if (cached) {
            // Background update
            fetch(event.request).then(resp => {
              if (resp.status === 200) cache.put(event.request, resp);
            }).catch(() => {});
            return cached;
          }
          // No cache - fetch and cache
          return fetch(event.request).then(resp => {
            if (resp.status === 200) {
              const clone = resp.clone();
              cache.put(event.request, clone);
            }
            return resp;
          });
        })
      )
    );
    return;
  }
  
  // Other binary files (fonts, etc) - skip caching
  if (/\.(woff2?|ttf|eot)$/i.test(url.pathname)) return;
  
  // Other images (non-workout) - skip caching
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(url.pathname)) return;
  
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
      }
      return response;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
