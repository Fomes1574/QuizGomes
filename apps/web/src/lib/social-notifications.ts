import { apiRequest } from './api.js';
import { firebaseApp } from './firebase.js';

type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

export function publicVapidKey(): string {
  return import.meta.env.VITE_FIREBASE_VAPID_PUBLIC_KEY?.trim() ?? '';
}

export function browserNotificationState(): 'denied' | 'granted' | 'prompt' | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function activateFriendNotifications(
  tokenProvider: TokenProvider,
  onFriendRequest: () => void,
): Promise<'denied' | 'granted'> {
  if (publicVapidKey() === '') throw new Error('As notificações ainda não foram configuradas.');
  if (browserNotificationState() === 'unsupported') {
    throw new Error('Este navegador não oferece suporte a notificações.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const firebaseMessaging = await import('firebase/messaging');
  if (!(await firebaseMessaging.isSupported())) {
    throw new Error('Este navegador não oferece suporte a notificações.');
  }
  const registration = await navigator.serviceWorker.ready;
  const messaging = firebaseMessaging.getMessaging(firebaseApp);
  const installationRegistered = new Promise<void>((resolve, reject) => {
    firebaseMessaging.onRegistered(messaging, (installationId) => {
      void apiRequest('/api/social/push/installations', {
        body: { installationId },
        getToken: tokenProvider,
        method: 'POST',
      }).then(() => resolve(), reject);
    });
  });
  await firebaseMessaging.register(messaging, {
    serviceWorkerRegistration: registration,
    vapidKey: publicVapidKey(),
  });
  await installationRegistered;
  firebaseMessaging.onMessage(messaging, (payload) => {
    if (payload.data?.type === 'FRIEND_REQUEST') onFriendRequest();
  });
  return 'granted';
}

export async function listenForForegroundFriendRequests(
  onFriendRequest: () => void,
  tokenProvider: TokenProvider,
): Promise<() => void> {
  if (browserNotificationState() !== 'granted' || publicVapidKey() === '') return () => undefined;
  const firebaseMessaging = await import('firebase/messaging');
  if (!(await firebaseMessaging.isSupported())) return () => undefined;
  const messaging = firebaseMessaging.getMessaging(firebaseApp);
  const registrationListener = firebaseMessaging.onRegistered(messaging, (installationId) => {
    void apiRequest('/api/social/push/installations', {
      body: { installationId },
      getToken: tokenProvider,
      method: 'POST',
    }).catch(() => undefined);
  });
  const messageListener = firebaseMessaging.onMessage(messaging, (payload) => {
    if (payload.data?.type === 'FRIEND_REQUEST') onFriendRequest();
  });
  const registration = await navigator.serviceWorker.ready;
  await firebaseMessaging.register(messaging, {
    serviceWorkerRegistration: registration,
    vapidKey: publicVapidKey(),
  });
  return () => { registrationListener(); messageListener(); };
}
