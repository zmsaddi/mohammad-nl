import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest config:
// - `@/...` path alias so unit tests can import Next.js-style paths
//   (added for BUG-02 route-error-logging tests).
// - `setupFiles` loads `.env.test` + guards POSTGRES_URL for the TEST-01
//   real-DB integration test. Mock-only tests are unaffected.
// - Long testTimeout because TEST-01 hits a remote Neon endpoint.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
  test: {
    setupFiles: ['./tests/setup.test-env.js'],
    testTimeout: 30000,
    sequence: { hooks: 'list' },
  },
});
