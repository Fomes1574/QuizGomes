import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('CORS no runtime Workers', () => {
  it('autoriza a origem própria sem hostname hardcoded', async () => {
    const response = await SELF.fetch('https://quiz-gomes.exemplo.workers.dev/api/health', {
      headers: { Origin: 'https://quiz-gomes.exemplo.workers.dev' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin'))
      .toBe('https://quiz-gomes.exemplo.workers.dev');
  });

  it('bloqueia uma origem externa antes de executar a rota', async () => {
    const response = await SELF.fetch('https://quiz-gomes.exemplo.workers.dev/api/health', {
      headers: { Origin: 'https://malicioso.example' },
    });

    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
  });
});
