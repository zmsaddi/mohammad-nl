import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Visual-regression of the design-system gallery (rendered with the app's real
// compiled CSS). Loaded over file:// — no server, DB, or auth needed, so it is
// fast and deterministic. Generate/refresh baselines with
// `npm run test:vr:update`; verify with `npm run test:vr`.
const galleryUrl = pathToFileURL(path.resolve('tests/vr/gallery.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(galleryUrl, { waitUntil: 'networkidle' });
  // Wait for the Cairo webfont so Arabic glyph metrics are stable.
  await page.evaluate(() => document.fonts.ready);
});

test('design system — full gallery', async ({ page }) => {
  await expect(page).toHaveScreenshot('gallery-full.png', { fullPage: true });
});

// Per-section snapshots give a tighter diff when one component changes.
const SECTIONS = ['buttons', 'form', 'badges', 'chips', 'card', 'table', 'data-card', 'empty'];
for (const section of SECTIONS) {
  test(`design system — ${section}`, async ({ page }) => {
    await expect(page.locator(`[data-vr="${section}"]`)).toHaveScreenshot(`section-${section}.png`);
  });
}
