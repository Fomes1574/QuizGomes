import { describe, expect, it } from 'vitest';
import {
  createPoolState,
  decodePoolState,
  discoveredCount,
  discoveredPercentage,
  encodePoolState,
  hasSeen,
  markAnswered,
} from '../index.js';

describe('estado compacto usuário + pool', () => {
  it('guarda somente descoberta histórica, sem fila de exibições recentes', () => {
    let state = createPoolState();
    for (let slot = 1; slot <= 201; slot += 1) state = markAnswered(state, slot);

    expect(Object.keys(state)).toEqual(['seenBitmap']);
    expect(hasSeen(state, 1)).toBe(true);
    expect(hasSeen(state, 201)).toBe(true);
    expect(discoveredCount(state, 201)).toBe(201);
    expect(discoveredPercentage(state, 402)).toBe(50);
  });

  it('marcar o mesmo slot duas vezes é idempotente', () => {
    const once = markAnswered(createPoolState(), 7);
    const twice = markAnswered(once, 7);
    expect([...twice.seenBitmap]).toEqual([...once.seenBitmap]);
    expect(discoveredCount(twice, 8)).toBe(1);
  });

  it('serializa e desserializa sem perdas', () => {
    let state = createPoolState();
    state = markAnswered(state, 1);
    state = markAnswered(state, 70_000);
    const decoded = decodePoolState(encodePoolState(state));
    expect(hasSeen(decoded, 1)).toBe(true);
    expect(hasSeen(decoded, 70_000)).toBe(true);
    expect(hasSeen(decoded, 2)).toBe(false);
  });

  it('lê o formato antigo descartando a fila das últimas 200 sem migration de dados', () => {
    // Formato 1: [versão=1][contagem:uint16][slots:uint32...][bitmap...]
    const recent = [3, 9];
    const bitmap = markAnswered(markAnswered(createPoolState(), 3), 9).seenBitmap;
    const legacy = new Uint8Array(3 + (recent.length * 4) + bitmap.length);
    const view = new DataView(legacy.buffer);
    view.setUint8(0, 1);
    view.setUint16(1, recent.length, false);
    recent.forEach((slot, index) => view.setUint32(3 + (index * 4), slot, false));
    legacy.set(bitmap, 3 + (recent.length * 4));

    const decoded = decodePoolState(legacy);
    expect(hasSeen(decoded, 3)).toBe(true);
    expect(hasSeen(decoded, 9)).toBe(true);
    expect(discoveredCount(decoded, 16)).toBe(2);
  });

  it('rejeita versão desconhecida e conteúdo truncado', () => {
    expect(() => decodePoolState(new Uint8Array([9]))).toThrow(/desconhecida/);
    expect(() => decodePoolState(new Uint8Array())).toThrow(/truncado/);
  });

  it('ignora bits acima do total ativo na porcentagem', () => {
    const state = markAnswered(markAnswered(createPoolState(), 1), 9);
    expect(discoveredCount(state, 8)).toBe(1);
  });
});
