import { env } from 'cloudflare:test';
import { gameWeekKey, totalXpForLevel, type RankedOutcome } from '@quiz-gomes/domain';
import { describe, expect, it } from 'vitest';
import { WeeklyMissionRepository } from '../repositories/weekly-mission-repository.js';
import { recordRankedRewards } from '../services/player-title-service.js';
import { themeTrail, titleShowcase, updateTitleShowcase } from '../services/title-showcase-service.js';
import { fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

const outcome = (overrides: Partial<RankedOutcome> = {}): RankedOutcome => ({
  knowledgeAfter: 75, knowledgeBefore: 0, opponentKnowledgeBefore: 0, opponentScore: 40, result: 'WIN', score: 90, ...overrides,
});

describe('Missões semanais da Rankeada', () => {
  it('Rankeada concluída avança uma vez; abandono e repetição não contam', async () => {
    const { themeSlug, users } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const [winner, quitter] = [userAt(users, 0), userAt(users, 1)];
    const now = Date.parse('2026-10-08T15:00:00Z');
    const matchId = crypto.randomUUID();
    await recordRankedRewards(env, matchId, themeId, [
      { correctAnswers: 7, outcome: outcome(), topBefore: null, userId: winner.id },
      { correctAnswers: 2, outcome: outcome({ knowledgeAfter: 0, result: 'ABANDONED' }), topBefore: null, userId: quitter.id },
    ], now);
    // Finalização repetida da mesma sala.
    await recordRankedRewards(env, matchId, themeId, [
      { correctAnswers: 7, outcome: outcome(), topBefore: null, userId: winner.id },
    ], now);

    const weekly = new WeeklyMissionRepository(env.CORE_DB);
    const week = gameWeekKey(now);
    expect((await weekly.list(winner.id, week)).map((mission) => [mission.type, mission.progress])).toEqual([
      ['PLAY_RANKED', 1], ['WIN_RANKED', 1], ['CORRECT_RANKED', 7],
    ]);
    expect((await weekly.list(quitter.id, week)).every((mission) => mission.progress === 0)).toBe(true);
    // Semana seguinte começa do zero.
    expect((await weekly.list(winner.id, '2026-10-12')).every((mission) => mission.progress === 0)).toBe(true);
  });
});

describe('Objetivo, títulos de nível e trilha', () => {
  it('nível vira título, o objetivo aparece com progresso e a trilha mostra o caminho', async () => {
    const { themeSlug, users } = await fixture(1);
    const themeId = await themeIdOf(themeSlug);
    const user = userAt(users, 0);
    await env.CORE_DB.prepare('UPDATE user_profiles SET total_xp = ?1 WHERE user_id = ?2')
      .bind(totalXpForLevel(12), user.id).run();
    await env.CORE_DB.batch([
      env.CORE_DB.prepare('INSERT INTO theme_rankings (user_id, theme_id, knowledge, ranked_matches, wins) VALUES (?1, ?2, 400, 3, 1)').bind(user.id, themeId),
      env.CORE_DB.prepare('INSERT INTO user_theme_progress (user_id, theme_id, completed_ranked, best_division) VALUES (?1, ?2, 3, 1)').bind(user.id, themeId),
    ]);

    const showcase = await titleShowcase(env, user.id);
    const ids = showcase.titles.map((title) => [title.id, title.locked === undefined]);
    expect(ids).toEqual(expect.arrayContaining([['N:5', true], ['N:10', true], ['N:25', false]]));
    expect(ids.some(([id]) => id === 'N:50')).toBe(false); // só o próximo marco aparece bloqueado

    await updateTitleShowcase(env, user.id, { equippedId: 'N:10' });
    await expect(updateTitleShowcase(env, user.id, { equippedId: 'N:25' })).rejects.toMatchObject({ code: 'TITLE_NOT_OWNED' });
    await expect(updateTitleShowcase(env, user.id, { goalId: 'lixo' })).rejects.toMatchObject({ code: 'GOAL_INVALID' });
    await updateTitleShowcase(env, user.id, { goalId: `T:${themeId}:TIER_BRONZE` });
    const withGoal = await titleShowcase(env, user.id);
    expect(withGoal.current?.label).toBe('Aprendiz');
    expect(withGoal.goal?.id).toBe(`T:${themeId}:TIER_BRONZE`);
    expect(withGoal.goal?.locked?.ratio).toBeGreaterThan(0);

    const trail = await themeTrail(env, user.id, themeId, 'Tema X');
    expect(trail[0]).toMatchObject({ id: `T:${themeId}:FIRST_WIN`, label: 'Estreou vencendo em Tema X', unlocked: true });
    expect(trail[1]).toMatchObject({ unlocked: true }); // primeira subida (divisão 1)
    const bronze = trail.find((step) => step.id === `T:${themeId}:TIER_BRONZE`);
    expect(bronze).toMatchObject({ progress: { text: 'faltam 2.100 de Conhecimento' }, unlocked: false });
    expect(trail).toHaveLength(18);
  });
});
