import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env.js';
import { rateLimitedResponse } from '../http/rate-limit.js';

function limiter(success: boolean) {
  return { limit: vi.fn(() => Promise.resolve({ success })) };
}

function check(method: string, env: Env, ip: string | null = '203.0.113.7'): Promise<Response | null> {
  const url = new URL('https://quiz.test/api/themes');
  return rateLimitedResponse(new Request(url, { headers: ip === null ? {} : { 'CF-Connecting-IP': ip }, method }), env, url);
}

describe('freio de requisições por IP', () => {
  it('deixa passar dentro do limite e só consulta o limite de escrita em mutações', async () => {
    const api = limiter(true);
    const write = limiter(true);
    const env = { API_RATE_LIMITER: api, WRITE_RATE_LIMITER: write } as unknown as Env;
    expect(await check('GET', env)).toBeNull();
    expect(write.limit).not.toHaveBeenCalled();
    expect(await check('POST', env)).toBeNull();
    expect(write.limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });

  it('responde 429 com Retry-After quando estoura', async () => {
    const env = { API_RATE_LIMITER: limiter(true), WRITE_RATE_LIMITER: limiter(false) } as unknown as Env;
    const response = await check('POST', env);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('10');
    await expect(response?.json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('sem IP, sem binding ou com o limitador fora do ar, nunca bloqueia', async () => {
    const blocked = { API_RATE_LIMITER: limiter(false) } as unknown as Env;
    expect(await check('GET', blocked, null)).toBeNull();
    expect(await check('GET', {} as Env)).toBeNull();
    const broken = { API_RATE_LIMITER: { limit: () => Promise.reject(new Error('fora do ar')) } } as unknown as Env;
    expect(await check('GET', broken)).toBeNull();
  });
});
