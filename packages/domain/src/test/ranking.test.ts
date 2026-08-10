import { describe, expect, it } from 'vitest';
import {
  CHALLENGER_I_THRESHOLD,
  DIVISION_THRESHOLDS,
  KNOWLEDGE_CAP,
  categoryAverage,
  competitionPositions,
  perfectHardWinsToChallengerI,
  rankForKnowledge,
  rankedAbandonmentLoss,
  resolveKnowledge,
} from '../index.js';

describe('ranking por tema', () => {
  it('possui 40 divisões e soma 105.500 até Desafiante I', () => {
    expect(DIVISION_THRESHOLDS).toHaveLength(40);
    expect(DIVISION_THRESHOLDS.at(-1)).toBe(CHALLENGER_I_THRESHOLD);
  });

  it('troca exatamente em cada threshold', () => {
    DIVISION_THRESHOLDS.forEach((threshold, index) => {
      expect(rankForKnowledge(threshold).divisionIndex).toBe(index);
      if (threshold > 0) expect(rankForKnowledge(threshold - 1).divisionIndex).toBe(index - 1);
    });
  });

  it('preserva overflow de promoção', () => {
    const result = resolveKnowledge(290, 'HARD', 'WIN', 'RANKED');
    expect(result.after.knowledge).toBe(365);
    expect(result.after.tier).toBe('Latão');
    expect(result.after.division).toBe('IV');
    expect(result.after.progressInDivision).toBe(65);
  });

  it('permite rebaixamento e respeita o piso absoluto', () => {
    expect(resolveKnowledge(300, 'HARD', 'LOSS', 'RANKED').after.knowledge).toBe(270);
    expect(resolveKnowledge(5, 'HARD', 'LOSS', 'RANKED').after.knowledge).toBe(0);
    expect(rankForKnowledge(0)).toMatchObject({ tier: 'Latão', division: 'V' });
  });

  it('aplica a tabela pelo elo anterior à resolução', () => {
    expect(resolveKnowledge(2_499, 'EASY', 'WIN', 'RANKED').requestedDelta).toBe(25);
    expect(resolveKnowledge(2_500, 'EASY', 'WIN', 'RANKED').requestedDelta).toBe(23);
    expect(resolveKnowledge(37_500, 'MEDIUM', 'LOSS', 'RANKED').requestedDelta).toBe(-30);
  });

  it('não altera Conhecimento em empate, anulada ou Casual', () => {
    expect(resolveKnowledge(1_000, 'HARD', 'DRAW', 'RANKED').appliedDelta).toBe(0);
    expect(resolveKnowledge(1_000, 'HARD', 'VOID', 'RANKED').appliedDelta).toBe(0);
    expect(resolveKnowledge(1_000, 'HARD', 'WIN', 'CASUAL').appliedDelta).toBe(0);
  });

  it('mantém cap 999.999 sem pontos ocultos e permite perder no cap', () => {
    expect(resolveKnowledge(KNOWLEDGE_CAP, 'HARD', 'WIN', 'RANKED').appliedDelta).toBe(0);
    const loss = resolveKnowledge(KNOWLEDGE_CAP, 'HARD', 'LOSS', 'RANKED');
    expect(loss.requestedDelta).toBe(-54);
    expect(loss.after.knowledge).toBe(999_945);
  });

  it('usa derrota Média no abandono ranqueado', () => {
    expect(rankedAbandonmentLoss(0).requestedDelta).toBe(-20);
    expect(rankedAbandonmentLoss(CHALLENGER_I_THRESHOLD).requestedDelta).toBe(-36);
  });

  it('exige aproximadamente 2.457 vitórias difíceis perfeitas', () => {
    const wins = perfectHardWinsToChallengerI();
    expect(wins).toBe(2_457);
    expect(wins).toBeGreaterThanOrEqual(1_000);
  });

  it('calcula média somente com temas que tiveram ranqueada', () => {
    const average = categoryAverage([
      { knowledge: 0, rankedMatches: 0 },
      { knowledge: 300, rankedMatches: 1 },
      { knowledge: 700, rankedMatches: 4 },
    ]);
    expect(average).not.toBeNull();
    expect(average?.sampledThemes).toBe(2);
    expect(average?.rank.divisionIndex).toBe(1);
    expect(categoryAverage([{ knowledge: 999_999, rankedMatches: 0 }])).toBeNull();
  });

  it('atribui a mesma posição lógica para Conhecimento igual', () => {
    expect(competitionPositions([900, 700, 700, 100])).toEqual([1, 2, 2, 4]);
  });
});
