// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../lib/api.js', () => ({
  apiRequest: mocks.apiRequest,
  websocketUrl: (path: string) => `wss://quiz.test${path}`,
}));

import {
  discardPreparedMatchRoom,
  prepareMatchRoom,
  takePreparedMatchRoom,
} from '../lib/preloaded-match-room.js';

type FakeListener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly CLOSED = 3;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });
  readonly listeners = new Map<string, Set<FakeListener>>();
  readonly send = vi.fn();
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback: FakeListener = typeof listener === 'function'
      ? listener as unknown as FakeListener
      : (event) => listener.handleEvent(event as MessageEvent);
    this.listeners.set(type, new Set([...(this.listeners.get(type) ?? []), callback]));
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener as unknown as FakeListener);
  }

  emit(type: string, event: { data?: string } = {}): void {
    if (type === 'open') this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

describe('pré-carga segura da MatchRoom', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mocks.apiRequest.mockResolvedValue({ ticket: 'room-ticket' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    for (const socket of FakeWebSocket.instances) socket.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('abre e bufferiza a sala sem enviar READY nem iniciar os 10 segundos', async () => {
    const roomId = '22222222-2222-4222-8222-222222222222';
    const preparing = prepareMatchRoom(roomId, vi.fn().mockResolvedValue('firebase-token'));
    await Promise.resolve();
    await Promise.resolve();
    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit('open');
    socket?.emitMessage({ match: { phase: 'LOBBY' }, type: 'ROOM_STATE' });
    await preparing;
    expect(socket?.send).not.toHaveBeenCalled();

    const connection = takePreparedMatchRoom(roomId);
    expect(connection?.socket).toBe(socket);
    expect(connection?.messages).toEqual([JSON.stringify({ match: { phase: 'LOBBY' }, type: 'ROOM_STATE' })]);
    expect(takePreparedMatchRoom(roomId)).toBeNull();
    connection?.socket.close(1_000, 'Teste concluído');
  });

  it('descarta também uma conexão ainda em preparação', async () => {
    const roomId = '33333333-3333-4333-8333-333333333333';
    const preparation = prepareMatchRoom(roomId, vi.fn().mockResolvedValue('firebase-token'));
    await Promise.resolve();
    await Promise.resolve();
    const socket = FakeWebSocket.instances.at(-1);
    discardPreparedMatchRoom(roomId);
    socket?.emit('close');
    await expect(preparation).rejects.toThrow('preparar a conexão');
    expect(socket?.close).toHaveBeenCalledWith(1_000, 'Preparação descartada');
  });
});
