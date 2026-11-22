const CACHE = "spisok-pokupok-v10";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, шрифты — напрямую

  // Сначала сеть (всегда свежая версия), без интернета — сохранённая копия
  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((cached) => cached || caches.match("./index.html"))
      )
  );
});

/* ---------- push-уведомления ---------- */
self.addEventListener("push", (event) => {
  let p = {};
  try {
    const json = event.data ? event.data.json() : {};
    p = json.data || json.notification || json;
  } catch {
    p = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(p.title || "🛒 Список покупок", {
      body: p.body || "",
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: p.tag || undefined,
      data: { url: p.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
