import { test, expect, Page } from '@playwright/test';

/**
 * Regression coverage for the "search highlight position shift" bug (introduced
 * with virtualization, commit 224979f).
 *
 * ROOT CAUSE: the broad `.text-layer span` CSS rule (position: absolute +
 * per-glyph scaleX transform + calc font-size) also matched the
 * `<span class="search-highlight">` element the SearchHighlighter injects INSIDE
 * a glyph span. The inner highlight therefore became absolutely positioned
 * (collapsing its parent glyph span to zero width) and re-applied the glyph
 * scaleX, so the highlight rendered in the WRONG PLACE — reproducibly on page 1,
 * accumulating as the user pressed Next. The fix neutralises positioning /
 * transform / sizing for `.search-highlight` so it is a plain in-flow inline
 * wash that inherits the glyph's metrics (mirroring how pdf.js resets its own
 * `.highlight` spans).
 *
 * These tests assert that for EVERY highlight visible in the viewport, its
 * centre lies within its parent glyph span and the parent is not collapsed —
 * both right after querying and across many repeated Next presses.
 *
 * Requires outbound internet (sample PDF + pdf.js worker).
 */

const KNOWN_WORD = 'trace';

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
 * Return the list of misaligned highlights currently visible in the viewport.
 * A highlight is misaligned if its parent glyph span collapsed (zero size) or
 * its centre falls outside the parent glyph span (beyond a small tolerance).
 */
function findMisaligned(page: Page) {
  return page.evaluate(() => {
    const out: any[] = [];
    const c = document.getElementById('viewer-container')!;
    const cr = c.getBoundingClientRect();
    const hls = Array.from(
      document.querySelectorAll<HTMLElement>('.search-highlight')
    );
    for (const hl of hls) {
      const hr = hl.getBoundingClientRect();
      if (hr.width === 0 || hr.height === 0) continue;
      const cx = (hr.left + hr.right) / 2;
      const cy = (hr.top + hr.bottom) / 2;
      // Only assert on highlights actually within the viewer viewport (what the
      // user sees); offscreen / torn-down pages are irrelevant.
      if (cx < cr.left || cx > cr.right || cy < cr.top || cy > cr.bottom) continue;

      const parent = hl.parentElement as HTMLElement | null;
      if (!parent || !parent.closest('.text-layer')) continue;
      const pr = parent.getBoundingClientRect();
      if (pr.width < 1 || pr.height < 1) {
        out.push({ kind: 'collapsed-parent', text: hl.textContent });
        continue;
      }
      const tol = 4;
      const inside =
        cx >= pr.left - tol &&
        cx <= pr.right + tol &&
        cy >= pr.top - tol &&
        cy <= pr.bottom + tol;
      if (!inside) out.push({ kind: 'center-outside', text: hl.textContent });
    }
    return out;
  });
}

test('search-highlight alignment: highlights sit within their glyph spans after query', async ({
  page,
}) => {
  await page.goto(room('e2e-hl-align-query'));
  await waitForViewer(page);

  await page.evaluate((q) => (window as any).__pdfSearch.setQuery(q), KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Let the highlighter paint.
  await expect
    .poll(() => page.locator('.search-highlight').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  const bad = await findMisaligned(page);
  expect(bad, `misaligned highlights: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
});

test('search-highlight alignment: stays correct across repeated Next presses', async ({
  page,
}) => {
  await page.goto(room('e2e-hl-align-next'));
  await waitForViewer(page);

  await page.evaluate((q) => (window as any).__pdfSearch.setQuery(q), KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const failures: any[] = [];
  for (let step = 0; step < 30; step++) {
    await page.evaluate(() => (window as any).__pdfSearch.findNext());
    await page.waitForTimeout(100);
    const bad = await findMisaligned(page);
    if (bad.length > 0) failures.push({ step, bad: bad.slice(0, 4) });
  }

  expect(
    failures,
    `misalignment at steps: ${failures.map((f) => f.step).join(',')}`
  ).toEqual([]);
});
