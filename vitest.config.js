import { defineConfig, configDefaults } from 'vitest/config';
import { transformWithEsbuild } from 'vite';
import path from 'path';

// This repo writes JSX inside plain `.js` files (every component/page), which
// Vite's core esbuild does not parse as JSX, and @vitejs/plugin-react's filter
// would not pick up. `jsxInJs` below runs esbuild's JSX transform (automatic
// React runtime — no `import React` needed) on our own .js/.jsx files BEFORE
// Vite's core plugins, so the tests/ui/* suite can import + render real
// components. It is scoped to project source (components/app/lib/tests) and
// skips node_modules; for non-JSX files (e.g. lib/*.js logic) the transform is
// a harmless no-op, so the existing node/real-DB suites are unaffected.
const jsxInJs = {
  name: 'jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    const [filepath] = id.split('?');
    if (filepath.includes('/node_modules/')) return null;
    if (!/\.(jsx?|tsx)$/.test(filepath)) return null;
    if (!/\/(components|app|lib|tests)\//.test(filepath.replace(/\\/g, '/'))) return null;
    return transformWithEsbuild(code, filepath, { loader: 'jsx', jsx: 'automatic' });
  },
};

// Vitest config:
// - `@/...` path alias so unit tests can import Next.js-style paths
//   (added for BUG-02 route-error-logging tests).
// - `setupFiles` loads `.env.test` + guards POSTGRES_URL for the TEST-01
//   real-DB integration test. Mock-only tests are unaffected.
// - The tests/ui/* suite opts into jsdom per-file via a
//   `// @vitest-environment jsdom` docblock; the default environment stays
//   `node` so the existing real-DB suites are untouched.
// - Long testTimeout because TEST-01 hits a remote Neon endpoint.
// - FEAT-05: fileParallelism disabled because two real-DB test files
//   (sale-lifecycle and feat05-cancel-sale) both TRUNCATE the same Neon
//   branch in beforeEach/beforeAll. Running them in parallel produces
//   DB race conditions where one file's truncate wipes the other file's
//   fixtures mid-test. Serial run adds ~2s to the total suite which is
//   a small cost for deterministic test outcomes.
export default defineConfig({
  plugins: [jsxInJs],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
  test: {
    setupFiles: ['./tests/setup.test-env.js'],
    // tests/vr/* are Playwright visual-regression specs (they import
    // @playwright/test) — excluded from the Vitest run; use `npm run test:vr`.
    exclude: [...configDefaults.exclude, 'tests/vr/**', 'tests/vr-pages/**'],
    testTimeout: 30000,
    sequence: { hooks: 'list' },
    fileParallelism: false,
  },
});
