import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage, onRegistered } from 'firebase/messaging/sw';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { firebaseConfig } from './lib/firebase-config.js';

interface WorkerClient {
  focus: () => Promise<unknown>;
  navigate?: (url: string) => Promise<unknown>;
  postMessage: (message: unknown) => void;
  url: string;
}

interface NotificationClickEvent extends Event {
  notification: Notification;
  waitUntil: (promise: Promise<unknown>) => void;
}

declare const self: typeof globalThis & {
  __WB_MANIFEST: Array<{ revision?: string | null; url: string } | string>;
  clients: {
    matchAll: (options: { includeUncontrolled: boolean; type: 'window' }) => Promise<WorkerClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
  registration: ServiceWorkerRegistration;
  skipWaiting: () => Promise<void>;
};

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/api\//],
}));
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly(), 'GET');

const messaging = getMessaging(initializeApp(firebaseConfig));

onRegistered(messaging, (installationId) => {
  void self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    for (const client of clients) client.postMessage({ installationId, type: 'FCM_INSTALLATION_UPDATED' });
  });
});

onBackgroundMessage(messaging, (payload) => {
  if (payload.data?.type !== 'FRIEND_REQUEST') return;
  void self.registration.showNotification(payload.data.title ?? 'Novo pedido de amizade', {
    body: payload.data.body ?? 'Você recebeu uma solicitação no Quiz Gomes.',
    data: { url: '/social?section=pedidos' },
    icon: '/icons/icon-192.webp',
    tag: payload.data.requestId ?? 'quiz-gomes-friend-request',
  });
});

self.addEventListener('notificationclick', (event) => {
  const click = event as NotificationClickEvent;
  click.notification.close();
  const destination = new URL('/social?section=pedidos', self.location.origin).toString();
  click.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing !== undefined) {
      if (existing.navigate !== undefined) await existing.navigate(destination);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(destination);
  })());
});
