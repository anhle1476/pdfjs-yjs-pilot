import { test, expect, Page } from '@playwright/test';

/**
 * Regression coverage for the virtualization "scroll jump" bug (commit 224979f).
 *
 * The PageController IntersectionObserver lazily renders/tears down offscreen
 * pages. Previously `.page-view` also carried `content-visibility: auto` +
 * `contain-intrinsic-size`, which is redundant with the observer (every wrapper
 * has an explicit inline width/height) and interacted badly with browser scroll
 * anchoring, so scrolling down then back up could jump the viewport the wrong
 * way or get stuck. The fix removes content-visibility from `.page-view`.
 *
 * These tests assert:
 *   1. The document scrollHeight stays CONSTANT while scrolling (no oscillation
 *      from offscreen boxes toggling between real and intrinsic size).
 *   2. Scrolling to the bottom then the top with real wheel events reaches both
 *      extremes without a reversal ("jump back the other way").
 *
 * Requires outbound internet (sample PDF + pdf.js worker), like the other e2e.
 */

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

test('scroll-stability: scrollHeight does not oscillate while scrolling', async ({
  page,
}) => {
  await page.goto(room('e2e-scroll-height'));
  await waitForViewer(page);

  const box = await page.locator('#viewer-container').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await page.evaluate(() => {
    const c = document.getElementById('viewer-container')!;
    (window as any).__scrollHeights = new Set<number>();
    (window as any).__scrollHeights.add(c.scrollHeight);
    c.addEventListener('scroll', () => {
      (window as any).__scrollHeights.add(c.scrollHeight);
    });
  });

  // Wheel all the way down, then back up, sampling scrollHeight on every scroll.
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(15);
  }
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(15);
  }

  const distinct: number[] = await page.evaluate(() =>
    Array.from((window as any).__scrollHeights as Set<number>)
  );
  // With inline-sized wrappers and no content-visibility, the document height
  // is fixed: exactly one distinct scrollHeight across the whole scroll.
  expect(distinct.length, `distinct scrollHeights: ${distinct.join(',')}`).toBe(1);

  // Guard: content-visibility must not be reintroduced on .page-view.
  const cv = await page.evaluate(() => {
    const pv = document.querySelector<HTMLElement>('.page-view');
    return pv ? getComputedStyle(pv).contentVisibility : '';
  });
  expect(cv === 'visible' || cv === 'normal' || cv === '').toBe(true);
});

test('scroll-stability: down-then-up reaches both extremes without reversal', async ({
  page,
}) => {
  await page.goto(room('e2e-scroll-extremes'));
  await waitForViewer(page);

  const box = await page.locator('#viewer-container').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const anomalies: any[] = [];

  for (let cycle = 0; cycle < 3; cycle++) {
    // ---- down ----
    let prev = await page.evaluate(
      () => document.getElementById('viewer-container')!.scrollTop
    );
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(15);
      const cur = await page.evaluate(() => {
        const c = document.getElementById('viewer-container')!;
        return { top: c.scrollTop, max: c.scrollHeight - c.clientHeight };
      });
      if (cur.top < prev - 3) anomalies.push({ cycle, dir: 'down', i, prev, cur });
      prev = cur.top;
      if (cur.top >= cur.max - 3) break;
    }
    await page.waitForTimeout(120);
    const bottom = await page.evaluate(() => {
      const c = document.getElementById('viewer-container')!;
      return { top: c.scrollTop, max: c.scrollHeight - c.clientHeight };
    });
    expect(bottom.top, `cycle ${cycle} did not reach bottom`).toBeGreaterThan(
      bottom.max - 20
    );

    // ---- up ----
    prev = bottom.top;
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(15);
      const cur = await page.evaluate(
        () => document.getElementById('viewer-container')!.scrollTop
      );
      if (cur > prev + 3) anomalies.push({ cycle, dir: 'up', i, prev, cur });
      prev = cur;
      if (cur <= 3) break;
    }
    await page.waitForTimeout(120);
    const top = await page.evaluate(
      () => document.getElementById('viewer-container')!.scrollTop
    );
    expect(top, `cycle ${cycle} did not reach top`).toBeLessThan(20);
  }

  expect(anomalies, `scroll reversal anomalies: ${anomalies.length}`).toEqual([]);
});
