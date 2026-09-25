import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('R2 privado de imagens de perguntas', () => {
  it('serve somente um WebP que também está registrado em uma pergunta', async () => {
    const themeId = `theme-image-${crypto.randomUUID()}`;
    const poolId = `${themeId}:pool`;
    const questionId = crypto.randomUUID();
    const key = `questions/${questionId}/v1.webp`;
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    await env.QUESTION_IMAGES.put(key, bytes, {
      customMetadata: { license: 'CC BY 4.0', sourceUrl: 'https://example.test/image' },
      httpMetadata: { contentType: 'image/webp' },
    });
    await env.QUESTIONS_DB.batch([
      env.QUESTIONS_DB.prepare(
        "INSERT INTO question_pools (id, theme_id, difficulty) VALUES (?1, ?2, 'MEDIUM')",
      ).bind(poolId, themeId),
      env.QUESTIONS_DB.prepare(
        `INSERT INTO questions
          (id, pool_id, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status, image_key, image_bytes, image_license)
         VALUES (?1, ?2, 'Imagem?', 'A', 'B', 'C', 'D', 0, ?3, 'ACTIVE', ?4, ?5, 'CC BY 4.0')`,
      ).bind(questionId, poolId, `hash-${questionId}`, key, bytes.byteLength),
    ]);

    const response = await SELF.fetch(`https://quiz.test/api/question-images/${key}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(await response.arrayBuffer()).toEqual(bytes.buffer);

    const cached = await SELF.fetch(`https://quiz.test/api/question-images/${key}`, {
      headers: { 'If-None-Match': response.headers.get('ETag')! },
    });
    expect(cached.status).toBe(304);

    const hiddenKey = `questions/${crypto.randomUUID()}/v1.webp`;
    await env.QUESTION_IMAGES.put(hiddenKey, bytes, { httpMetadata: { contentType: 'image/webp' } });
    expect(await SELF.fetch(`https://quiz.test/api/question-images/${hiddenKey}`).then((item) => item.status)).toBe(404);
  });
});
