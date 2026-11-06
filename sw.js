'use strict';

const CACHE = 'calendar-puzzle-v10';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/pieces.js',
  './src/solver.js',
  './src/storage.js',
  './src/game.js',
  './src/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './calendar-puzzle-standalone.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        Promise.all(ASSETS.map((url) =>
          cache.add(url).catch(() => {
            /* 单个资源缺失不影响其余缓存 */
          })
        ))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：优先取最新版本，离线时回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache(request, response);
          return response;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // 静态资源：联网时先取最新 避免旧 HTML/旧脚本混搭；断网时回退缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        putInCache(request, response);
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true })
          .then((cached) => cached || Response.error())
      )
  );
});
