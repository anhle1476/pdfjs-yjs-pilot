import { test, expect, Page } from '@playwright/test';

/**
 * Regression coverage for the CONFIRMED, PERSISTENT vertical text-layer
 * misposition bug.
 *
 * SYMPTOM: after pressing "Next match" several times during a search, page 1
 * leaves the virtualization buffer, is torn down, and is later RE-RENDERED by
 * the IntersectionObserver. On that re-render the pdf.js text layer's glyphs
 * (and therefore the search highlights that wrap them) end up vertically
 * mispositioned relative to the page CANVAS — the rasterized PDF that is the
 * ground truth and never moves.
 *
 * GROUND TRUTH = the <canvas> element (the rendered PDF raster). We measure the
 * first '.search-highlight' on page 1 RELATIVE TO that page's canvas:
 *   relX = highlight.left - canvas.left
 *   relY = highlight.top  - canvas.top
 * These must be identical at baseline and after many findNext presses (within
 * ~1px). ROOT CAUSE (proven by isolation): the text layer used
 * `overflow: hidden`, which makes it a scroll container. Its glyph spans
 * slightly overflow, so scrollHeight > clientHeight; `scrollIntoView` on the
 * selected highlight during findNext then scrolls the text layer itself
 * (scrollTop ~= 224), painting every glyph ~224px too high relative to the
 * (unmoving) canvas. The fix is `overflow: clip` (not a scroll container).
 *
 * Requires outbound internet (sample PDF + pdf.js worker).
 */

const QUERY = 'dynamic';

function room(prefix: string): string {
  return `/?room=${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function waitForViewer(page: Page): Promise<void> {
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.page-view').first()).toBeVisible({ timeout: 45_000 });
  await expect(
    page.locator('.page-view').first().locator('.text-layer span').first()
  ).toBeVisible({ timeout: 30_000 });
}

async function getState(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__pdfSearch.getState());
}

/**
 * Measure the first '.search-highlight' on page 1 relative to page 1's canvas
 * (the PDF raster — ground truth). Returns null if not present / measurable.
 */
function measureHighlightVsCanvas(page: Page) {
  return page.evaluate(() => {
    const pageView = document.querySelector<HTMLElement>(
      '.page-view[data-page-number="1"]'
    );
    if (!pageView) return null;
    // The viewer (rendered PDF) canvas is the first-of-type canvas (z-index 1).
    const canvas = pageView.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return null;
    const hl = pageView.querySelector<HTMLElement>('.search-highlight');
    if (!hl) return null;
    const cr = canvas.getBoundingClientRect();
    const hr = hl.getBoundingClientRect();
    if (cr.width === 0 || cr.height === 0) return null;
    if (hr.width === 0 && hr.height === 0) return null;
    return {
      relX: hr.left - cr.left,
      relY: hr.top - cr.top,
      // Diagnostics: real measured px of the text-layer box.
      textLayerOffsetHeight: (hl.closest('.text-layer') as HTMLElement)
        ?.offsetHeight,
      canvasHeight: cr.height,
    };
  });
}

async function scrollPage1IntoView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pv = document.querySelector<HTMLElement>(
      '.page-view[data-page-number="1"]'
    );
    pv?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);
}

test('search-highlight vs canvas: relX/relY on page 1 stay stable across many findNext', async ({
  page,
}) => {
  await page.goto(room('e2e-hl-canvas-align'));
  await waitForViewer(page);

  await page.evaluate((q) => (window as any).__pdfSearch.setQuery(q), QUERY);
  await expect
    .poll(async () => (await getState(page)).status, { timeout: 15_000 })
    .toBe('found');
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Let the highlighter paint on page 1.
  await expect
    .poll(
      () =>
        page
          .locator('.page-view[data-page-number="1"] .search-highlight')
          .count(),
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(1);

  const baseline = await measureHighlightVsCanvas(page);
  expect(baseline, 'baseline measurement should exist').not.toBeNull();

  // Press Next match ~13 times (each ~180ms) to push page 1 out of the buffer,
  // then bring it back — forcing a teardown + re-render of page 1.
  for (let i = 0; i < 13; i++) {
    await page.evaluate(() => (window as any).__pdfSearch.findNext());
    await page.waitForTimeout(180);
  }

  // Scroll page 1 back into view and let it settle / re-render.
  await scrollPage1IntoView(page);
  await expect
    .poll(
      () =>
        page
          .locator('.page-view[data-page-number="1"] .search-highlight')
          .count(),
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(1);

  const after = await measureHighlightVsCanvas(page);
  expect(after, 'after-findNext measurement should exist').not.toBeNull();

  // X should already be correct; Y is the regression axis. Assert BOTH equal
  // baseline within ~1px against the canvas (ground truth).
  const msg = `baseline=${JSON.stringify(baseline)} after=${JSON.stringify(after)}`;
  expect(Math.abs(after!.relX - baseline!.relX), msg).toBeLessThanOrEqual(1.5);
  expect(Math.abs(after!.relY - baseline!.relY), msg).toBeLessThanOrEqual(1.5);
});
