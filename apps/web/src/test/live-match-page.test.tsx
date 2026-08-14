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

  it('remove a pergunta após a graça local e recupera somente o resultado terminal quando a rede volta', async () => {
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
    expect(screen.getByRole('timer')).toHaveAccessibleName('7 segundos restantes');
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A: A' })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('6 segundos restantes');
    await act(async () => vi.advanceTimersByTimeAsync(6_250));

    expect(screen.getByRole('heading', { name: 'Confirmando encerramento da partida...' })).toBeInTheDocument();
    expect(screen.queryByText('Pergunta que não pode congelar?')).not.toBeInTheDocument();
    expect(screen.queryByText('AGUARDANDO JOGADOR')).not.toBeInTheDocument();

    mocks.apiRequest.mockResolvedValue({ ticket: 'ticket-terminal' });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const terminalSocket = FakeWebSocket.instances.at(-1);
    expect(terminalSocket).not.toBe(playingSocket);
    expect(terminalSocket?.url).toContain('terminal=1');
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

  it('faz a pausa local sair suavemente e restaura a mesma pergunta com o tempo autoritativo', async () => {
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
    act(() => resumedSocket?.emitMessage({
      match: { ...activeMatch, remainingMs: 6_000 },
      type: 'RESUMED',
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
        paused: { graceRemainingMs: 7_000, phase: 'ANSWERING', phaseRemainingMs: 9_000 },
        remainingMs: undefined,
      },
      type: 'PAUSED_FOR_RECONNECT',
    }));

    expect(screen.getByRole('heading', { name: 'AGUARDANDO JOGADOR' })).toBeInTheDocument();
    expect(screen.getByText('A partida está pausada.')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName('7 segundos restantes');
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
