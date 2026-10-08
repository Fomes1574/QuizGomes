import { DIVISION_THRESHOLDS } from '@quiz-gomes/domain';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('migration 0022 (conquistas por tema)', () => {
  it('recupera a divisão com os mesmos limites do domínio', () => {
    const sql = readFileSync(
      new URL('../../../worker/migrations/core/0022_theme_achievements_and_titles.sql', import.meta.url),
      'utf8',
    );
    const list = /FROM \(VALUES([\s\S]*?)\) AS thresholds/.exec(sql)?.[1] ?? '';
    const values = [...list.matchAll(/\((\d+)\)/g)].map((match) => Number(match[1]));
    expect(values).toEqual([...DIVISION_THRESHOLDS]);
  });
});
