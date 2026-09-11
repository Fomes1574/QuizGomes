import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * O seletor de amigo do desafio quebrava no celular: as ações caíam em cima do
 * nome e do status. jsdom não calcula layout, então a regressão guarda a
 * ESTRUTURA da folha de estilo — empilhado por padrão, horizontal só a partir de
 * 640px — que é exatamente o que estava errado.
 */
const cssPath = fileURLToPath(new URL('../styles/global.css', import.meta.url));

function blocks(css: string): { base: string; wide: string } {
  const start = css.indexOf('@media (min-width: 640px)');
  expect(start).toBeGreaterThan(0);
  let depth = 0;
  let end = start;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  return { base: css.slice(0, start) + css.slice(end), wide: css.slice(start, end) };
}

function rule(css: string, selector: string): string {
  const match = new RegExp(`(^|[\\s,}])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (match === null) throw new Error(`Regra ausente: ${selector}`);
  return match[2] ?? '';
}

describe('layout do seletor de amigo no desafio', () => {
  it('empilha identidade e ações no celular e só vira linha a partir de 640px', async () => {
    const css = await readFile(cssPath, 'utf8');
    const { base, wide } = blocks(css);

    // Mobile: duas colunas (avatar + identidade); as ações ocupam a linha inteira.
    expect(rule(base, '.challenge-friend')).toContain('grid-template-columns: auto minmax(0, 1fr)');
    expect(rule(base, '.challenge-friend__actions')).toContain('grid-column: 1 / -1');

    // Desktop/tablet: terceira coluna para as ações, sem quebra de linha.
    expect(rule(wide, '.challenge-friend')).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(rule(wide, '.challenge-friend__actions')).toContain('grid-column: auto');
  });

  it('protege o nome do amigo contra estouro horizontal', async () => {
    const css = await readFile(cssPath, 'utf8');
    const { base } = blocks(css);
    expect(rule(base, '.challenge-friend__identity')).toContain('min-width: 0');
    expect(css).toContain('.challenge-friend__identity strong { min-width: 0; overflow-wrap: anywhere;');
  });

  it('a espera do convite direto é modal e não um rodapé que o app cobre', async () => {
    const css = await readFile(cssPath, 'utf8');
    expect(css).toContain('.dialog--waiting');
  });
});
