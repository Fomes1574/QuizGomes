/**
 * O servidor devolve 429 quando um mesmo IP faz chamadas demais por minuto.
 * Rotinas longas do admin (importação em partes) esperam e repetem a mesma
 * parte — com a mesma chave de idempotência, nada é gravado duas vezes.
 */
export const RATE_LIMIT_RETRY_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 7;

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 429;
}

export async function withRateLimitRetry<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }),
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= MAX_ATTEMPTS) throw error;
      await wait(RATE_LIMIT_RETRY_DELAY_MS);
    }
  }
}
