import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_RETRY_DELAY_MS, withRateLimitRetry } from '../lib/rate-limit-retry.js';

const limited = Object.assign(new Error('Muitas ações'), { status: 429 });

describe('repetição após limite de requisições', () => {
  it('espera e repete a mesma chamada quando recebe 429', async () => {
    const run = vi.fn().mockRejectedValueOnce(limited).mockResolvedValueOnce('ok');
    const wait = vi.fn(() => Promise.resolve());
    await expect(withRateLimitRetry(run, wait)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(RATE_LIMIT_RETRY_DELAY_MS);
  });

  it('outros erros sobem na hora e o 429 desiste depois de algumas tentativas', async () => {
    const other = Object.assign(new Error('inválido'), { status: 400 });
    const wait = vi.fn(() => Promise.resolve());
    await expect(withRateLimitRetry(() => Promise.reject(other), wait)).rejects.toBe(other);
    expect(wait).not.toHaveBeenCalled();
    await expect(withRateLimitRetry(() => Promise.reject(limited), wait)).rejects.toBe(limited);
    expect(wait).toHaveBeenCalledTimes(6);
  });
});
