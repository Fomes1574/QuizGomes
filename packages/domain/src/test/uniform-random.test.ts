import { describe, expect, it } from 'vitest';
import { InsufficientQuestionPoolError, selectUniformSlots } from '../index.js';

describe('sorteio uniforme estrutural', () => {
  it('nunca seleciona bloqueadas nem duplica na partida', () => {
    const slots = selectUniformSlots(10, 5, new Set([1, 3, 5]), () => 0);
    expect(slots).toEqual([2, 4, 6, 7, 8]);
    expect(new Set(slots).size).toBe(5);
  });

  it('mapeia cada ordinal elegível para exatamente um slot', () => {
    const results = Array.from({ length: 4 }, (_, ordinal) =>
      selectUniformSlots(5, 1, new Set([3]), () => ordinal)[0],
    );
    expect(results).toEqual([1, 2, 4, 5]);
  });

  it('desconsidera bloqueios fora do pool', () => {
    expect(selectUniformSlots(2, 2, new Set([0, 3, 999]), () => 0)).toEqual([1, 2]);
  });

  it('retorna erro explícito quando o pool é insuficiente', () => {
    expect(() => selectUniformSlots(4, 2, new Set([1, 2, 3]), () => 0)).toThrow(InsufficientQuestionPoolError);
  });

  it('rejeita fonte aleatória inválida', () => {
    expect(() => selectUniformSlots(3, 1, new Set(), () => 3)).toThrow(RangeError);
  });
});
