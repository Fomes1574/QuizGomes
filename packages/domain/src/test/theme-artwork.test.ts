import { describe, expect, it } from 'vitest';
import { isStandardThemeIconKey, STANDARD_THEME_ICONS } from '../theme-artwork.js';

describe('biblioteca padrão de arte dos temas', () => {
  it('mantém chaves únicas e uma seleção compacta de símbolos reutilizáveis', () => {
    const keys = STANDARD_THEME_ICONS.map(({ key }) => key);

    expect(keys.length).toBeGreaterThanOrEqual(12);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('games');
    expect(keys).toContain('science');
    expect(keys).toContain('fantasy');
  });

  it('aceita apenas chaves publicadas pela biblioteca interna', () => {
    expect(isStandardThemeIconKey('football')).toBe(true);
    expect(isStandardThemeIconKey('emoji-aleatorio')).toBe(false);
    expect(isStandardThemeIconKey('../arquivo')).toBe(false);
  });
});
