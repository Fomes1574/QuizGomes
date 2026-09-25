import type { MatchMode } from '@quiz-gomes/domain';

/** Quantas pessoas esperam agora em cada modo de um tema (nunca quem). */
export interface QueueCounts {
  CASUAL: number;
  RANKED: number;
}

export type QueueActivity = ReadonlyMap<string, QueueCounts>;

export const EMPTY_QUEUE_COUNTS: QueueCounts = Object.freeze({ CASUAL: 0, RANKED: 0 });

/** Lê a mensagem `QUEUE_ACTIVITY` do canal social; entradas malformadas são ignoradas. */
export function parseQueueActivity(value: unknown): Map<string, QueueCounts> | null {
  if (!Array.isArray(value)) return null;
  const next = new Map<string, QueueCounts>();
  for (const entry of value.slice(0, 500)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { count, mode, themeId } = entry as { count?: unknown; mode?: unknown; themeId?: unknown };
    if (typeof themeId !== 'string' || (mode !== 'CASUAL' && mode !== 'RANKED')) continue;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) continue;
    const current = next.get(themeId) ?? { CASUAL: 0, RANKED: 0 };
    next.set(themeId, { ...current, [mode]: count });
  }
  return next;
}

export function queueCounts(activity: QueueActivity, themeId: string): QueueCounts {
  return activity.get(themeId) ?? EMPTY_QUEUE_COUNTS;
}

export function totalWaiting(activity: QueueActivity, themeId: string): number {
  const counts = queueCounts(activity, themeId);
  return counts.CASUAL + counts.RANKED;
}

/**
 * "Surpreenda-me" favorece quem já tem gente esperando: partida na hora é
 * a melhor surpresa. Sem ninguém na fila, sorteia entre todos.
 */
export function pickSurpriseTheme<T extends { id: string }>(
  themes: readonly T[],
  activity: QueueActivity,
  random: () => number = Math.random,
): T | undefined {
  const waiting = themes.filter((theme) => totalWaiting(activity, theme.id) > 0);
  const pool = waiting.length > 0 ? waiting : themes;
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Enquanto a busca está vazia, sugere o tema com mais gente esperando no
 * mesmo modo (nunca o próprio tema). Desempata pelo nome para não piscar.
 */
export function busiestOtherTheme<T extends { id: string; name: string }>(
  themes: readonly T[],
  activity: QueueActivity,
  currentThemeId: string,
  mode: MatchMode,
): { count: number; theme: T } | null {
  let best: { count: number; theme: T } | null = null;
  for (const theme of themes) {
    if (theme.id === currentThemeId) continue;
    const count = queueCounts(activity, theme.id)[mode];
    if (count <= 0) continue;
    if (best === null || count > best.count || (count === best.count && theme.name.localeCompare(best.theme.name, 'pt-BR') < 0)) {
      best = { count, theme };
    }
  }
  return best;
}

export function waitingLabel(count: number): string {
  return count === 1 ? '1 pessoa esperando' : `${count.toLocaleString('pt-BR')} pessoas esperando`;
}
