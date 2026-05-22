import { defineConfig, devices } from '@playwright/test';
import { VR_SECRET, VR_PORT, VR_BASE } from './tests/vr-pages/_secret.js';

// Page-level visual regression (Commit 8). Boots the REAL production app and
// screenshots the auth-gated pages at desktop + mobile widths, with a minted
// admin session cookie and all /api/* responses stubbed from fixtures (no DB).
// This is the safety net that makes a page-level inline-style → shared-class
// consolidation verifiable as pixel-equivalent before it ships.
//
// Local verification tool (pixel baselines are OS-specific). Run:
//   npm run test:vr:pages          (verify)
//   npm run test:vr:pages:update   (refresh baselines)
export default defineConfig({
  testDir: './tests/vr-pages',
  fullyParallel: false,
  workers: 2,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  webServer: {
    // build + start in one command so the env below applies to both. Reused
    // across runs locally so we don't rebuild every time.
    command: `npm run build && npx next start -p ${VR_PORT}`,
    url: `${VR_BASE}/login`,
    timeout: 180000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXTAUTH_SECRET: VR_SECRET,
      NEXTAUTH_URL: VR_BASE,
      POSTGRES_URL: 'postgresql://ci:ci@ci-test-host.example.com/neondb-test?sslmode=require',
      POSTGRES_URL_NON_POOLING: 'postgresql://ci:ci@ci-test-host.example.com/neondb-test?sslmode=require',
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
