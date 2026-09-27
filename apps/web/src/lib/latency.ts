/**
 * Relógio justo da partida.
 *
 * O servidor avisa "restam N ms" e decide a pontuação pela hora em que a
 * resposta CHEGA até ele. A mensagem leva meia volta para chegar e a
 * resposta leva outra meia volta para voltar; sem compensar, a tela mostra
 * mais tempo do que a pessoa realmente tem e, no último segundo, um toque
 * visto como "a tempo" vira "tempo esgotado". Descontando a ida e volta
 * medida pelo batimento, o número na tela é o número que ela pontua.
 */
export const MAX_LATENCY_COMPENSATION_MS = 600;
/** Amostras acima disso são engasgos (aba em segundo plano, rede caindo), não latência. */
const MAX_RTT_SAMPLE_MS = 3_000;

/** Média móvel da ida e volta: estável contra um pacote atrasado isolado. */
export function nextRoundTrip(previousMs: number | null, sampleMs: number): number | null {
  if (!Number.isFinite(sampleMs) || sampleMs < 0 || sampleMs > MAX_RTT_SAMPLE_MS) return previousMs;
  return previousMs === null ? sampleMs : previousMs * 0.7 + sampleMs * 0.3;
}

/** Instante (relógio local) em que a resposta ainda chega a tempo no servidor. */
export function answerDeadline(receivedAtMs: number, remainingMs: number, roundTripMs: number | null): number {
  const compensation = Math.min(MAX_LATENCY_COMPENSATION_MS, Math.max(0, roundTripMs ?? 0));
  return receivedAtMs + Math.max(0, remainingMs - compensation);
}
