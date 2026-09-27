import { gameDayKey } from '@quiz-gomes/domain';
import { MissionRepository } from '../repositories/mission-repository.js';
import { StreakRepository } from '../repositories/streak-repository.js';
import { AchievementRepository } from '../repositories/achievement-repository.js';

export interface ValidPlayEvent {
  correctAnswers: number;
  nowMs: number;
  themeId: string;
  totalAnswers: number;
  userId: string;
}

/**
 * Registra a missão "1 partida válida" (mais o progresso das outras duas
 * pelo mesmo evento) e o streak do tema, a partir de uma partida/metade
 * genuinamente concluída — nunca VOID, cancelada ou uma corrida perdida.
 * Best-effort: nunca lança, nunca atrasa nem desfaz o resultado competitivo
 * que já foi persistido antes desta chamada.
 */
export async function recordValidPlay(coreDb: D1Database, event: ValidPlayEvent): Promise<void> {
  const dayKey = gameDayKey(event.nowMs);
  try {
    await new MissionRepository(coreDb).advance(event.userId, dayKey, {
      correctAnswers: event.correctAnswers, playedValidMatch: true, totalAnswers: event.totalAnswers,
    });
    await new StreakRepository(coreDb).advance(event.userId, event.themeId, dayKey);
  } catch {
    console.error(JSON.stringify({ code: 'PROGRESSION_RECORD_FAILED', event: 'valid_play' }));
    return;
  }
  await recordProgressAchievements(coreDb, event.userId, event.themeId, dayKey);
}

/** Conquistas de ofensiva e missões depois do progresso. Best-effort: nunca lança. */
export async function recordProgressAchievements(
  coreDb: D1Database,
  userId: string,
  themeId: string,
  dayKey: string,
): Promise<void> {
  try {
    await new AchievementRepository(coreDb).evaluateProgress(userId, themeId, dayKey);
  } catch {
    console.error(JSON.stringify({ code: 'ACHIEVEMENT_RECORD_FAILED', event: 'progress' }));
  }
}
