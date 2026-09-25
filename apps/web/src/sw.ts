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

/** Só caminhos internos: um payload nunca leva o usuário para outro site. */
function safeInternalPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}

onBackgroundMessage(messaging, (payload) => {
  const data = payload.data;
  if (data?.type === 'FRIEND_REQUEST') {
    void self.registration.showNotification(data.title ?? 'Novo pedido de amizade', {
      body: data.body ?? 'Você recebeu uma solicitação no Quiz Gomes.',
      data: { url: '/social?section=pedidos' },
      icon: '/icons/icon-192.webp',
      tag: data.requestId ?? 'quiz-gomes-friend-request',
    });
    return;
  }
  if (data?.type === 'FRIEND_IN_QUEUE' || data?.type === 'CHALLENGE_READY') {
    const fallback = data.type === 'CHALLENGE_READY' ? '/social' : '/';
    void self.registration.showNotification(data.title ?? 'QUIZ GOMES', {
      body: data.body ?? '',
      data: { url: safeInternalPath(data.url, fallback) },
      icon: '/icons/icon-192.webp',
      // Um aviso de fila substitui o anterior em vez de empilhar.
      tag: data.type === 'FRIEND_IN_QUEUE' ? 'quiz-gomes-friend-in-queue' : (data.challengeId ?? 'quiz-gomes-challenge'),
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  const click = event as NotificationClickEvent;
  click.notification.close();
  const target = (click.notification.data as { url?: unknown } | null)?.url;
  const destination = new URL(safeInternalPath(target, '/social?section=pedidos'), self.location.origin).toString();
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
