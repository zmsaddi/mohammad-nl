import { test, expect } from '@playwright/test';
import { adminSessionCookie } from './_auth.js';
import { fixtureFor } from './_fixtures.js';
import { VR_BASE } from './_secret.js';

// Auth-gated pages screenshotted with a minted admin session + stubbed APIs.
// /summary is excluded: its Recharts charts animate/render non-deterministically.
const PAGES = [
  ['sales', '/sales'],
  ['purchases', '/purchases'],
  ['invoices', '/invoices'],
  ['deliveries', '/deliveries'],
  ['clients', '/clients'],
  ['expenses', '/expenses'],
  ['stock', '/stock'],
  ['suppliers', '/suppliers'],
  ['settlements', '/settlements'],
  ['treasury', '/treasury'],
  ['profit-distributions', '/profit-distributions'],
  ['users', '/users'],
  ['settings', '/settings'],
];

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([await adminSessionCookie()]);
  // Stub every data API; let next-auth's own routes through so the session
  // (and the proxy middleware) resolve from the minted JWT cookie.
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/')) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureFor(url)),
    });
  });
});

for (const [name, path] of PAGES) {
  test(`page — ${name}`, async ({ page }) => {
    await page.goto(`${VR_BASE}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  });
}
