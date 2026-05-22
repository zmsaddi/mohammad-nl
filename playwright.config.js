import { defineConfig, devices } from '@playwright/test';

// Visual-regression config (Commit 7). Scope is intentionally narrow: it only
// runs the design-system gallery spec under tests/vr/, which screenshots a
// static styleguide rendered with the app's real compiled CSS. This is the
// safety net that lets a future styling consolidation (shared Input/Select/
// Button primitives) be proven pixel-equivalent before it ships.
//
// It is a LOCAL verification tool, not a blocking CI gate: pixel baselines are
// environment-specific (font anti-aliasing differs across OSes), so baselines
// are regenerated with `npm run test:vr:update` on the machine that runs the
// comparison. A small maxDiffPixelRatio absorbs sub-perceptual noise.
export default defineConfig({
  testDir: './tests/vr',
  fullyParallel: true,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    ...devices['Desktop Chrome'],
    // Fixed viewport so screenshots are deterministic.
    viewport: { width: 1024, height: 1400 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
