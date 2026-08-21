// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  foreground: vi.fn(() => Promise.resolve(() => undefined)),
  friends: [] as Array<{
    customAvatarUrl: string | null;
    displayName: string;
    frameId: string | null;
    photoUrl: string | null;
    publicId: string;
  }>,
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
  pending: 0,
  presences: [] as Array<{ presence: string; publicId: string; revision: number }>,
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
  useFriendPresence,
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

function FriendIndicator() {
  const presences = useFriendPresence();
  return <output data-testid="friend-presences">{[...presences.values()]
    .map((entry) => `${entry.publicId}:${entry.presence}:${entry.revision}`).join('|')}</output>;
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
    mocks.friends = [];
    mocks.presences = [];
    mocks.apiRequest.mockReset();
    mocks.foreground.mockClear();
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/realtime/tickets') return Promise.resolve({ ticket: 'synthetic-social-ticket' });
      if (path === '/api/social/summary') {
        return Promise.resolve({ pendingCount: mocks.pending, pushConfigured: false });
      }
      if (path === '/api/social/presence') {
        return Promise.resolve({ friends: mocks.presences, revision: 1 });
      }
      if (path === '/api/social') {
        return Promise.resolve({
          friends: mocks.friends,
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

  it('carrega snapshot privado e aplica mudanças autoritativas somente ao amigo afetado', async () => {
    mocks.presences = [
      { presence: 'ONLINE', publicId: '#QGANA222', revision: 10 },
      { presence: 'OFFLINE', publicId: '#QGCAIO33', revision: 10 },
    ];
    render(<SocialProvider><FriendIndicator /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences'))
      .toHaveTextContent('#QGANA222:ONLINE:10|#QGCAIO33:OFFLINE:10'));

    act(() => socket.message({
      presence: 'MATCHMAKING',
      publicId: '#QGANA222',
      revision: 11,
      type: 'FRIEND_PRESENCE_CHANGED',
    }));
    expect(screen.getByTestId('friend-presences'))
      .toHaveTextContent('#QGANA222:MATCHMAKING:11|#QGCAIO33:OFFLINE:10');

    act(() => socket.message({
      presence: 'IN_MATCH',
      publicId: '#QGDESCONHECIDO',
      revision: 99,
      type: 'FRIEND_PRESENCE_CHANGED',
    }));
    expect(screen.getByTestId('friend-presences')).not.toHaveTextContent('DESCONHECIDO');
    expect(SocialSocket.instances).toHaveLength(1);
  });

  it('descarta eventos/snapshots antigos e remove presença quando amizade ou bloqueio mudam', async () => {
    mocks.presences = [{ presence: 'ONLINE', publicId: '#QGANA222', revision: 10 }];
    render(<SocialProvider><FriendIndicator /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toHaveTextContent('ONLINE:10'));

    act(() => socket.message({
      presence: 'IN_MATCH', publicId: '#QGANA222', revision: 20, type: 'FRIEND_PRESENCE_CHANGED',
    }));
    act(() => socket.message({
      presence: 'OFFLINE', publicId: '#QGANA222', revision: 19, type: 'FRIEND_PRESENCE_CHANGED',
    }));
    expect(screen.getByTestId('friend-presences')).toHaveTextContent('IN_MATCH:20');

    mocks.presences = [{ presence: 'ONLINE', publicId: '#QGANA222', revision: 15 }];
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/presence'))
      .toHaveLength(2));
    expect(screen.getByTestId('friend-presences')).toHaveTextContent('IN_MATCH:20');

    mocks.presences = [];
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement());
    act(() => socket.message({
      presence: 'ONLINE', publicId: '#QGANA222', revision: 30, type: 'FRIEND_PRESENCE_CHANGED',
    }));
    expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement();
  });

  it('reconexão restaura snapshot perdido sem polling e mantém requests somente sob demanda', async () => {
    mocks.presences = [{ presence: 'ONLINE', publicId: '#QGANA222', revision: 10 }];
    render(<SocialProvider><FriendIndicator /></SocialProvider>);
    const first = await currentSocket();
    act(() => first.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toHaveTextContent('ONLINE:10'));
    mocks.presences = [{ presence: 'RECONNECTING', publicId: '#QGANA222', revision: 40 }];
    act(() => first.close());
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await waitFor(() => expect(SocialSocket.instances).toHaveLength(2));
    act(() => SocialSocket.instances[1]?.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toHaveTextContent('RECONNECTING:40'));
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/presence'))
      .toHaveLength(2);
  });

  it('Social aberta reorganiza disponível, procurando, partida e offline sem FCM nem nova conexão', async () => {
    mocks.friends = [{
      customAvatarUrl: null,
      displayName: 'Amiga Real',
      frameId: 'frame-autoritativo',
      photoUrl: null,
      publicId: '#QGANA222',
    }];
    mocks.presences = [{ presence: 'ONLINE', publicId: '#QGANA222', revision: 10 }];
    render(<SocialProvider><SocialPage /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    expect(await screen.findByLabelText('Amiga Real está online')).toBeInTheDocument();

    for (const [presence, label, revision] of [
      ['MATCHMAKING', 'procurando partida', 11],
      ['IN_MATCH', 'em partida', 12],
      ['RECONNECTING', 'reconectando', 13],
      ['ONLINE', 'online', 14],
      ['OFFLINE', 'offline', 15],
    ] as const) {
      act(() => socket.message({ presence, publicId: '#QGANA222', revision, type: 'FRIEND_PRESENCE_CHANGED' }));
      expect(screen.getByLabelText(`Amiga Real está ${label}`)).toBeInTheDocument();
    }
    expect(SocialSocket.instances).toHaveLength(1);
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === '/api/social/presence'))
      .toHaveLength(1);
  });

  it('aceite de amizade online converge imediatamente e invalidação de remoção limpa o cache', async () => {
    render(<SocialProvider><FriendIndicator /><SocialPage /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement());

    mocks.friends = [{
      customAvatarUrl: null,
      displayName: 'Nova amizade realtime',
      frameId: null,
      photoUrl: null,
      publicId: '#QGNOVA22',
    }];
    mocks.presences = [{ presence: 'IN_MATCH', publicId: '#QGNOVA22', revision: 80 }];
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    expect(await screen.findByLabelText('Nova amizade realtime está em partida')).toBeInTheDocument();

    mocks.friends = [];
    mocks.presences = [];
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(screen.queryByText('Nova amizade realtime')).not.toBeInTheDocument());
    expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement();
  });

  it('ignora snapshot antigo que termina depois da revogação mais recente de uma amizade', async () => {
    mocks.presences = [{ presence: 'ONLINE', publicId: '#QGANA222', revision: 10 }];
    render(<SocialProvider><FriendIndicator /></SocialProvider>);
    const socket = await currentSocket();
    act(() => socket.emit('open'));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toHaveTextContent('ONLINE:10'));

    let resolveDelayed: ((snapshot: { friends: typeof mocks.presences; revision: number }) => void) | undefined;
    let delayedNext = true;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/social/presence' && delayedNext) {
        delayedNext = false;
        return new Promise<{ friends: typeof mocks.presences; revision: number }>((resolve) => {
          resolveDelayed = resolve;
        });
      }
      if (path === '/api/social/presence') {
        return Promise.resolve({ friends: mocks.presences, revision: 1 });
      }
      if (path === '/api/social/summary') {
        return Promise.resolve({ pendingCount: mocks.pending, pushConfigured: false });
      }
      return Promise.resolve({ ok: true });
    });
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(resolveDelayed).toBeDefined());
    mocks.presences = [];
    act(() => socket.message({ type: 'SOCIAL_INVALIDATED' }));
    await waitFor(() => expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement());

    await act(async () => {
      resolveDelayed?.({
        friends: [{ presence: 'IN_MATCH', publicId: '#QGANA222', revision: 99 }],
        revision: 99,
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('friend-presences')).toBeEmptyDOMElement();
  });
});
