// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  discardPreparedMatchRoom: vi.fn(),
  getToken: vi.fn(),
  navigate: vi.fn(),
  prepareMatchRoom: vi.fn(),
  preloadMatchPresentationAssets: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({
    getToken: mocks.getToken,
    profile: { displayName: 'Jogador autenticado', userId: 'viewer' },
  }),
}));

vi.mock('../lib/api.js', () => ({
  apiRequest: mocks.apiRequest,
  websocketUrl: (path: string) => `wss://quiz.test${path}`,
}));

vi.mock('../lib/preloaded-match-room.js', () => ({
  discardPreparedMatchRoom: mocks.discardPreparedMatchRoom,
  prepareMatchRoom: mocks.prepareMatchRoom,
  preloadMatchPresentationAssets: mocks.preloadMatchPresentationAssets,
}));

vi.mock('../pages/live-match-page.js', () => ({ LiveMatchPage: () => null }));

import {
  elapsedSearchSeconds,
  matchmakingFailureMessage,
  useMatchmaking,
} from '../hooks/use-matchmaking.js';
import { MATCH_FOUND_PRESENTATION_MS } from '../lib/matchmaking-presentation.js';

type FakeListener = (event: { code?: number; data?: string }) => void;

class FakeWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly close = vi.fn();
  readonly listeners = new Map<string, FakeListener[]>();
  readonly send = vi.fn();
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback: FakeListener = typeof listener === 'function'
      ? (event) => listener(event as MessageEvent)
      : (event) => listener.handleEvent(event as MessageEvent);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, event: { code?: number; data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

const foundPayload = {
  opponent: {
    customAvatarUrl: '/api/avatars/opponent/v2.webp',
    displayName: 'Adversária Real',
    frameId: 'frame-real',
    knowledge: 0,
    photoUrl: 'https://lh3.googleusercontent.com/opponent',
  },
  preload: {
    firstQuestion: {
      id: 'question-public-1',
      imageUrl: '/images/question-public-1.webp',
      options: ['A', 'B', 'C', 'D'],
      prompt: 'Pergunta pública?',
    },
  },
  roomId: '11111111-1111-4111-8111-111111111111',
  type: 'MATCH_FOUND',
};

async function startSearch(result: { current: ReturnType<typeof useMatchmaking> }): Promise<FakeWebSocket> {
  await act(async () => result.current.start('theme-1', 'CASUAL'));
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('WebSocket de busca não foi criado.');
  return socket;
}

describe('orquestração do matchmaking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z'));
    FakeWebSocket.instances = [];
    mocks.getToken.mockResolvedValue('firebase-token');
    mocks.apiRequest.mockResolvedValue({ expiresAt: Date.now() + 30_000, ticket: 'ticket' });
    mocks.prepareMatchRoom.mockResolvedValue(undefined);
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('deriva o relógio de SEARCHING.timeoutAt e não navega ao receber MATCH_FOUND', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);
    const timeoutAt = Date.now() + 60_000;

    act(() => socket.emitMessage({ timeoutAt, type: 'SEARCHING' }));
    expect(result.current.elapsedSeconds).toBe(0);
    expect(elapsedSearchSeconds(timeoutAt, Date.now() + 59_999)).toBe(59);
    expect(elapsedSearchSeconds(timeoutAt, Date.now() + 60_000)).toBe(60);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.elapsedSeconds).toBe(1);

    act(() => socket.emitMessage(foundPayload));
    await act(async () => Promise.resolve());
    expect(result.current.status).toBe('presenting-opponent');
    expect(result.current.opponent?.displayName).toBe('Adversária Real');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.preloadMatchPresentationAssets).toHaveBeenCalledWith(
      foundPayload.opponent,
      foundPayload.preload,
    );

    await act(async () => vi.advanceTimersByTimeAsync(MATCH_FOUND_PRESENTATION_MS - 1));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.navigate).toHaveBeenCalledWith(`/partida/${foundPayload.roomId}`);
  });

  it('usa a apresentação como loading e só sai depois que a sala indispensável fica pronta', async () => {
    let resolvePreparation: (() => void) | null = null;
    mocks.prepareMatchRoom.mockImplementation(() => new Promise<void>((resolve) => {
      resolvePreparation = resolve;
    }));
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);

    act(() => socket.emitMessage(foundPayload));
    await act(async () => vi.advanceTimersByTimeAsync(MATCH_FOUND_PRESENTATION_MS));
    expect(result.current.status).toBe('presenting-opponent');
    expect(result.current.preparing).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreparation?.();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('leaving-opponent');
    await act(async () => vi.advanceTimersByTimeAsync(899));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.navigate).toHaveBeenCalledWith(`/partida/${foundPayload.roomId}`);
  });

  it('preserva tema e modalidade na navegação para a sala', async () => {
    const { result } = renderHook(() => useMatchmaking());
    await act(async () => result.current.start('theme-elden', 'RANKED', 'elden-ring'));
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error('Socket de matchmaking ausente.');
    act(() => socket.emitMessage(foundPayload));
    await act(async () => vi.advanceTimersByTimeAsync(MATCH_FOUND_PRESENTATION_MS));
    expect(mocks.navigate).toHaveBeenCalledWith(`/partida/${foundPayload.roomId}`, {
      state: {
        matchOrigin: { mode: 'RANKED', returnTo: '/temas/elden-ring' },
      },
    });
  });

  it('cancela no servidor imediatamente e conserva a composição durante a saída curta', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);

    act(() => result.current.cancel());
    expect(socket.close).toHaveBeenCalledWith(1_000, 'Cancelado pelo jogador');
    expect(result.current.status).toBe('cancelling');
    await act(async () => vi.advanceTimersByTimeAsync(259));
    expect(result.current.status).toBe('cancelling');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.status).toBe('idle');
  });

  it('mantém o timeout explícito até Voltar ao tema concluir a saída', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);

    act(() => socket.emitMessage({ type: 'TIMEOUT' }));
    expect(result.current.status).toBe('timed-out');
    expect(result.current.elapsedSeconds).toBe(60);

    act(() => result.current.cancel());
    expect(result.current.status).toBe('cancelling');
    await act(async () => vi.advanceTimersByTimeAsync(259));
    expect(result.current.status).toBe('cancelling');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.status).toBe('idle');
  });

  it('traduz somente códigos seguros de inicialização sem expor detalhe interno', () => {
    expect(matchmakingFailureMessage('PLAYER_BUSY')).toBe('Um dos jogadores já está em outra partida.');
    expect(matchmakingFailureMessage('PROFILE_REQUIRED')).toBe('Um dos jogadores precisa concluir o perfil.');
    expect(matchmakingFailureMessage('QUESTION_POOL_EMPTY')).toBe('Este tema ainda não possui perguntas suficientes.');
    expect(matchmakingFailureMessage('QUESTION_POOL_INCONSISTENT')).toBe('O banco de perguntas deste tema está em manutenção.');
    expect(matchmakingFailureMessage('QUESTION_POOL_INSUFFICIENT')).toBe(
      'As perguntas recentes deste tema foram esgotadas para estes jogadores.',
    );
    expect(matchmakingFailureMessage('RECENT_QUESTIONS_EXHAUSTED')).toBe(
      'As perguntas recentes deste tema foram esgotadas para estes jogadores.',
    );
    expect(matchmakingFailureMessage('SQLITE_CONSTRAINT active_match_players')).toBe(
      'Não foi possível formar a partida.',
    );
  });
});

describe('busca com o celular em segundo plano', () => {
  let visibility: DocumentVisibilityState = 'visible';

  function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    mocks.getToken.mockResolvedValue('firebase-token');
    mocks.apiRequest.mockResolvedValue({ expiresAt: Date.now() + 30_000, ticket: 'ticket' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('pausa depois de 20 s fora e deixa voltar para a fila', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);
    act(() => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTimeAsync(19_000));
    expect(result.current.status).toBe('searching');
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.status).toBe('paused');
    expect(socket.close).toHaveBeenCalledWith(1_000, 'Pausado em segundo plano');

    act(() => setVisibility('visible'));
    await act(async () => { result.current.resume(); await Promise.resolve(); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe('searching');
  });

  it('uma saída rápida não pausa nada', async () => {
    const { result } = renderHook(() => useMatchmaking());
    await startSearch(result);
    act(() => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    act(() => setVisibility('visible'));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current.status).toBe('searching');
  });

  it('socket derrubado pelo sistema em segundo plano vira pausa, não erro', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);
    act(() => setVisibility('hidden'));
    act(() => socket.emit('close', { code: 1_006 }));
    expect(result.current.status).toBe('paused');
    expect(result.current.error).toBeNull();
  });
});

describe('batimento da fila', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    mocks.getToken.mockResolvedValue('firebase-token');
    mocks.apiRequest.mockResolvedValue({ expiresAt: Date.now() + 30_000, ticket: 'ticket' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

  it('pede batimento ao servidor e manda PING a cada 10 s', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);
    expect(socket.url).toContain('hb=1');
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(socket.send).toHaveBeenCalledWith('PING');
  });

  it('busca substituída em outra aba avisa em vez de parecer queda', async () => {
    const { result } = renderHook(() => useMatchmaking());
    const socket = await startSearch(result);
    act(() => socket.emit('close', { code: 4_103 }));
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toMatch(/outra aba/);
  });
});
