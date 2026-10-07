const BUILD_SHA = '304cb2d6e3338d7b64723db2ad1664ddfb48d6a0'
const CACHE_PREFIX = 'pos101-static-'
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_SHA}`

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE_NAME))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    const cached = await caches.match(request)
    try {
      const response = await fetch(request)
      if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'document' || request.destination === 'image')) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    } catch { return cached || Response.error() }
  })())
})
