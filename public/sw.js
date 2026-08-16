const CACHE = 'dance-workbench-v6'
const APP_BASE = new URL('./', self.registration.scope).pathname
const MUSIC_ASSETS = [
  'assets/music/countdown-5s.mp3?v=3',
  'assets/music/dreams-come-true.m4a',
  'assets/music/moonlight-sunrise.m4a',
  'assets/music/style.m4a',
  'assets/music/thirsty.m4a',
  'assets/music/what-is-love.m4a',
  'assets/music/whiplash.m4a',
  'assets/music/yes-or-yes.m4a',
].map((path) => `${APP_BASE}${path}`)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.add(APP_BASE)
    await Promise.allSettled(MUSIC_ASSETS.map((asset) => cache.add(asset)))
  }))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})

async function rangeResponse(request) {
  const cached = await caches.match(request.url)
  if (!cached) return fetch(request)
  const match = /bytes=(\d+)-(\d*)/.exec(request.headers.get('range') || '')
  if (!match) return cached
  const bytes = await cached.arrayBuffer()
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1
  if (start >= bytes.byteLength || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } })
  }
  const headers = new Headers(cached.headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`)
  headers.set('Content-Length', String(end - start + 1))
  return new Response(bytes.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers })
}

self.addEventListener('fetch', (event) => {
  // Mutating/API requests must never enter CacheStorage. In particular, the
  // cross-origin Agent POST needs to reach CloudBase unchanged in Chrome/iOS.
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request))
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(event.request, copy))
      return response
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(APP_BASE))))
    return
  }
  if (event.request.headers.has('range')) {
    event.respondWith(rangeResponse(event.request))
    return
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (event.request.method === 'GET' && response.ok && new URL(event.request.url).origin === self.location.origin) {
      caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
    }
    return response
  })))
})
