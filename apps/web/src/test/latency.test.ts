import { describe, expect, it } from 'vitest';
import { answerDeadline, MAX_LATENCY_COMPENSATION_MS, nextRoundTrip } from '../lib/latency.js';

describe('relógio justo da partida', () => {
  it('desconta a ida e volta: o que a tela mostra é o que o servidor vai contar', () => {
    // Servidor: 10 s restantes. Ida e volta de 200 ms: a resposta dada quando a
    // tela zerar ainda chega exatamente no fim do prazo do servidor.
    expect(answerDeadline(1_000, 10_000, 200)).toBe(10_800);
    expect(answerDeadline(1_000, 10_000, null)).toBe(11_000);
  });

  it('limita a compensação e nunca fica negativa', () => {
    expect(answerDeadline(0, 10_000, 5_000)).toBe(10_000 - MAX_LATENCY_COMPENSATION_MS);
    expect(answerDeadline(0, 100, 400)).toBe(0);
  });

  it('suaviza a medição e ignora engasgos', () => {
    let rtt = nextRoundTrip(null, 100);
    expect(rtt).toBe(100);
    rtt = nextRoundTrip(rtt, 200);
    expect(rtt).toBeCloseTo(130);
    expect(nextRoundTrip(rtt, 9_000)).toBeCloseTo(130);
    expect(nextRoundTrip(rtt, Number.NaN)).toBeCloseTo(130);
  });
});
