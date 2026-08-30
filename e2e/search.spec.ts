import { test, expect, Page } from '@playwright/test';

/**
 * E2E coverage for the PDF Search feature (Ctrl+F replacement).
 *
 * Driven through window.__pdfSearch (setQuery / findNext / findPrevious /
 * clear / getState) plus DOM assertions on the .search-highlight markup the
 * SearchHighlighter paints onto the pdf.js text layer.
 *
 * The sample document is tracemonkey (a JS-tracing paper) which has plenty of
 * body text; "trace" appears many times across multiple pages.
 *
 * Like the other e2e specs this needs outbound internet access (sample PDF +
 * pdf.js worker). Each test uses a unique ?room= for view-state isolation.
 */

const KNOWN_WORD = 'trace';

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
  // First page text layer must have rendered spans (search maps onto them).
  await expect(
    page.locator('.page-view').first().locator('.text-layer span').first()
  ).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__pdfSearch)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function getState(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__pdfSearch.getState());
}

async function setQuery(page: Page, q: string): Promise<void> {
  await page.evaluate((query) => (window as any).__pdfSearch.setQuery(query), q);
}

async function currentPage(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__demoApp.getCurrentPage());
}

test('search: setQuery finds matches, highlights render, next/prev update and wrap (scroll mode)', async ({
  page,
}) => {
  await page.goto(room('e2e-search-scroll'));
  await waitForViewer(page);

  // Sanity: default view mode is scroll.
  const mode = await page.evaluate(() =>
    (window as any).__demoApp.getViewMode()
  );
  expect(mode).toBe('scroll');

  await setQuery(page, KNOWN_WORD);

  // total > 0 after the debounce + async page scan completes.
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const state1 = await getState(page);
  expect(state1.total).toBeGreaterThan(0);
  expect(state1.current).toBeGreaterThanOrEqual(1);

  // At least one highlight + one selected highlight exist in the DOM.
  await expect
    .poll(() => page.locator('.search-highlight').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => page.locator('.search-highlight.selected').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);

  // Regression guard: the highlight must be VISIBLE, not just present in the
  // DOM. A prior bug loaded style.css via a static <link>, which Vite serves as
  // a JS module in dev, so the .search-highlight rules never applied. The
  // highlight is a translucent (~0.4 alpha) colour wash so the underlying
  // canvas glyph shows through; we do NOT force a text colour.
  const highlightStyles = await page.evaluate(() => {
    const normal = document.querySelector<HTMLElement>(
      '.search-highlight:not(.selected)'
    );
    const selected = document.querySelector<HTMLElement>(
      '.search-highlight.selected'
    );
    const read = (el: HTMLElement | null) =>
      el ? getComputedStyle(el).backgroundColor : null;
    return { normal: read(normal), selected: read(selected) };
  });
  // Other matches: translucent yellow wash.
  expect(highlightStyles.normal).toBe('rgba(255, 240, 102, 0.4)');
  // Current match: translucent orange wash.
  expect(highlightStyles.selected).toBe('rgba(255, 150, 50, 0.4)');
  const beforeNext = (await getState(page)).current;
  await page.evaluate(() => (window as any).__pdfSearch.findNext());
  await expect
    .poll(async () => (await getState(page)).current)
    .not.toBe(beforeNext);

  // findPrevious moves back to the prior ordinal.
  await page.evaluate(() => (window as any).__pdfSearch.findPrevious());
  await expect
    .poll(async () => (await getState(page)).current)
    .toBe(beforeNext);

  // Wrap-around: from the first match, findPrevious wraps to the last and the
  // status becomes 'wrapped'.
  // Move to the first match deterministically by re-issuing the query.
  await setQuery(page, KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).status, { timeout: 15_000 })
    .toBe('found');
  const total = (await getState(page)).total;
  // Step backwards once from the initial selection -> wraps to the end.
  await page.evaluate(() => (window as any).__pdfSearch.findPrevious());
  await expect
    .poll(async () => (await getState(page)).status)
    .toBe('wrapped');
  expect((await getState(page)).current).toBe(total);
});

test('search: a match on a later page changes the viewer current page', async ({
  page,
}) => {
  await page.goto(room('e2e-search-jump'));
  await waitForViewer(page);

  await setQuery(page, KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const startPage = await currentPage(page);
  const total = (await getState(page)).total;

  // Advance through matches until the viewer's current page changes. With many
  // matches spread across pages, findNext must eventually cross a page.
  let changed = false;
  const maxSteps = Math.min(total, 60);
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => (window as any).__pdfSearch.findNext());
    // Allow navigation + rebuild to settle.
    const p = await currentPage(page);
    if (p !== startPage) {
      changed = true;
      break;
    }
  }
  expect(changed).toBe(true);

  // The destination page must still show a selected highlight.
  await expect
    .poll(() => page.locator('.search-highlight.selected').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);
});

test('search: works in single view mode (jump to page + highlight)', async ({
  page,
}) => {
  await page.goto(room('e2e-search-single'));
  await waitForViewer(page);

  // Switch to single mode via the sidebar UI.
  await page.locator('.view-mode-btn[data-mode="single"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__demoApp.getViewMode()))
    .toBe('single');

  await setQuery(page, KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);

  // In single mode only the current page renders; a selected highlight must be
  // present on it after the query resolves.
  await expect
    .poll(() => page.locator('.search-highlight.selected').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => page.locator('.search-highlight').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  // Advancing until the page changes must swap the single-page DOM and re-apply
  // the highlight on the new page.
  const startPage = await currentPage(page);
  const total = (await getState(page)).total;
  let changed = false;
  const maxSteps = Math.min(total, 60);
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => (window as any).__pdfSearch.findNext());
    const p = await currentPage(page);
    if (p !== startPage) {
      changed = true;
      break;
    }
  }
  expect(changed).toBe(true);

  // After the DOM swap the selected highlight is re-applied on the new page.
  await expect
    .poll(() => page.locator('.search-highlight.selected').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);
});

test('search: clearing the query removes highlights', async ({ page }) => {
  await page.goto(room('e2e-search-clear'));
  await waitForViewer(page);

  await setQuery(page, KNOWN_WORD);
  // Wait for the full-document scan to settle (status 'found') so no in-flight
  // scan can re-populate matches after we clear.
  await expect
    .poll(async () => (await getState(page)).status, { timeout: 15_000 })
    .toBe('found');
  await expect
    .poll(() => page.locator('.search-highlight').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  await page.evaluate(() => (window as any).__pdfSearch.clear());
  await expect
    .poll(() => page.locator('.search-highlight').count(), { timeout: 15_000 })
    .toBe(0);
  const state = await getState(page);
  expect(state.total).toBe(0);
  expect(state.query).toBe('');
});

test('search: Ctrl+F focuses the in-app search bar (native find intercepted)', async ({
  page,
}) => {
  await page.goto(room('e2e-search-ctrlf'));
  await waitForViewer(page);

  await page.keyboard.press('Control+f');
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.id ?? '')
    )
    .toBe('search-input');
});

test('search (virtualization): scrolling to a later match page lazily renders + highlights it', async ({
  page,
}) => {
  // With virtualization only pages in/near the viewport render their content
  // (canvas + text layer). A match on a far page therefore has NO highlight in
  // the DOM until the page is scrolled near — at which point the page renders
  // lazily and the onPageRendered hook re-applies the highlight. This replaces
  // the old (now-invalid) "scroll-mode total === DOM highlight count" parity.
  await page.goto(room('e2e-search-virtual'));
  await waitForViewer(page);

  expect(
    await page.evaluate(() => (window as any).__demoApp.getViewMode())
  ).toBe('scroll');

  await setQuery(page, KNOWN_WORD);
  await expect
    .poll(async () => (await getState(page)).total, { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Find a match on a page that is NOT currently the viewer's page 1, then
  // navigate to it. matchIndexInPage/page live in the controller state.
  const targetPage = await page.evaluate(() => {
    const s = (window as any).__pdfSearch.getState();
    return typeof s.total === 'number' ? s.total : 0;
  });
  expect(targetPage).toBeGreaterThan(0);

  const startPage = await currentPage(page);

  // Step forward until the viewer page changes (a match on a later page). The
  // navigation scrolls the container, lazily rendering the destination page.
  let changed = false;
  const total = (await getState(page)).total;
  const maxSteps = Math.min(total, 80);
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => (window as any).__pdfSearch.findNext());
    if ((await currentPage(page)) !== startPage) {
      changed = true;
      break;
    }
  }
  expect(changed).toBe(true);

  // The lazily-rendered destination page must show its selected highlight,
  // painted by the onPageRendered hook after the page's text layer built.
  await expect
    .poll(() => page.locator('.search-highlight.selected').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);

  // And a rendered text layer must exist on the current page (proof of lazy
  // render, not a placeholder).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cur = (window as any).__demoApp.getCurrentPage();
        const view = (window as any).__demoApp.renderer.getPageView(cur);
        return view ? view.textLayer.querySelectorAll('span').length : 0;
      })
    )
    .toBeGreaterThan(0);
});
