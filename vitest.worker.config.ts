import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './apps/worker/src/index.ts',
      miniflare: {
        bindings: {
          TEST_CORE_MIGRATIONS: await readD1Migrations(`${projectRoot}apps/worker/migrations/core`),
          TEST_QUESTION_MIGRATIONS: await readD1Migrations(`${projectRoot}apps/worker/migrations/questions`),
        },
      },
      wrangler: { configPath: './apps/worker/wrangler.jsonc' },
    })),
  ],
  resolve: {
    alias: {
      '@quiz-gomes/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['apps/worker/src/**/*.worker.test.ts'],
    setupFiles: ['./apps/worker/src/test/setup.worker.ts'],
    testTimeout: 20_000,
  },
});
