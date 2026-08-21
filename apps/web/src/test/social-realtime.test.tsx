// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  foreground: vi.fn(() => Promise.resolve(() => undefined)),
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  pending: 0,
  profile: { displayName: 'Bia', publicId: '#QGBIA333', userId: 'social-user-bia' },
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken, profile: mocks.profile, signIn: vi.fn() }),
}));
vi.mock('../lib/api.js', () => ({
  apiRequest: mocks.apiRequest,
  websocketUrl: (path: string) => `wss://quiz.test${path}`,
}));
vi.mock('../lib/social-notifications.js', () => ({
  listenForForegroundFriendRequests: mocks.foreground,
}));

import {
  SOCIAL_HEARTBEAT_INTERVAL_MS,
  SOCIAL_PONG_TIMEOUT_MS,
  SocialProvider,
  useSocial,
} from '../features/social-context.js';
import { SocialPage } from '../pages/social-page.js';

type Listener = (event: { data?: string }) => void;

class SocialSocket {
  static readonly OPEN = 1;
  static instances: SocialSocket[] = [];

  readonly close = vi.fn(() => { this.readyState = 3; this.emit('close'); });
  readonly send = vi.fn();
  readonly listeners = new Map<string, Listener[]>();
  readyState = SocialSocket.OPEN;

  constructor(readonly url: string) { SocialSocket.instances.push(this); }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback: Listener = typeof listener === 'function'
      ? listener as unknown as Listener
      : (event) => listener.handleEvent(event as MessageEvent);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  message(payload: unknown): void {
    this.emit('message', { data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
}

function Indicator() {
  const { onlineCount, pendingCount } = useSocial();
  return <output>{`${onlineCount ?? '-'} online / ${pendingCount} pedidos`}</output>;
}

async function currentSocket(): Promise<SocialSocket> {
  await waitFor(() => expect(SocialSocket.instances).toHaveLength(1));
  const socket = SocialSocket.instances[0];
  if (socket === undefined) throw new Error('WebSocket social ausente.');
  return socket;
}

describe('fundação Social realtime sem polling nem FCM obrigatório', () => {
  beforeEach(() => {
    SocialSocket.instances = [];
    mocks.pending = 0;
    mocks.apiRequest.mockReset();
    mocks.foreground.mockClear();
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/realtime/tickets') return Promise.resolve({ ticket: 'synthetic-social-ticket' });
      if (path === '/api/social/summary') {
        return Promise.resolve({ pendingCount: mocks.pending, pushConfigured: false });
      }
      if (path === '/api/social') {
        return Promise.resolve({
          friends: [],
          incoming: mocks.pending === 0 ? [] : [{
            createdAt: '2026-08-21',
            id: '11111111-1111-4111-8111-111111111111',
            user: {
              customAvatarUrl: null,
              displayName: 'Ana chegou em tempo real',
              frameId: null,
              photoUrl: null,
              publicId: '#QGANA222',
            },
          }],
          outgoing: [],
        });
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('WebSocket', SocialSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('mostra usuários únicos autoritativos e não expõe Firebase token na URL do socket', async () => {
    render(<SocialProvider><Indicator /></SocialProvider>);
    const socket = await currentSocket();
    act(() => { socket.emit('open'); socket.message({ count: 7, type: 'ONLINE_COUNT' }); });
    expect(await screen.findByText('7 online / 0 pedidos')).toBeInTheDocument();
    expect(socket.url).toContain('ticket=synthetic-social-ticket');
    expect(socket.url).not.toContain('synthetic-auth');
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/realtime/tickets', expect.objectContaining({
      body: { resource: 'social', scope: 'social' },
      method: 'POST',
    }));
  });

  it('atualiza pedido e badge com Social já aberta, sem foco, navegação, reload ou FCM', async () => {
    render(<SocialProvider><Indicator /><SocialPage /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Pedidos recebidos' }))
      .toHaveTextContent('Nenhuma solicitação recebida.'));
    mocks.pending = 1;
    act(() => socket.message({ revision: 'safe-revision', type: 'SOCIAL_INVALIDATED' }));
    expect(await screen.findByText('Ana chegou em tempo real')).toBeInTheDocument();
    expect(screen.getByText('- online / 1 pedidos')).toBeInTheDocument();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/summary').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('reconecta com backoff e recarrega o estado persistente para recuperar eventos perdidos', async () => {
    render(<SocialProvider><Indicator /></SocialProvider>);
    const first = await currentSocket();
    act(() => first.emit('open'));
    mocks.pending = 1;
    act(() => first.close());
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await waitFor(() => expect(SocialSocket.instances).toHaveLength(2));
    const returned = SocialSocket.instances[1];
    act(() => returned?.emit('open'));
    expect(await screen.findByText('- online / 1 pedidos')).toBeInTheDocument();
  });

  it('aceite, recusa, cancelamento ou bloqueio convergem via invalidação neutra sem revelar o motivo', async () => {
    mocks.pending = 1;
    render(<SocialProvider><Indicator /><SocialPage /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    expect(await screen.findByText('Ana chegou em tempo real')).toBeInTheDocument();
    mocks.pending = 0;
    act(() => socket.message({ revision: 'neutral-only', type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(screen.queryByText('Ana chegou em tempo real')).not.toBeInTheDocument());
    expect(screen.getByText('- online / 0 pedidos')).toBeInTheDocument();
    expect(screen.queryByText(/bloqueou você/i)).not.toBeInTheDocument();
  });

  it('usa heartbeat social de 45 segundos e watchdog de 15 segundos, sem frequência competitiva', async () => {
    expect(SOCIAL_HEARTBEAT_INTERVAL_MS).toBe(45_000);
    expect(SOCIAL_PONG_TIMEOUT_MS).toBe(15_000);
    vi.useFakeTimers();
    render(<SocialProvider><Indicator /></SocialProvider>);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = SocialSocket.instances[0];
    if (socket === undefined) throw new Error('Socket social ausente.');
    act(() => socket.emit('open'));
    await act(async () => vi.advanceTimersByTimeAsync(44_999));
    expect(socket.send).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socket.send).toHaveBeenCalledWith('PING');
    act(() => socket.message('PONG'));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('encerra conexão social silenciosa somente após 45 s + 15 s, sem polling HTTP', async () => {
    vi.useFakeTimers();
    render(<SocialProvider><Indicator /></SocialProvider>);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = SocialSocket.instances[0];
    if (socket === undefined) throw new Error('Socket social ausente.');
    act(() => socket.emit('open'));
    const initialSummaryCalls = mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/summary').length;
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(socket.close).not.toHaveBeenCalled();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/summary'))
      .toHaveLength(initialSummaryCalls);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socket.close).toHaveBeenCalledWith(4_001, 'Canal social indisponível');
  });
});
