import { test, expect, Page } from '@playwright/test';

/**
 * E2E coverage for the Table-of-Contents (outline) feature.
 *
 * The sample document (tracemonkey) has NO outline, so we assert:
 *   - window.__pdfOutline.hasOutline() === false
 *   - opening the TOC panel shows the empty state ("No table of contents")
 * We do NOT assert navigation (there is nothing to navigate to).
 *
 * Needs outbound internet access (sample PDF + pdf.js worker). Unique ?room=
 * per test for view-state isolation.
 */

function room(prefix: string): string {
  return `/?room=${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function waitForViewer(page: Page): Promise<void> {
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.page-view').first()).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__pdfOutline)), {
      timeout: 15_000,
    })
    .toBe(true);
}

test('outline: tracemonkey has no outline (hasOutline() === false)', async ({
  page,
}) => {
  await page.goto(room('e2e-outline-none'));
  await waitForViewer(page);

  // load() resolves to [] and hasOutline() is false.
  const items = await page.evaluate(() =>
    (window as any).__pdfOutline.load()
  );
  expect(Array.isArray(items)).toBe(true);
  expect(items.length).toBe(0);

  const has = await page.evaluate(() =>
    (window as any).__pdfOutline.hasOutline()
  );
  expect(has).toBe(false);
});

test('outline: TOC panel shows the empty state when there is no outline', async ({
  page,
}) => {
  await page.goto(room('e2e-outline-empty-ui'));
  await waitForViewer(page);

  // The TOC toggle button is present.
  const toggle = page.locator('#toc-toggle');
  await expect(toggle).toBeVisible();

  // Panel starts hidden.
  await expect(page.locator('#toc-panel')).toBeHidden();

  // Open it -> the empty-state message appears.
  await toggle.click();
  await expect(page.locator('#toc-panel')).toBeVisible();
  const empty = page.locator('#toc-empty');
  await expect(empty).toBeVisible({ timeout: 15_000 });
  await expect(empty).toHaveText('No table of contents');

  // No outline links are rendered.
  await expect(page.locator('.toc-link')).toHaveCount(0);
});
