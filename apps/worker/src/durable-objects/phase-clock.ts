/**
 * Relógio das fases de uma sala (partida ao vivo e metade de desafio).
 *
 * Cada fase com prazo tem dois gatilhos: um cronômetro em memória (preciso,
 * dispara no milissegundo do prazo enquanto a sala está viva) e o alarme do
 * Durable Object como reserva (sobrevive a reinício da sala, mas pode tocar
 * atrasado ou só ser repetido segundos depois após uma falha). Os dois chamam
 * a mesma transição, que só acontece uma vez.
 */

/**
 * Um gatilho pode chegar alguns milissegundos antes do prazo (relógios de
 * máquinas diferentes, arredondamento do agendador). Nas fases em que nenhum
 * jogador age — preparação, leitura e resultado —, essa diferença é aceita
 * como o próprio prazo em vez de ignorar o gatilho e reagendar.
 *
 * Nunca vale para resposta (o jogador tem até o último milissegundo), espera
 * de "pronto" e pausa: lá o prazo decide resultado ou anulação.
 */
export const PHASE_EARLY_TOLERANCE_MS = 50;

/** Fases sem ação pendente de jogador, onde a tolerância é segura. */
const TOLERANT_PHASES = new Set(['PREPARING', 'READING', 'ROUND_RESULT']);

/** Atraso a partir do qual a passagem de fase é registrada no log. */
export const PHASE_LATE_LOG_MS = 250;

/** Duração a partir da qual um efeito fora do caminho da rodada é registrado. */
export const SIDE_EFFECT_SLOW_LOG_MS = 500;

/** Instante usado pela transição de prazo: o prazo exato quando o gatilho veio só um pouco antes. */
export function phaseClock(phase: string, deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs === null || nowMs >= deadlineMs || !TOLERANT_PHASES.has(phase)) return nowMs;
  return deadlineMs - nowMs <= PHASE_EARLY_TOLERANCE_MS ? deadlineMs : nowMs;
}

/** Espera até o prazo; nunca zero, para um gatilho adiantado não virar laço apertado. */
export function timerDelay(deadlineMs: number, nowMs: number): number {
  return Math.max(1, deadlineMs - nowMs);
}

/**
 * Fila de transições: ler estado → decidir → gravar → avisar acontece uma de
 * cada vez, mesmo quando cronômetro, alarme e mensagens chegam juntos (as
 * esperas de rede no meio abririam espaço para duas transições lerem o mesmo
 * estado). Os efeitos lentos ficam fora da fila.
 */
export class TransitionQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Mede um efeito colateral; registra só quando passa do limite. Nunca lança. */
export async function measuredSideEffect(
  label: string,
  context: Record<string, string>,
  effect: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    await effect();
  } catch {
    console.error(JSON.stringify({ code: 'ROOM_SIDE_EFFECT_FAILED', effect: label, ...context }));
    return;
  }
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= SIDE_EFFECT_SLOW_LOG_MS) {
    console.warn(JSON.stringify({ code: 'ROOM_SIDE_EFFECT_SLOW', effect: label, elapsedMs, ...context }));
  }
}
