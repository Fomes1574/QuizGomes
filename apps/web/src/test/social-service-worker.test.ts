// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  background: null as ((payload: { data?: Record<string, string> }) => void) | null,
  cleanup: vi.fn(),
  click: null as ((event: Event) => void) | null,
  clientsClaim: vi.fn(),
  existing: {
    focus: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
    postMessage: vi.fn(),
    url: 'http://localhost/perfil',
  },
  matchAll: vi.fn(),
  navigation: vi.fn(),
  networkOnly: vi.fn(),
  onRegistered: null as ((installationId: string) => void) | null,
  openWindow: vi.fn(() => Promise.resolve()),
  precache: vi.fn(),
  registerRoute: vi.fn(),
  showNotification: vi.fn(() => Promise.resolve()),
  skipWaiting: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({ synthetic: true })) }));
vi.mock('firebase/messaging/sw', () => ({
  getMessaging: vi.fn(() => ({ synthetic: true })),
  onBackgroundMessage: vi.fn((_messaging: unknown, handler: (payload: { data?: Record<string, string> }) => void) => {
    mocks.background = handler;
  }),
  onRegistered: vi.fn((_messaging: unknown, handler: (installationId: string) => void) => {
    mocks.onRegistered = handler;
  }),
}));
vi.mock('workbox-core', () => ({ clientsClaim: mocks.clientsClaim }));
vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: mocks.cleanup,
  createHandlerBoundToURL: vi.fn(() => vi.fn()),
  precacheAndRoute: mocks.precache,
}));
vi.mock('workbox-routing', () => ({
  NavigationRoute: class { constructor(...args: unknown[]) { mocks.navigation(...args); } },
  registerRoute: mocks.registerRoute,
}));
vi.mock('workbox-strategies', () => ({
  NetworkOnly: class { constructor() { mocks.networkOnly(); } },
}));

describe('PWA + FCM usam um único service worker com shell offline e click Social', () => {
  beforeAll(async () => {
    mocks.matchAll.mockResolvedValue([mocks.existing]);
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        __WB_MANIFEST: [{ revision: 'synthetic', url: '/index.html' }],
        addEventListener: (type: string, handler: (event: Event) => void) => {
          if (type === 'notificationclick') mocks.click = handler;
        },
        clients: { matchAll: mocks.matchAll, openWindow: mocks.openWindow },
        location: { origin: 'http://localhost' },
        registration: { showNotification: mocks.showNotification },
        skipWaiting: mocks.skipWaiting,
      },
    });
    await import('../sw.js');
  });

  afterAll(() => vi.unstubAllGlobals());

  it('preserva precache, atualização, navegação offline e API autenticada NetworkOnly', () => {
    expect(mocks.skipWaiting).toHaveBeenCalledTimes(1);
    expect(mocks.clientsClaim).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.precache).toHaveBeenCalledWith([{ revision: 'synthetic', url: '/index.html' }]);
    expect(mocks.navigation).toHaveBeenCalledWith(expect.any(Function), { denylist: [/^\/api\//] });
    expect(mocks.networkOnly).toHaveBeenCalledTimes(1);
    expect(mocks.registerRoute).toHaveBeenCalledTimes(2);
  });

  it('exibe notificação background somente para pedido de amizade e não duplica outros eventos', () => {
    mocks.background?.({ data: { type: 'OTHER' } });
    expect(mocks.showNotification).not.toHaveBeenCalled();
    mocks.background?.({ data: {
      body: 'Ana quer adicionar você no Quiz Gomes',
      requestId: 'synthetic-request',
      title: 'Novo pedido de amizade',
      type: 'FRIEND_REQUEST',
    } });
    expect(mocks.showNotification).toHaveBeenCalledWith('Novo pedido de amizade', {
      body: 'Ana quer adicionar você no Quiz Gomes',
      data: { url: '/social?section=pedidos' },
      icon: '/icons/icon-192.webp',
      tag: 'synthetic-request',
    });
  });

  it('notification click redireciona a aba existente para Social/Pedidos', async () => {
    const close = vi.fn();
    mocks.click?.({
      notification: { close },
      waitUntil: vi.fn(),
    } as unknown as Event);
    await vi.waitFor(() => expect(mocks.existing.focus).toHaveBeenCalledTimes(1));
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.existing.navigate).toHaveBeenCalledWith('http://localhost/social?section=pedidos');
    expect(mocks.openWindow).not.toHaveBeenCalled();
  });

  it('rotaciona o FID para janelas controladas sem expor dados em APIs públicas', async () => {
    mocks.onRegistered?.('syntheticFID_rotated_123');
    await vi.waitFor(() => expect(mocks.existing.postMessage).toHaveBeenCalledWith({
      installationId: 'syntheticFID_rotated_123',
      type: 'FCM_INSTALLATION_UPDATED',
    }));
  });
});
