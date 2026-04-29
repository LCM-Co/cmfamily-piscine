/* Chan Ming POOL — Service Worker (vanilla, zéro dépendance)
 *
 * Stratégies :
 *   - /api/*       → NetworkFirst (timeout 3s, fallback cache)
 *   - /assets/*    → CacheFirst
 *   - *.html       → StaleWhileRevalidate
 *   - autres       → réseau direct, fallback cache, fallback /offline.html
 *
 * Outbox queue (IndexedDB vanilla) pour les POST/PUT/PATCH/DELETE /api/* hors-ligne :
 *   - Stocke payload + URL + headers + method
 *   - Replay au retour ligne (event 'online') ou via Background Sync ('sync')
 *   - postMessage('outbox-flushed', ...) pour notifier les clients
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `cmpool-shell-${CACHE_VERSION}`;
const PAGES_CACHE = `cmpool-pages-${CACHE_VERSION}`;
const ASSETS_CACHE = `cmpool-assets-${CACHE_VERSION}`;
const API_CACHE = `cmpool-api-${CACHE_VERSION}`;

const SHELL_URLS = [
  "/",
  "/index.html",
  "/decisions.html",
  "/technique.html",
  "/chantier.html",
  "/logistique.html",
  "/style.css",
  "/offline.html",
  "/manifest.json",
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap",
];

const API_TIMEOUT_MS = 3000;

// ───────── Install : précache de la coquille ─────────
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll fail-fast : on tolère les fonts qui peuvent renvoyer 0/opaque
    await Promise.all(SHELL_URLS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: "reload", mode: url.startsWith("http") ? "no-cors" : "same-origin" });
        await cache.put(url, resp);
      } catch (e) { /* skip */ }
    }));
    await self.skipWaiting();
  })());
});

// ───────── Activate : purge anciens caches ─────────
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, PAGES_CACHE, ASSETS_CACHE, API_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => keep.has(n) ? null : caches.delete(n)));
    if (self.registration && "navigationPreload" in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

// ───────── Fetch : routage par stratégie ─────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    // Mutations : tentative réseau, sinon outbox queue
    if (isApi(req.url)) {
      event.respondWith(handleApiMutation(req));
    }
    return; // autres méthodes : passe-plat
  }

  const url = new URL(req.url);
  if (isApi(req.url)) {
    event.respondWith(networkFirst(req, API_CACHE, API_TIMEOUT_MS));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req, ASSETS_CACHE));
  } else if (req.destination === "document" || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(staleWhileRevalidate(req, PAGES_CACHE));
  } else {
    event.respondWith(networkWithFallback(req));
  }
});

function isApi(href) {
  try { return new URL(href, self.location.href).pathname.startsWith("/api/"); }
  catch { return false; }
}

// ───────── Strategy: NetworkFirst (timeout) ─────────
async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetchWithTimeout(req, timeoutMs);
    if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json", "X-Cache": "offline" },
    });
  }
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ───────── Strategy: CacheFirst ─────────
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === "opaque")) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

// ───────── Strategy: StaleWhileRevalidate ─────────
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);

  if (cached) return cached;
  const net = await network;
  if (net) return net;
  // Fallback final : page hors-ligne
  const offline = await caches.match("/offline.html");
  return offline || new Response("Hors ligne", { status: 503 });
}

// ───────── Strategy: networkWithFallback ─────────
async function networkWithFallback(req) {
  try { return await fetch(req); }
  catch (e) {
    const c = await caches.match(req);
    if (c) return c;
    if (req.destination === "document") {
      const off = await caches.match("/offline.html");
      if (off) return off;
    }
    return new Response("", { status: 504 });
  }
}

// ───────── API mutations : outbox queue ─────────
async function handleApiMutation(req) {
  try {
    const resp = await fetchWithTimeout(req.clone(), API_TIMEOUT_MS);
    return resp;
  } catch (e) {
    // Hors-ligne : enqueue dans IndexedDB
    try {
      const body = await req.clone().text();
      const headers = {};
      req.headers.forEach((v, k) => { headers[k] = v; });
      await outboxAdd({
        url: req.url,
        method: req.method,
        headers,
        body,
        ts: Date.now(),
      });
      // Demande Background Sync si dispo
      try {
        if ("sync" in self.registration) {
          await self.registration.sync.register("cmpool-outbox");
        }
      } catch (_) {}
      return new Response(JSON.stringify({ queued: true, offline: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "offline-and-queue-failed", detail: String(err) }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}

// ───────── IndexedDB Outbox (vanilla) ─────────
const DB_NAME = "cmpool-outbox";
const DB_VERSION = 1;
const STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function outboxAdd(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function outboxAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function outboxDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function flushOutbox() {
  const items = await outboxAll();
  const results = [];
  for (const item of items) {
    try {
      const resp = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: ["GET", "HEAD"].includes(item.method) ? undefined : item.body,
      });
      if (resp.ok || (resp.status >= 200 && resp.status < 500)) {
        await outboxDelete(item.id);
        results.push({ id: item.id, status: resp.status, ok: true });
      } else {
        results.push({ id: item.id, status: resp.status, ok: false });
      }
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e) });
      // On garde l'item pour réessayer plus tard
      break;
    }
  }
  // Notifie les clients
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) {
    c.postMessage({ type: "outbox-flushed", results });
  }
  return results;
}

// Replay au signal sync (Background Sync API)
self.addEventListener("sync", (event) => {
  if (event.tag === "cmpool-outbox") {
    event.waitUntil(flushOutbox());
  }
});

// Replay manuel via message du client
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "skip-waiting") self.skipWaiting();
  if (data.type === "flush-outbox") {
    event.waitUntil(flushOutbox());
  }
});
