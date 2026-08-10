import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@quiz-gomes/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      include: ['packages/domain/src/**', 'apps/worker/src/**'],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: ['{apps,packages}/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
  },
});
