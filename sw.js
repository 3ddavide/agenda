// Service worker della mia agenda: riceve le notifiche push e le mostra.
// Non salva copie del sito (niente cache): ogni aggiornamento pubblicato arriva subito.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Arriva una notifica dalla Edge Function "promemoria".
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  // Su iPhone ogni push DEVE mostrare una notifica, altrimenti iOS disattiva le notifiche.
  e.waitUntil(self.registration.showNotification(d.title || 'La mia agenda', {
    body: d.body || '',
    icon: 'icon.png',
    badge: 'icon.png',
    tag: d.tag || 'agenda',
    data: { url: d.url || './#oggi' }
  }));
});

// Tocco sulla notifica: apre (o riporta in primo piano) l'agenda.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus().then(w => (w && 'navigate' in w ? w.navigate(url) : w));
    }
    return self.clients.openWindow(url);
  }));
});
