/* 掌房 Service Worker — 静态资源缓存 + API 网络优先 */
const CACHE_NAME = 'zhangfang-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html'
];

/* 安装：缓存壳资源 */
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_ASSETS);
    }).catch(function(err) {
      console.warn('[SW] install cache failed:', err);
    })
  );
});

/* 激活：清理旧缓存 */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) {
          return caches.delete(k);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* 抓取策略 */
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  /* 只处理同源 GET */
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  /* API 网络优先 */
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  /* index.html 网络优先（保证发版即时生效） */
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(req));
    return;
  }

  /* sw.js 自身不缓存（server 已设 no-store） */
  if (url.pathname === '/sw.js') {
    return;
  }

  /* 其余静态资源：缓存优先 */
  event.respondWith(cacheFirst(req));
});

/* 缓存优先：先读 Cache，失败再网络，并把新响应写入 Cache */
function cacheFirst(req) {
  return caches.match(req).then(function(res) {
    if (res) return res;
    return fetch(req).then(function(networkRes) {
      if (!networkRes || networkRes.status !== 200 || networkRes.type !== 'basic') {
        return networkRes;
      }
      var clone = networkRes.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(req, clone);
      });
      return networkRes;
    });
  }).catch(function() {
    /* 完全离线且缓存也没有：对页面返回空壳，让 JS 处理 */
    if (req.destination === 'document') {
      return caches.match('/index.html');
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  });
}

/* 网络优先：先网络，失败再缓存 */
function networkFirst(req) {
  return fetch(req).then(function(networkRes) {
    if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
      var clone = networkRes.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(req, clone);
      });
    }
    return networkRes;
  }).catch(function() {
    return caches.match(req).then(function(res) {
      return res || new Response('', { status: 503, statusText: 'Offline' });
    });
  });
}
