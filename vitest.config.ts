import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points and DOM-bound client code are covered by the smoke and browser checks.
      exclude: ['src/server.ts', 'src/cli/index.ts', 'src/web/app.ts', 'src/web/dom.ts', 'src/web/api.ts', 'src/web/theme.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
});
