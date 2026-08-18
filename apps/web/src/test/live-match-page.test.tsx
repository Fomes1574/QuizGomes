// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));

vi.mock('../lib/api.js', () => ({
  apiRequest: mocks.apiRequest,
  websocketUrl: (path: string) => `wss://quiz.test${path}`,
}));

import {
  LiveMatchPage,
  MATCH_CONNECTION_EXIT_MS,
  MATCH_PONG_TIMEOUT_MS,
} from '../pages/live-match-page.js';
import { prepareMatchRoom } from '../lib/preloaded-match-room.js';

type FakeListener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });
  readonly listeners = new Map<string, FakeListener[]>();
  readonly send = vi.fn();
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback: FakeListener = typeof listener === 'function'
      ? listener as unknown as FakeListener
      : (event) => listener.handleEvent(event as MessageEvent);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return;
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener as unknown as FakeListener),
    );
  }

  emitMessage(payload: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(payload) });
    }
  }

  emit(type: 'close' | 'error' | 'open'): void {
    if (type === 'close') this.readyState = FakeWebSocket.CLOSED;
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

const activeMatch = {
  opponent: { answered: false, displayName: 'Ana', frameId: 'frame-ana', photoUrl: null, score: 0 },
  phase: 'ANSWERING',
  question: { id: 'q-1', options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta que não pode congelar?' },
  remainingMs: 9_000,
  round: { number: 1, total: 5 },
  serverNow: Date.now(),
  viewer: { displayName: 'Gomes', frameId: null, photoUrl: null, score: 0, seat: 1 },
} as const;

const voidResult = {
  opponent: { result: 'VOID', score: 0 },
  viewer: {
    knowledgeAfter: 500,
    knowledgeBefore: 500,
    knowledgeDelta: 0,
    result: 'VOID',
    score: 0,
    xpDelta: 0,
  },
} as const;

describe('página da partida em tempo real', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    mocks.getToken.mockResolvedValue('firebase-token');
    mocks.apiRequest.mockResolvedValue({ ticket: 'ticket-de-teste' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('envia ROUND_READY uma única vez somente ao fim da apresentação de 1.900 ms', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-1']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket?.emitMessage({
      match: {
        opponent: { answered: false, displayName: 'Ana', frameId: null, photoUrl: null, score: 0 },
        phase: 'ROUND_READY',
        question: { id: 'q-1', options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta sintética?' },
        remainingMs: 7_000,
        round: { number: 1, total: 5 },
        serverNow: Date.now(),
        viewer: { displayName: 'Gomes', frameId: null, photoUrl: null, score: 0, seat: 1 },
      },
      transitionMs: 450,
      type: 'ROUND_QUESTION',
    }));

    expect(screen.getByRole('status', { name: 'Pergunta 1 de 5' })).toBeInTheDocument();
    expect(screen.getAllByText('PERGUNTA')).toHaveLength(1);
    expect(document.querySelector('.match-screen--preparing')).toHaveStyle({
      '--match-question-delay': '1600ms',
    });
    expect(document.querySelector('.match-screen--preparing')).toHaveAttribute('aria-hidden', 'true');
    expect([...document.querySelectorAll('.answer-option')].every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));

    await act(async () => vi.advanceTimersByTimeAsync(1_899));
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    const roundReadyMessages = socket?.send.mock.calls.filter(([message]) => (
      message === JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' })
    ));
    expect(roundReadyMessages).toHaveLength(1);
    expect(socket?.send).toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));

    act(() => socket?.emitMessage({
      match: {
        opponent: { answered: false, displayName: 'Ana', frameId: null, photoUrl: null, score: 0 },
        phase: 'ANSWERING',
        question: { id: 'q-1', options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta sintética?' },
        remainingMs: 10_000,
        round: { number: 1, total: 5 },
        serverNow: Date.now(),
        viewer: { displayName: 'Gomes', frameId: null, photoUrl: null, score: 0, seat: 1 },
      },
      type: 'ROUND_STARTED',
    }));

    expect(document.querySelector('.match-screen--preparing')).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('10 segundos restantes');
    expect(screen.getAllByRole('button').every((button) => !button.hasAttribute('disabled'))).toBe(true);
  });

  it('assume o socket pré-carregado e só envia READY depois que a MatchScreen monta', async () => {
    const roomId = '44444444-4444-4444-8444-444444444444';
    const preparation = prepareMatchRoom(roomId, mocks.getToken);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();
    act(() => socket?.emitMessage({
      match: {
        opponent: { answered: false, customAvatarUrl: null, displayName: 'Ana', frameId: null, photoUrl: null, score: 0 },
        phase: 'LOBBY',
        serverNow: Date.now(),
        viewer: { customAvatarUrl: null, displayName: 'Gomes', frameId: null, photoUrl: null, score: 0, seat: 1 },
      },
      type: 'ROOM_STATE',
    }));
    await preparation;
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'READY' }));

    render(
      <MemoryRouter initialEntries={[`/partida/${roomId}`]}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );

    expect(socket?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'READY' }));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('remove a pergunta sem inventar contagem ou resultado antes da resposta autoritativa', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-terminal']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const playingSocket = FakeWebSocket.instances[0];
    act(() => playingSocket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();

    mocks.apiRequest.mockRejectedValue(new Error('offline'));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(playingSocket?.close).toHaveBeenCalledWith(4_001, 'Rede indisponível');
    expect(screen.getByRole('heading', { name: 'CONEXÃO PERDIDA' })).toBeInTheDocument();
    expect(screen.getByText('Tentando reconectar...')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pause-authority="local"]')).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A: A' })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(screen.getByText('Aguardando conexão para verificar a partida...')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryByText('AGUARDANDO JOGADOR')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(4_250));
    expect(screen.queryByText('Partida anulada')).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando conexão para verificar a partida...')).toBeInTheDocument();

    mocks.apiRequest.mockResolvedValue({ ticket: 'ticket-terminal' });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const terminalSocket = FakeWebSocket.instances.at(-1);
    expect(terminalSocket).not.toBe(playingSocket);
    expect(terminalSocket?.url).not.toContain('terminal=1');
    act(() => terminalSocket?.emitMessage({
      match: {
        ...activeMatch,
        phase: 'VOID',
        question: undefined,
        remainingMs: undefined,
        round: undefined,
      },
      result: voidResult,
      type: 'MATCH_VOID',
      voidReason: 'INDIVIDUAL_DISCONNECT',
    }));

    expect(screen.getByRole('heading', { name: 'Partida anulada' })).toBeInTheDocument();
    expect(screen.getByText('A partida foi anulada por perda de conexão.')).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
  });

  it('oculta a questão quando PONG para de responder mesmo com navigator online', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    render(
      <MemoryRouter initialEntries={['/partida/room-silent-network']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();
    expect(window.navigator.onLine).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(MATCH_PONG_TIMEOUT_MS - 1));
    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socket?.close).toHaveBeenCalledWith(4_001, 'Conexão sem resposta');
    expect(screen.getByRole('heading', { name: 'CONEXÃO PERDIDA' })).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('restaura o estado ANSWERING atual sem reiniciar ou reembolsar tempo', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-resume']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstSocket = FakeWebSocket.instances[0];
    act(() => firstSocket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('heading', { name: 'CONEXÃO PERDIDA' })).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const resumedSocket = FakeWebSocket.instances.at(-1);
    expect(resumedSocket).not.toBe(firstSocket);
    expect(resumedSocket?.url).not.toContain('terminal=1');
    act(() => resumedSocket?.emitMessage({
      match: { ...activeMatch, remainingMs: 6_000 },
      type: 'ROOM_STATE',
    }));

    expect(document.querySelector('.match-connection-screen--leaving')).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(MATCH_CONNECTION_EXIT_MS - 1));
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('6 segundos restantes');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('não transforma sete segundos locais em decisão terminal se a sala ainda está ANSWERING', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-answering-after-local-wait']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstSocket = FakeWebSocket.instances[0];
    act(() => firstSocket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    mocks.apiRequest.mockRejectedValue(new Error('offline'));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(7_250));
    expect(screen.getByText('Aguardando conexão para verificar a partida...')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    mocks.apiRequest.mockResolvedValue({ ticket: 'ticket-answering' });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const recoveredSocket = FakeWebSocket.instances.at(-1);
    expect(recoveredSocket?.url).not.toContain('terminal=1');
    act(() => recoveredSocket?.emitMessage({
      match: { ...activeMatch, remainingMs: 2_000 },
      type: 'ROOM_STATE',
    }));
    await act(async () => vi.advanceTimersByTimeAsync(MATCH_CONNECTION_EXIT_MS));

    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('2 segundos restantes');
  });

  it('usa a graça já consumida quando o cliente volta durante PAUSED', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-paused-reconnect']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstSocket = FakeWebSocket.instances[0];
    act(() => firstSocket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const reconnectedSocket = FakeWebSocket.instances.at(-1);
    expect(reconnectedSocket).not.toBe(firstSocket);
    act(() => reconnectedSocket?.emitMessage({
      match: {
        ...activeMatch,
        phase: 'PAUSED',
        paused: { graceRemainingMs: 4_000, phase: 'ANSWERING', phaseRemainingMs: 9_000 },
        remainingMs: undefined,
      },
      type: 'PAUSED_FOR_RECONNECT',
    }));

    expect(screen.getByRole('heading', { name: 'RECONECTANDO' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('4 segundos restantes');
    expect(document.querySelector('[data-pause-authority="server"]')).toBeInTheDocument();

    act(() => reconnectedSocket?.emitMessage({
      match: { ...activeMatch, remainingMs: 9_000 },
      type: 'RESUMED',
    }));
    await act(async () => vi.advanceTimersByTimeAsync(MATCH_CONNECTION_EXIT_MS));

    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('9 segundos restantes');
  });

  it('remove a questão também para o adversário que recebe PAUSED_FOR_RECONNECT', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-opponent-paused']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    act(() => socket?.emitMessage({
      match: {
        ...activeMatch,
        phase: 'PAUSED',
        paused: { graceRemainingMs: 6_842, phase: 'ANSWERING', phaseRemainingMs: 9_000 },
        remainingMs: undefined,
      },
      type: 'PAUSED_FOR_RECONNECT',
    }));

    expect(screen.getByRole('heading', { name: 'AGUARDANDO JOGADOR' })).toBeInTheDocument();
    expect(screen.getByText('A partida está pausada.')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('7 segundos restantes');
    await act(async () => vi.advanceTimersByTimeAsync(842));
    expect(screen.getByRole('timer')).toHaveAccessibleName('6 segundos restantes');
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('trata FINALIZING como encerramento neutro e nunca volta a projetar pergunta', async () => {
    render(
      <MemoryRouter initialEntries={['/partida/room-finalizing']}>
        <Routes>
          <Route element={<LiveMatchPage />} path="/partida/:roomId" />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.emitMessage({ match: activeMatch, type: 'ROUND_STARTED' }));
    expect(screen.getByText('Pergunta que não pode congelar?')).toBeInTheDocument();

    act(() => socket?.emitMessage({
      match: { ...activeMatch, phase: 'FINALIZING' },
      type: 'MATCH_FINALIZING',
    }));
    expect(screen.getByRole('heading', { name: 'Confirmando encerramento da partida...' })).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
  });
});
