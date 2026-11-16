"use strict";

const appRoot = new URL(self.registration.scope);
const home = new URL("index.html", appRoot);
const bundledMap = new URL("bangkok-rail-offline.html", appRoot);
const cacheName = "bangkok-rail-offline";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== appRoot.origin || (url.pathname !== appRoot.pathname && url.pathname !== home.pathname)) {
    return;
  }
  event.respondWith(fetch(request).catch(async error => {
    const copy = await caches.match(bundledMap.href, { cacheName });
    if (copy) return copy;
    throw error;
  }));
});
