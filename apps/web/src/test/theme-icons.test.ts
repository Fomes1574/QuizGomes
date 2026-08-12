import { STANDARD_THEME_ICONS } from '@quiz-gomes/domain';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sprite vetorial compartilhado dos temas', () => {
  it('contém uma única definição para cada chave publicada pelo domínio', () => {
    const sprite = readFileSync(new URL('../../public/theme-icons.svg', import.meta.url), 'utf8');

    for (const { key } of STANDARD_THEME_ICONS) {
      expect(sprite.match(new RegExp(`<symbol id="${key}"`, 'g'))).toHaveLength(1);
    }
    expect(sprite).not.toMatch(/<image\b|data:image|😀|🎮/u);
    expect(Buffer.byteLength(sprite)).toBeLessThan(8 * 1_024);
  });
});
