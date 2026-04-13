import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest config:
// - `@/...` path alias so unit tests can import Next.js-style paths
//   (added for BUG-02 route-error-logging tests).
// - `setupFiles` loads `.env.test` + guards POSTGRES_URL for the TEST-01
//   real-DB integration test. Mock-only tests are unaffected.
// - Long testTimeout because TEST-01 hits a remote Neon endpoint.
// - FEAT-05: fileParallelism disabled because two real-DB test files
//   (sale-lifecycle and feat05-cancel-sale) both TRUNCATE the same Neon
//   branch in beforeEach/beforeAll. Running them in parallel produces
//   DB race conditions where one file's truncate wipes the other file's
//   fixtures mid-test. Serial run adds ~2s to the total suite which is
//   a small cost for deterministic test outcomes.
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
    fileParallelism: false,
  },
});
