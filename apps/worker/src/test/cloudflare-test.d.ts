import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../env.js';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_CORE_MIGRATIONS: D1Migration[];
      TEST_QUESTION_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
