// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateFriendNotifications,
  browserNotificationState,
  listenForForegroundFriendRequests,
} from '../lib/social-notifications.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(() => Promise.resolve({ enabled: true })),
  getMessaging: vi.fn(() => ({ synthetic: true })),
  isSupported: vi.fn(() => Promise.resolve(true)),
  messageHandler: null as ((payload: { data?: { type?: string } }) => void) | null,
  onMessage: vi.fn((_messaging: unknown, handler: (payload: { data?: { type?: string } }) => void) => {
    mocks.messageHandler = handler;
    return vi.fn();
  }),
  onRegistered: vi.fn((_messaging: unknown, handler: (installationId: string) => void) => {
    mocks.registeredHandler = handler;
    return vi.fn();
  }),
  registeredHandler: null as ((installationId: string) => void) | null,
  register: vi.fn(() => {
    mocks.registeredHandler?.('syntheticFID_123456789');
    return Promise.resolve();
  }),
  requestPermission: vi.fn(() => Promise.resolve<'denied' | 'granted'>('granted')),
  serviceWorker: { scope: 'https://quiz.test/' },
}));

vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../lib/firebase.js', () => ({ firebaseApp: { synthetic: true } }));
vi.mock('firebase/messaging', () => ({
  getMessaging: mocks.getMessaging,
  isSupported: mocks.isSupported,
  onMessage: mocks.onMessage,
  onRegistered: mocks.onRegistered,
  register: mocks.register,
}));

describe('notificações sociais FCM por Firebase Installation ID', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_VAPID_PUBLIC_KEY', 'synthetic-public-vapid');
    mocks.apiRequest.mockClear();
    mocks.onMessage.mockClear();
    mocks.onRegistered.mockClear();
    mocks.register.mockClear();
    mocks.requestPermission.mockReset();
    mocks.requestPermission.mockResolvedValue('granted');
    mocks.messageHandler = null;
    mocks.registeredHandler = null;
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission: mocks.requestPermission },
    });
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: window.Notification,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(mocks.serviceWorker) },
    });
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it('registra FID na API autenticada usando exatamente o service worker Workbox existente', async () => {
    const token = vi.fn(() => Promise.resolve('synthetic-auth'));
    const received = vi.fn();
    expect(browserNotificationState()).toBe('prompt');
    await expect(activateFriendNotifications(token, received)).resolves.toBe('granted');
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(
      { synthetic: true },
      { serviceWorkerRegistration: mocks.serviceWorker, vapidKey: 'synthetic-public-vapid' },
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/social/push/installations', {
      body: { installationId: 'syntheticFID_123456789' },
      getToken: token,
      method: 'POST',
    });
    mocks.messageHandler?.({ data: { type: 'FRIEND_REQUEST' } });
    expect(received).toHaveBeenCalledTimes(1);
    mocks.messageHandler?.({ data: { type: 'IGNORED' } });
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('permissão negada não registra instalação nem afeta o fluxo social', async () => {
    mocks.requestPermission.mockResolvedValue('denied');
    await expect(activateFriendNotifications(() => Promise.resolve('token'), vi.fn())).resolves.toBe('denied');
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('foreground renova FID já autorizado e atualiza o badge sem notificação duplicada do sistema', async () => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted', requestPermission: mocks.requestPermission },
    });
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: window.Notification });
    const refresh = vi.fn();
    const unsubscribe = await listenForForegroundFriendRequests(refresh, () => Promise.resolve('auth'));
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    mocks.messageHandler?.({ data: { type: 'FRIEND_REQUEST' } });
    expect(refresh).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
