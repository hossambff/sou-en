/* Sou Coach service worker: push notifications + a friendly offline page.
 * Deliberately caches NOTHING: pages are personal (signed-in) and built assets are already
 * HTTP-cached by the browser, so there is no risk of serving a stale or someone else's page. */

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sou Coach · offline</title>
<style>
  :root{color-scheme:light dark;--bg:#fbf5ec;--ink:#2b1d14;--soft:#6b5545;--terra:#c8553d}
  @media (prefers-color-scheme:dark){:root{--bg:#15100d;--ink:#f3e6d4;--soft:#b49d88;--terra:#e07a5f}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
    font:16px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
  h1{font-family:Georgia,serif;font-size:28px;margin:12px 0 4px}
  p{color:var(--soft);margin:4px 0}
  button{margin-top:20px;border:0;border-radius:16px;background:var(--terra);color:#fff;font:inherit;
    font-weight:600;padding:14px 28px;min-height:48px}
</style></head><body><main>
<div style="font-size:44px">📶</div>
<h1>No internet right now</h1>
<p dir="rtl">ماكاينش الأنترنيت دابا</p>
<p>Hossam needs a connection to talk. Try again in a moment.</p>
<button onclick="location.reload()">Try again · عاودي</button>
</main></body></html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean up caches from any older version of this worker (this one creates none)
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("sou-sw-")).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Network only. If a full page load fails (offline), show a small offline page instead of the browser's error.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    fetch(request).catch(
      () => new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});

function safeUrl(url) {
  // Only open pages of this app
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Hossam 💬";
  const options = {
    body: data.body || "3 دقايق؟ I'm here when you're ready 😉",
    icon: "/pwa/icon-192.png",
    badge: "/pwa/badge.png",
    tag: data.tag || "daily-reminder",
    renotify: false,
    dir: "auto",
    data: { url: safeUrl(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (client.url !== target && "navigate" in client) {
          try {
            await client.navigate(target);
          } catch {
            // Uncontrolled clients can't be navigated; open a fresh window instead
            await self.clients.openWindow(target);
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser rotated the push subscription: subscribe again and tell the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      const fresh =
        event.newSubscription ||
        (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!fresh) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fresh.toJSON(), replaces: old ? old.endpoint : undefined }),
      });
    })(),
  );
});
