/* =====================================================================================
   THE PUSH WORKER -- draws the notification the server sends, opens the thing it names.

     "GM needs phone notifications whenever there is an imprest even if he logs in via browser"

   Registered by app.html under its OWN scope, /push/ (pushReg_), so it never meets the call
   app's crisis worker at / -- that one is unregistered whenever the admin switches offline
   mode off, and a notification subscription must not die with it. This worker serves no page
   and caches nothing; it exists only so the browser has somewhere to deliver a push while the
   portal is closed. The subscription that reaches the server is made in api/_lib/push.js's
   terms: a JSON payload of { title, body, url, tag }.
   ===================================================================================== */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  var opts = {
    body: d.body || '',
    icon: '/lock-logo.png', badge: '/lock-logo.png',
    data: { url: d.url || '/dashboard' },
    /* One request, one notification: a second push for the same tag replaces the first on
       the tray rather than stacking under it. */
    tag: d.tag || undefined, renotify: !!d.tag,
  };
  e.waitUntil(self.registration.showNotification(d.title || 'HOPE PMO', opts));
});

/* A tap opens the request. A portal window that is already open is brought forward and told
   which item to open (app.html listens for 'hope-open'); otherwise a new one opens on the
   deep link, which the page resolves exactly as it does the email's ?imp= link. */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/dashboard';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.location.origin) === 0 && /\/(dashboard|portal)(\?|#|$)/.test(c.url) && 'focus' in c) {
        c.postMessage({ type: 'hope-open', url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
