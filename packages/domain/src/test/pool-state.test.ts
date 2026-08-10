import { describe, expect, it } from 'vitest';
import {
  RECENT_QUESTION_LIMIT,
  createPoolState,
  decodePoolState,
  discoveredCount,
  discoveredPercentage,
  encodePoolState,
  hasSeen,
  markAnswered,
  unionRecent,
} from '../index.js';

describe('estado compacto usuário + pool', () => {
  it('bloqueia exatamente 200 e a 201ª libera a mais antiga', () => {
    let state = createPoolState();
    for (let slot = 1; slot <= 200; slot += 1) state = markAnswered(state, slot);
    expect(state.recentSlots).toHaveLength(RECENT_QUESTION_LIMIT);
    expect(state.recentSlots[0]).toBe(1);

    state = markAnswered(state, 201);
    expect(state.recentSlots).toHaveLength(RECENT_QUESTION_LIMIT);
    expect(state.recentSlots[0]).toBe(2);
    expect(state.recentSlots.at(-1)).toBe(201);
  });

  it('não duplica slot recente e preserva ordem mais nova', () => {
    let state = createPoolState();
    state = markAnswered(state, 1);
    state = markAnswered(state, 2);
    state = markAnswered(state, 1);
    expect(state.recentSlots).toEqual([2, 1]);
  });

  it('faz união entre jogadores sem duplicata', () => {
    const first = markAnswered(markAnswered(createPoolState(), 1), 2);
    const second = markAnswered(markAnswered(createPoolState(), 2), 3);
    expect([...unionRecent(first, second)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('mantém descoberta histórica após sair das últimas 200', () => {
    let state = createPoolState();
    for (let slot = 1; slot <= 201; slot += 1) state = markAnswered(state, slot);
    expect(state.recentSlots).not.toContain(1);
    expect(hasSeen(state, 1)).toBe(true);
    expect(discoveredCount(state, 201)).toBe(201);
    expect(discoveredPercentage(state, 402)).toBe(50);
  });

  it('serializa e desserializa sem perdas', () => {
    let state = createPoolState();
    state = markAnswered(state, 1);
    state = markAnswered(state, 70_000);
    const decoded = decodePoolState(encodePoolState(state));
    expect(decoded.recentSlots).toEqual([1, 70_000]);
    expect(hasSeen(decoded, 1)).toBe(true);
    expect(hasSeen(decoded, 70_000)).toBe(true);
  });

  it('ignora bits acima do total ativo na porcentagem', () => {
    const state = markAnswered(markAnswered(createPoolState(), 1), 9);
    expect(discoveredCount(state, 8)).toBe(1);
  });
});
