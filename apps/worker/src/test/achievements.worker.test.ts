import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { AchievementRepository } from '../repositories/achievement-repository.js';
import { ProfileHistoryRepository } from '../repositories/profile-history-repository.js';
import { StreakReminderRepository } from '../repositories/streak-reminder-repository.js';
import { sendStreakReminders } from '../scheduled.js';
import type { SocialPushService } from '../services/social-push-service.js';
import { issueRealFirebaseTestToken } from './firebase-test-token.js';
import { fixture, themeIdOf, userAt, type FixtureUser } from './challenge-fixture.worker.js';

async function setStreak(user: FixtureUser, themeId: string, current: number, lastActiveDay: string): Promise<void> {
  await env.CORE_DB.prepare(
    `INSERT INTO user_theme_streaks (user_id, theme_id, current_streak, best_streak, last_active_day)
     VALUES (?1, ?2, ?3, ?3, ?4)
     ON CONFLICT (user_id, theme_id) DO UPDATE SET current_streak = ?3, best_streak = MAX(best_streak, ?3), last_active_day = ?4`,
  ).bind(user.id, themeId, current, lastActiveDay).run();
}

async function inventory(user: FixtureUser): Promise<string[]> {
  const rows = await env.CORE_DB.prepare('SELECT cosmetic_id FROM cosmetic_inventory WHERE user_id = ?1 ORDER BY cosmetic_id')
    .bind(user.id).all<{ cosmetic_id: string }>();
  return rows.results.map((row) => row.cosmetic_id);
}

async function oneUser(): Promise<{ themeId: string; user: FixtureUser }> {
  const { themeSlug, users } = await fixture(1);
  return { themeId: await themeIdOf(themeSlug), user: userAt(users, 0) };
}

describe('Conquistas e molduras', () => {
  it('7 dias de ofensiva dão conquista e moldura uma única vez', async () => {
    const { themeId, user } = await oneUser();
    const achievements = new AchievementRepository(env.CORE_DB);
    await setStreak(user, themeId, 6, '2026-09-20');
    expect(await achievements.evaluateProgress(user.id, themeId, '2026-09-20')).toEqual([]);
    await setStreak(user, themeId, 7, '2026-09-21');
    expect(await achievements.evaluateProgress(user.id, themeId, '2026-09-21')).toEqual(['STREAK_7']);
    expect(await achievements.evaluateProgress(user.id, themeId, '2026-09-21')).toEqual([]);
    expect(await inventory(user)).toEqual(['frame-streak-7']);
  });

  it('marcos de 100 dias, 1 ano e 2 anos, cada um com seu cartão', async () => {
    const { themeId, user } = await oneUser();
    const achievements = new AchievementRepository(env.CORE_DB);
    await setStreak(user, themeId, 730, '2026-09-21');
    const earned = await achievements.evaluateProgress(user.id, themeId, '2026-09-21');
    expect(earned).toEqual(expect.arrayContaining(['STREAK_7', 'STREAK_100', 'STREAK_700', 'STREAK_365', 'STREAK_730']));
    expect(await inventory(user)).toEqual(['frame-streak-100', 'frame-streak-365', 'frame-streak-7', 'frame-streak-730']);
    const unseen = await achievements.unseen(user.id);
    expect(unseen).toHaveLength(5);
    await achievements.markSeen(user.id, unseen.map((item) => item.achievementId));
    expect((await achievements.unseen(user.id)).length).toBeGreaterThan(0);
  });

  it('as três missões do dia completas valem "Dia completo"', async () => {
    const { themeId, user } = await oneUser();
    const day = '2026-09-22';
    await env.CORE_DB.batch(['PLAY_MATCH', 'ANSWER_QUESTIONS', 'CORRECT_ANSWERS'].map((type) => env.CORE_DB.prepare(
      `INSERT INTO user_daily_missions (user_id, day_key, mission_type, target, progress, completed_at)
       VALUES (?1, ?2, ?3, 1, 1, ?4)`,
    ).bind(user.id, day, type, type === 'CORRECT_ANSWERS' ? null : '2026-09-22T12:00:00.000Z')));
    const achievements = new AchievementRepository(env.CORE_DB);
    expect(await achievements.evaluateProgress(user.id, themeId, day)).toEqual([]);
    await env.CORE_DB.prepare(
      "UPDATE user_daily_missions SET completed_at = '2026-09-22T13:00:00.000Z' WHERE user_id = ?1",
    ).bind(user.id).run();
    expect(await achievements.evaluateProgress(user.id, themeId, day)).toEqual(['MISSIONS_DAY']);
  });

  it('só equipa moldura que a pessoa ganhou', async () => {
    const { themeId, user } = await oneUser();
    const achievements = new AchievementRepository(env.CORE_DB);
    expect(await achievements.equipFrame(user.id, 'frame-streak-7')).toBe(false);
    await setStreak(user, themeId, 7, '2026-09-21');
    await achievements.evaluateProgress(user.id, themeId, '2026-09-21');
    expect(await achievements.equipFrame(user.id, 'frame-streak-7')).toBe(true);
    expect(await achievements.frames(user.id, 'frame-streak-7')).toEqual([{ equipped: true, id: 'frame-streak-7', name: 'Chama acesa' }]);
    expect(await achievements.equipFrame(user.id, 'frame-inexistente')).toBe(false);
    expect(await achievements.equipFrame(user.id, null)).toBe(true);
  });

  it('"Recordista" exige já ter jogado aquele tema e modo antes', async () => {
    const { users, themeSlug } = await fixture(2);
    const themeId = await themeIdOf(themeSlug);
    const [first, second] = [userAt(users, 0), userAt(users, 1)];
    const achievements = new AchievementRepository(env.CORE_DB);
    const finished = async () => {
      const matchId = crypto.randomUUID();
      await env.CORE_DB.batch([
        env.CORE_DB.prepare(
          `INSERT INTO matches (id, theme_id, difficulty, mode, kind, status, question_shard_id, winner_user_id)
           VALUES (?1, ?2, 'MEDIUM', 'CASUAL', 'MATCHMAKING', 'FINISHED', 'questions-01', ?3)`,
        ).bind(matchId, themeId, first.id),
        env.CORE_DB.prepare(
          "INSERT INTO match_players (match_id, user_id, seat, score, completed_at) VALUES (?1, ?2, 1, 90, CURRENT_TIMESTAMP)",
        ).bind(matchId, first.id),
        env.CORE_DB.prepare(
          "INSERT INTO match_players (match_id, user_id, seat, score, completed_at) VALUES (?1, ?2, 2, 40, CURRENT_TIMESTAMP)",
        ).bind(matchId, second.id),
      ]);
    };
    await finished();
    expect(await achievements.evaluatePersonalRecord(first.id, themeId, 'CASUAL')).toEqual([]);
    await finished();
    expect(await achievements.evaluatePersonalRecord(first.id, themeId, 'CASUAL')).toEqual(['PERSONAL_RECORD']);
    expect(await achievements.evaluatePersonalRecord(first.id, themeId, 'CASUAL')).toEqual([]);

    // O histórico do perfil mostra as partidas com o adversário.
    const recent = await new ProfileHistoryRepository(env.CORE_DB).recentMatches(second.id);
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ mode: 'CASUAL', myScore: 40, opponentScore: 90, result: 'LOSS' });
    expect(recent[0]?.opponent?.publicId).toBe(first.publicId);
  });
});

describe('Aviso de ofensiva em risco', () => {
  it('avisa uma vez por dia só quem ligou e jogou ontem, com a maior ofensiva', async () => {
    const { users, themeSlug } = await fixture(3);
    const themeId = await themeIdOf(themeSlug);
    const { themeSlug: otherSlug } = await fixture(0);
    const otherThemeId = await themeIdOf(otherSlug);
    const [atRisk, playedToday, optedOut] = [userAt(users, 0), userAt(users, 1), userAt(users, 2)];
    const reminders = new StreakReminderRepository(env.CORE_DB);
    const today = '2031-01-10';
    await reminders.setEnabled(atRisk.id, true);
    await reminders.setEnabled(playedToday.id, true);
    await setStreak(atRisk, themeId, 4, '2031-01-09');
    await setStreak(atRisk, otherThemeId, 9, '2031-01-09');
    await setStreak(playedToday, themeId, 5, '2031-01-10');
    await setStreak(optedOut, themeId, 12, '2031-01-09');

    const candidates = await reminders.candidates(today, 50);
    const mine = candidates.filter((candidate) => [atRisk.id, playedToday.id, optedOut.id].includes(candidate.userId));
    expect(mine).toEqual([expect.objectContaining({ streak: 9, userId: atRisk.id })]);

    const sent: string[] = [];
    const push = {
      configured: true,
      sendStreakReminders: (input: { recipients: Array<{ userId: string }> }) => {
        sent.push(...input.recipients.map((recipient) => recipient.userId));
        return Promise.resolve(input.recipients.length);
      },
    } as unknown as SocialPushService;
    const nowMs = Date.parse('2031-01-10T23:05:00.000Z');
    await sendStreakReminders(env, nowMs, push);
    expect(sent).toContain(atRisk.id);
    sent.length = 0;
    await sendStreakReminders(env, nowMs, push);
    expect(sent).not.toContain(atRisk.id);
  });
});

describe('Perfil pela API', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('resumo traz histórico, recordes e conquistas; parabéns somem depois de vistos; aviso liga e desliga', async () => {
    const uid = `achievements-${crypto.randomUUID()}`;
    const session = await issueRealFirebaseTestToken(uid);
    restore = session.restore;
    const auth = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    const created = await SELF.fetch('https://quiz.test/api/profile/me', {
      body: JSON.stringify({ displayName: 'Chama Viva' }), headers: auth, method: 'POST',
    });
    expect(created.status).toBe(201);
    const summary = await (await SELF.fetch('https://quiz.test/api/profile/summary', { headers: auth })).json<Record<string, unknown>>();
    expect(summary).toMatchObject({
      achievements: [], casualSummary: { matches: 0 }, frames: [], recentMatches: [], streakReminder: false, themeRecords: [],
    });
    expect(typeof summary.missionsResetAt).toBe('string');

    const userId = (await env.CORE_DB.prepare('SELECT id FROM users WHERE firebase_uid = ?1').bind(uid).first<{ id: string }>())?.id;
    if (userId === undefined) throw new Error('Usuário ausente.');
    await new AchievementRepository(env.CORE_DB).grant(userId, [{ achievementId: 'STREAK_100', value: 100 }]);
    const celebrations = await (await SELF.fetch('https://quiz.test/api/profile/celebrations', { headers: auth }))
      .json<{ celebrations: Array<{ achievementId: string; frameId: string | null }> }>();
    expect(celebrations.celebrations).toEqual([expect.objectContaining({ achievementId: 'STREAK_100', frameId: 'frame-streak-100' })]);
    await SELF.fetch('https://quiz.test/api/profile/celebrations', {
      body: JSON.stringify({ achievementIds: ['STREAK_100'] }), headers: auth, method: 'POST',
    });
    const after = await (await SELF.fetch('https://quiz.test/api/profile/celebrations', { headers: auth })).json<{ celebrations: unknown[] }>();
    expect(after.celebrations).toEqual([]);

    const equip = await SELF.fetch('https://quiz.test/api/profile/frame', {
      body: JSON.stringify({ frameId: 'frame-streak-100' }), headers: auth, method: 'PUT',
    });
    expect(equip.status).toBe(200);
    const denied = await SELF.fetch('https://quiz.test/api/profile/frame', {
      body: JSON.stringify({ frameId: 'frame-streak-730' }), headers: auth, method: 'PUT',
    });
    expect(denied.status).toBe(403);

    const toggle = await SELF.fetch('https://quiz.test/api/profile/streak-reminder', {
      body: JSON.stringify({ enabled: true }), headers: auth, method: 'PUT',
    });
    expect(await toggle.json()).toEqual({ enabled: true });
    expect(await (await SELF.fetch('https://quiz.test/api/profile/streak-reminder', { headers: auth })).json()).toEqual({ enabled: true });
  });
});
