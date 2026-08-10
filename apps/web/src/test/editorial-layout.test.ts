import { describe, expect, it } from 'vitest';
import { validateEditorialLayout } from '../lib/editorial-layout.js';

const monoMeasure = (text: string) => text.length * 8;

describe('validador editorial visual', () => {
  it('usa largura medida e aprova conteúdo compacto', () => {
    const result = validateEditorialLayout(
      'Pergunta curta e legível?',
      ['Resposta um', 'Resposta dois', 'Resposta três', 'Resposta quatro'],
      monoMeasure,
      monoMeasure,
    );
    expect(result.publishable).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('sinaliza pergunta acima de três linhas', () => {
    const result = validateEditorialLayout(
      'Uma pergunta propositalmente muito extensa para ocupar várias linhas no menor viewport suportado pelo aplicativo de teste',
      ['A', 'B', 'C', 'D'],
      monoMeasure,
      monoMeasure,
    );
    expect(result.flags).toContain('PROMPT_TOO_TALL');
  });

  it('não decide somente por caracteres e sinaliza resposta visualmente larga', () => {
    const variableMeasure = (text: string) => [...text].reduce((width, character) => width + (character === 'W' ? 18 : 5), 0);
    const result = validateEditorialLayout(
      'Pergunta?',
      ['WWWW WWWW WWWW', 'curta', 'curta', 'curta'],
      variableMeasure,
      variableMeasure,
    );
    expect(result.flags).toContain('ANSWER_TOO_TALL');
  });
});
