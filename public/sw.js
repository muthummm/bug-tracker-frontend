// Service worker for desktop notifications (Web Push). Served from the site root as /sw.js.
// It shows notifications the backend pushes, even when no Bug Log tab is open, and opens the bug on click.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Bug Log', {
    body: data.body || '',
    tag: data.tag,        // same notification never shows twice
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      // Reuse the open Bug Log tab: tell it where to go, then bring it to the front
      open.postMessage({ type: 'open-url', url });
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
