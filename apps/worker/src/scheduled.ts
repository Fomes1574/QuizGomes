import type { Env } from './env.js';
import { RetentionService } from './services/retention-service.js';

/** Limpeza de hora em hora, em lotes pequenos (ver RetentionService). Igual ao wrangler.jsonc. */
export const RETENTION_CRON = '17 * * * *';

export async function runScheduled(
  controller: Pick<ScheduledController, 'cron' | 'scheduledTime'>,
  env: Env,
): Promise<void> {
  if (controller.cron === RETENTION_CRON) {
    const report = await new RetentionService(env.CORE_DB, env.QUESTIONS_DB).run(controller.scheduledTime);
    console.log(JSON.stringify({ event: 'retention', ...report }));
  }
}
