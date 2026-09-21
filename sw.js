// Service Worker - 离线缓存（v3: patterns-data.js/index.html 始终走网络，其他资源 cache-first）
const CACHE_NAME = 'pattern-app-v4';
const NEVER_CACHE = ['./index.html', './patterns-data.js', './sw.js', './_clear.html'];
const ESSENTIAL = [
    './',
    './manifest.json'
];

// 安装
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ESSENTIAL))
            .then(() => self.skipWaiting())
    );
});

// 激活 - 清理所有旧缓存（包括 v1/v2）
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 拦截请求
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;
    const path = url.pathname.endsWith('/') ? './' : '.' + url.pathname;
    // patterns-data.js / index.html / sw.js 始终走网络
    if (NEVER_CACHE.includes(path) || NEVER_CACHE.includes(url.pathname)) {
        event.respondWith(
            fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
        );
        return;
    }
    // 其他资源 cache-first
    event.respondWith(
        caches.match(event.request).then(response => {
            if (response) return response;
            return fetch(event.request).then(netRes => {
                if (netRes && netRes.status === 200) {
                    const clone = netRes.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return netRes;
            }).catch(() => response);
        })
    );
});