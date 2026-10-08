import { describe, expect, it } from 'vitest';
import {
  DIVISION_THRESHOLDS,
  EMPTY_THEME_PROGRESS,
  achievementsFor,
  applyRankedOutcome,
  themeAchievementHint,
  themeAchievementProgress,
  themeAchievementTitle,
  globalAchievementTitle,
  parsePlayerTitle,
  parseTitleId,
  themeTitleId,
  topChangeMessage,
  topTitleTier,
  type RankedOutcome,
} from '../index.js';

const base: RankedOutcome = {
  knowledgeAfter: 75, knowledgeBefore: 0, opponentKnowledgeBefore: 0, opponentScore: 60, result: 'WIN', score: 90,
};

describe('conquistas por tema', () => {
  it('primeira vitória Rankeada conta a partida e começa as sequências', () => {
    const { earned, progress } = applyRankedOutcome(EMPTY_THEME_PROGRESS, base);
    expect(earned).toContain('FIRST_WIN');
    expect(progress).toEqual({ bestDivision: 0, completedRanked: 1, unbeatenMatches: 1, unbeatenWins: 1, winStreak: 1 });
  });

  it('empate quebra a sequência de vitórias mas não o invicto; derrota e abandono quebram os dois', () => {
    const start = { ...EMPTY_THEME_PROGRESS, completedRanked: 4, unbeatenMatches: 4, unbeatenWins: 3, winStreak: 3 };
    const draw = applyRankedOutcome(start, { ...base, result: 'DRAW' }).progress;
    expect(draw).toMatchObject({ completedRanked: 5, unbeatenMatches: 5, unbeatenWins: 3, winStreak: 0 });
    const loss = applyRankedOutcome(start, { ...base, result: 'LOSS' }).progress;
    expect(loss).toMatchObject({ completedRanked: 5, unbeatenMatches: 0, unbeatenWins: 0, winStreak: 0 });
    const abandoned = applyRankedOutcome(start, { ...base, result: 'ABANDONED' }).progress;
    expect(abandoned).toMatchObject({ completedRanked: 4, unbeatenMatches: 0, winStreak: 0 });
  });

  it('invicto exige 10 sem perder e pelo menos 5 vitórias', () => {
    expect(achievementsFor({ ...EMPTY_THEME_PROGRESS, unbeatenMatches: 10, unbeatenWins: 4 })).not.toContain('UNBEATEN_10');
    expect(achievementsFor({ ...EMPTY_THEME_PROGRESS, unbeatenMatches: 10, unbeatenWins: 5 })).toContain('UNBEATEN_10');
  });

  it('chegar a uma liga garante as anteriores e a primeira promoção', () => {
    const gold = DIVISION_THRESHOLDS[15]!; // Ouro V
    const { earned } = applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, knowledgeAfter: gold, knowledgeBefore: gold - 50 });
    expect(earned).toEqual(expect.arrayContaining(['FIRST_PROMOTION', 'TIER_BRONZE', 'TIER_SILVER', 'TIER_GOLD']));
    expect(earned).not.toContain('TIER_PLATINUM');
  });

  it('cair depois não tira a liga alcançada', () => {
    const gold = DIVISION_THRESHOLDS[15]!;
    const reached = applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, knowledgeAfter: gold, knowledgeBefore: gold - 50 }).progress;
    const fell = applyRankedOutcome(reached, { ...base, knowledgeAfter: gold - 40, knowledgeBefore: gold, result: 'LOSS' });
    expect(fell.earned).toContain('TIER_GOLD');
  });

  it('derrubador de gigantes: adversário começou pelo menos 2 divisões acima', () => {
    const two = DIVISION_THRESHOLDS[2]!;
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentKnowledgeBefore: two }).earned).toContain('GIANT_SLAYER');
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentKnowledgeBefore: DIVISION_THRESHOLDS[1]! }).earned).not.toContain('GIANT_SLAYER');
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentKnowledgeBefore: two, result: 'LOSS' }).earned).not.toContain('GIANT_SLAYER');
  });

  it('atropelo: dobro dos pontos e pelo menos 100', () => {
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentScore: 50, score: 100 }).earned).toContain('ROUT');
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentScore: 20, score: 60 }).earned).not.toContain('ROUT');
    expect(applyRankedOutcome(EMPTY_THEME_PROGRESS, { ...base, opponentScore: 60, score: 110 }).earned).not.toContain('ROUT');
  });

  it('marcos de partidas e de vitórias seguidas', () => {
    expect(achievementsFor({ ...EMPTY_THEME_PROGRESS, completedRanked: 100, winStreak: 5 }))
      .toEqual(expect.arrayContaining(['PLAYED_10', 'PLAYED_50', 'PLAYED_100', 'WIN_STREAK_5']));
    expect(achievementsFor({ ...EMPTY_THEME_PROGRESS, completedRanked: 100 })).not.toContain('PLAYED_500');
  });

  it('títulos, dicas e progresso escritos para gente', () => {
    expect(themeAchievementTitle('TIER_GOLD', 'Lost')).toBe('Ouro em Lost');
    expect(themeAchievementTitle('WIN_STREAK_10', 'Naruto')).toBe('Imparável em Naruto');
    expect(themeAchievementHint('PLAYED_100')).toBe('Conclua 100 Rankeadas neste tema');
    expect(themeAchievementProgress('WIN_STREAK_10', { knowledge: 0, progress: { ...EMPTY_THEME_PROGRESS, winStreak: 7 }, wins: 7 }))
      .toEqual({ ratio: 0.7, text: '7 de 10 vitórias seguidas' });
    expect(themeAchievementProgress('TIER_BRONZE', { knowledge: 2_000, progress: EMPTY_THEME_PROGRESS, wins: 0 }).text)
      .toBe('faltam 500 de Conhecimento');
  });

  it('faixa do título de Top', () => {
    expect([1, 2, 3, 4, 10].map(topTitleTier)).toEqual(['gold', 'silver', 'bronze', 'top', 'top']);
  });

  it('identificadores de título vão e voltam; lixo é recusado', () => {
    expect(parseTitleId(themeTitleId('tema-1', 'TIER_GOLD'))).toEqual({ achievementId: 'TIER_GOLD', kind: 'THEME', themeId: 'tema-1' });
    expect(parseTitleId('G:STREAK_7')).toEqual({ achievementId: 'STREAK_7', kind: 'GLOBAL' });
    expect(parseTitleId('T:tema-1:NAO_EXISTE')).toBeNull();
    expect(parseTitleId('G:QUALQUER')).toBeNull();
    expect(parseTitleId('qualquer')).toBeNull();
    expect(globalAchievementTitle('STREAK_200')).toBe('200 dias em chamas');
  });

  it('frase do Top depois da partida: só fatos, sem drama', () => {
    expect(topChangeMessage({ after: 2, before: 2 }, 'Lost')).toBeNull();
    expect(topChangeMessage({ after: null, before: null }, 'Lost')).toBeNull();
    expect(topChangeMessage({ after: 7, before: null }, 'Lost')).toBe('Você entrou no Top 10 em Lost, na posição #7');
    expect(topChangeMessage({ after: 1, before: 3 }, 'Lost')).toBe('Você é o Top 1 em Lost');
    expect(topChangeMessage({ after: 3, before: 5 }, 'Lost')).toBe('Você subiu para #3 em Lost');
    expect(topChangeMessage({ after: 2, before: 1 }, 'Lost')).toBe('Sua posição agora é #2 em Lost');
    expect(topChangeMessage({ after: null, before: 9 }, 'Lost')).toBe('Você saiu do Top 10 em Lost');
  });

  it('título vindo da rede só passa com formato válido', () => {
    expect(parsePlayerTitle({ label: 'Top 1 em Lost', position: 1, style: 'gold' })).toEqual({ label: 'Top 1 em Lost', position: 1, style: 'gold' });
    expect(parsePlayerTitle({ label: 'Ouro em Lost', style: 'rank' })).toEqual({ label: 'Ouro em Lost', style: 'rank' });
    expect(parsePlayerTitle({ label: 'x', style: 'diamante' })).toBeNull();
    expect(parsePlayerTitle({ label: '', style: 'gold' })).toBeNull();
    expect(parsePlayerTitle(null)).toBeNull();
  });
});
