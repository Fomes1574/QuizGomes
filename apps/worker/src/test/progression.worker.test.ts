import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { MissionRepository } from '../repositories/mission-repository.js';
import { StreakRepository } from '../repositories/streak-repository.js';
import { recordValidPlay } from '../services/progression-service.js';
import { fixture, themeIdOf, userAt } from './challenge-fixture.worker.js';

describe('M11 — missões diárias', () => {
  it('gera as três missões do dia sob demanda, uma vez por usuário/dia, e nunca reabre uma completa', async () => {
    const { users } = await fixture(1);
    const user = userAt(users, 0);
    const missions = new MissionRepository(env.CORE_DB);
    const dayKey = '2026-01-01';

    const first = await missions.listForDay(user.id, dayKey);
    expect(first).toEqual([
      { completedAt: null, progress: 0, target: 1, type: 'PLAY_MATCH' },
      { completedAt: null, progress: 0, target: 8, type: 'ANSWER_QUESTIONS' },
      { completedAt: null, progress: 0, target: 5, type: 'CORRECT_ANSWERS' },
    ]);
    // Ler de novo no mesmo dia não recria nem duplica as linhas.
    await missions.listForDay(user.id, dayKey);
    const rowCount = await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM user_daily_missions WHERE user_id = ?1 AND day_key = ?2',
    ).bind(user.id, dayKey).first<{ total: number }>();
    expect(rowCount?.total).toBe(3);

    await missions.advance(user.id, dayKey, { correctAnswers: 5, playedValidMatch: true, totalAnswers: 8 });
    const afterFirstEvent = await missions.listForDay(user.id, dayKey);
    expect(afterFirstEvent.every((mission) => mission.completedAt !== null)).toBe(true);
    expect(afterFirstEvent).toEqual(expect.arrayContaining([
      expect.objectContaining({ progress: 1, target: 1, type: 'PLAY_MATCH' }),
      expect.objectContaining({ progress: 8, target: 8, type: 'ANSWER_QUESTIONS' }),
      expect.objectContaining({ progress: 5, target: 5, type: 'CORRECT_ANSWERS' }),
    ]));

    // Um segundo evento não regride nem ultrapassa a meta de nenhuma missão já completa.
    await missions.advance(user.id, dayKey, { correctAnswers: 5, playedValidMatch: true, totalAnswers: 8 });
    const afterSecondEvent = await missions.listForDay(user.id, dayKey);
    expect(afterSecondEvent).toEqual(afterFirstEvent);
  });

  it('satura no alvo sem completar antes da hora e mantém o completedAt original', async () => {
    const { users } = await fixture(1);
    const user = userAt(users, 0);
    const missions = new MissionRepository(env.CORE_DB);
    const dayKey = '2026-01-02';
    await missions.listForDay(user.id, dayKey);

    await missions.advance(user.id, dayKey, { correctAnswers: 0, playedValidMatch: false, totalAnswers: 3 });
    let state = await missions.listForDay(user.id, dayKey);
    const answerQuestions = () => state.find((mission) => mission.type === 'ANSWER_QUESTIONS');
    expect(answerQuestions()).toMatchObject({ completedAt: null, progress: 3 });

    await missions.advance(user.id, dayKey, { correctAnswers: 0, playedValidMatch: false, totalAnswers: 10 });
    state = await missions.listForDay(user.id, dayKey);
    expect(answerQuestions()).toMatchObject({ progress: 8 });
    expect(answerQuestions()?.completedAt).not.toBeNull();
    const completedAt = answerQuestions()?.completedAt;

    await missions.advance(user.id, dayKey, { correctAnswers: 0, playedValidMatch: false, totalAnswers: 4 });
    state = await missions.listForDay(user.id, dayKey);
    expect(answerQuestions()).toMatchObject({ completedAt, progress: 8 });
  });

  it('missões de dois usuários, ou do mesmo usuário em dias diferentes, são independentes', async () => {
    const { users } = await fixture(2);
    const first = userAt(users, 0);
    const second = userAt(users, 1);
    const missions = new MissionRepository(env.CORE_DB);
    await missions.advance(first.id, '2026-01-03', { correctAnswers: 1, playedValidMatch: true, totalAnswers: 1 });

    const secondUserSameDay = await missions.listForDay(second.id, '2026-01-03');
    expect(secondUserSameDay.every((mission) => mission.progress === 0)).toBe(true);

    const firstUserOtherDay = await missions.listForDay(first.id, '2026-01-04');
    expect(firstUserOtherDay.every((mission) => mission.progress === 0)).toBe(true);
  });
});

describe('M11 — streak por usuário+tema', () => {
  it('primeira atividade cria current=best=1; repetir no mesmo dia é idempotente', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const themeId = await themeIdOf(themeSlug);
    const streaks = new StreakRepository(env.CORE_DB);

    await streaks.advance(user.id, themeId, '2026-02-01');
    expect(await streaks.forTheme(user.id, themeId)).toEqual({
      bestStreak: 1, currentStreak: 1, lastActiveDay: '2026-02-01', themeId,
    });

    await streaks.advance(user.id, themeId, '2026-02-01');
    await streaks.advance(user.id, themeId, '2026-02-01');
    expect(await streaks.forTheme(user.id, themeId)).toEqual({
      bestStreak: 1, currentStreak: 1, lastActiveDay: '2026-02-01', themeId,
    });
  });

  it('dia seguinte incrementa current e best; um salto reseta current, nunca best', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const themeId = await themeIdOf(themeSlug);
    const streaks = new StreakRepository(env.CORE_DB);

    await streaks.advance(user.id, themeId, '2026-03-01');
    await streaks.advance(user.id, themeId, '2026-03-02');
    await streaks.advance(user.id, themeId, '2026-03-03');
    expect(await streaks.forTheme(user.id, themeId)).toEqual({
      bestStreak: 3, currentStreak: 3, lastActiveDay: '2026-03-03', themeId,
    });

    // Salta um dia: o atual reseta para 1, o recorde de 3 permanece.
    await streaks.advance(user.id, themeId, '2026-03-05');
    expect(await streaks.forTheme(user.id, themeId)).toEqual({
      bestStreak: 3, currentStreak: 1, lastActiveDay: '2026-03-05', themeId,
    });
  });

  it('um dia anterior ao já registrado (fora de ordem) não altera o estado', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const themeId = await themeIdOf(themeSlug);
    const streaks = new StreakRepository(env.CORE_DB);

    await streaks.advance(user.id, themeId, '2026-04-10');
    await streaks.advance(user.id, themeId, '2026-04-05');
    expect(await streaks.forTheme(user.id, themeId)).toEqual({
      bestStreak: 1, currentStreak: 1, lastActiveDay: '2026-04-10', themeId,
    });
  });

  it('activeStreak é o fallback determinístico: maior current, desempate por theme_id, leitura indexada', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const themeIdA = await themeIdOf(themeSlug);
    const { themeSlug: themeSlugB } = await fixture(0);
    const themeIdB = await themeIdOf(themeSlugB);
    const streaks = new StreakRepository(env.CORE_DB);

    expect(await streaks.activeStreak(user.id)).toBeNull();

    await streaks.advance(user.id, themeIdA, '2026-05-01');
    await streaks.advance(user.id, themeIdB, '2026-05-01');
    await streaks.advance(user.id, themeIdB, '2026-05-02');
    // Tema B tem current=2 > tema A com current=1: B vence.
    expect(await streaks.activeStreak(user.id)).toMatchObject({ currentStreak: 2, themeId: themeIdB });
  });
});

describe('M11 — recordValidPlay (serviço best-effort de progressão)', () => {
  it('avança missão e streak juntos a partir de um evento válido', async () => {
    const { users, themeSlug } = await fixture(1);
    const user = userAt(users, 0);
    const themeId = await themeIdOf(themeSlug);
    const nowMs = Date.parse('2026-06-15T12:00:00.000Z');

    await recordValidPlay(env.CORE_DB, {
      correctAnswers: 2, nowMs, themeId, totalAnswers: 3, userId: user.id,
    });

    const missions = new MissionRepository(env.CORE_DB);
    expect(await missions.listForDay(user.id, '2026-06-15')).toEqual(expect.arrayContaining([
      expect.objectContaining({ progress: 1, type: 'PLAY_MATCH' }),
      expect.objectContaining({ progress: 3, type: 'ANSWER_QUESTIONS' }),
      expect.objectContaining({ progress: 2, type: 'CORRECT_ANSWERS' }),
    ]));
    const streaks = new StreakRepository(env.CORE_DB);
    expect(await streaks.forTheme(user.id, themeId)).toMatchObject({ bestStreak: 1, currentStreak: 1 });
  });

  it('nunca lança: um usuário/tema inexistente é engolido como falha best-effort', async () => {
    await expect(recordValidPlay(env.CORE_DB, {
      correctAnswers: 1, nowMs: Date.now(), themeId: 'tema-fantasma', totalAnswers: 1, userId: 'usuario-fantasma',
    })).resolves.toBeUndefined();
  });
});
