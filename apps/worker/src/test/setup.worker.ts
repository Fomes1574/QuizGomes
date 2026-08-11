import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

await Promise.all([
  applyD1Migrations(env.CORE_DB, env.TEST_CORE_MIGRATIONS),
  applyD1Migrations(env.QUESTIONS_DB, env.TEST_QUESTION_MIGRATIONS),
]);
