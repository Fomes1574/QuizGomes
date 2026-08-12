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

import { LiveMatchPage } from '../pages/live-match-page.js';

type FakeListener = (event: { data?: string }) => void;

class FakeWebSocket {
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

  emitMessage(payload: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(payload) });
    }
  }
}

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

  it('envia ROUND_READY uma única vez somente ao fim da apresentação de 900 ms', async () => {
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
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));

    await act(async () => vi.advanceTimersByTimeAsync(899));
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socket?.send).toHaveBeenCalledTimes(1);
    expect(socket?.send).toHaveBeenCalledWith(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));
  });
});
