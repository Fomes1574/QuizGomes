import { gameDayKey } from '@quiz-gomes/domain';
import type { Env } from './env.js';
import { SocialRepository } from './repositories/social-repository.js';
import { StreakReminderRepository } from './repositories/streak-reminder-repository.js';
import { RetentionService } from './services/retention-service.js';
import { SocialPushService } from './services/social-push-service.js';

/** Limpeza de hora em hora, em lotes pequenos (ver RetentionService). Igual ao wrangler.jsonc. */
export const RETENTION_CRON = '17 * * * *';
/**
 * Aviso de ofensiva: 20h05, 20h20, 20h35 e 20h50 de Brasília (23h UTC).
 * Várias rodadas pequenas cabem no limite de chamadas por execução do plano
 * gratuito; quem já recebeu hoje não entra de novo.
 */
export const STREAK_REMINDER_CRON = '5,20,35,50 23 * * *';
const STREAK_REMINDERS_PER_RUN = 25;
const STREAK_PUSHES_PER_RUN = 35;

export async function runScheduled(
  controller: Pick<ScheduledController, 'cron' | 'scheduledTime'>,
  env: Env,
): Promise<void> {
  if (controller.cron === RETENTION_CRON) {
    const report = await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(controller.scheduledTime);
    console.log(JSON.stringify({ event: 'retention', ...report }));
    return;
  }
  if (controller.cron === STREAK_REMINDER_CRON) {
    const sent = await sendStreakReminders(env, controller.scheduledTime);
    console.log(JSON.stringify({ event: 'streak_reminder', sent }));
  }
}

export async function sendStreakReminders(env: Env, nowMs: number, push?: SocialPushService): Promise<number> {
  const service = push ?? new SocialPushService(env, new SocialRepository(env.CORE_DB));
  if (!service.configured) return 0;
  const today = gameDayKey(nowMs);
  const reminders = new StreakReminderRepository(env.CORE_DB);
  const candidates = await reminders.candidates(today, STREAK_REMINDERS_PER_RUN);
  if (candidates.length === 0) return 0;
  // Marca antes de enviar: um retry do Cron nunca manda o mesmo aviso duas vezes.
  await reminders.markSent(candidates.map((candidate) => candidate.userId), today);
  await service.sendStreakReminders({ maxDeliveries: STREAK_PUSHES_PER_RUN, recipients: candidates });
  return candidates.length;
}
