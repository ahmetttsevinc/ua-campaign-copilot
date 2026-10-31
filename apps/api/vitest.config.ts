import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // DB-backed tests share one seeded database; running files serially keeps them independent.
    fileParallelism: false,
  },
});
