import { test, expect, Page } from '@playwright/test';

/**
 * E2E coverage for cross-peer view-state synchronization (view mode, zoom,
 * rotation, page).
 *
 * View state is replicated via Yjs *Awareness* (ephemeral presence), NOT the
 * Y.Doc. A true two-browser test would require the y-websocket server
 * (ws://localhost:1234), which the Playwright config does not start. Instead,
 * window.__pdfViewState.set(...) publishes into a SECOND Awareness (a fake
 * remote peer with its own clientID) whose updates are relayed into the real
 * provider awareness. This drives the exact same apply path a real peer would
 * trigger. Asserting the viewer's public getters change proves "a state change
 * from another peer is reflected locally".
 *
 * `__pdfViewState.get()` returns the LOCAL published view (what this client
 * broadcasts). `__pdfViewState.getRemote()` returns the fake remote peer's
 * published view, used to prove applying a remote change does not write back
 * (no echo). The reverse direction (local UI change -> local published view) is
 * covered by the "local UI change writes into the shared view state" test.
 *
 * NOTE: like the smoke tests, this depends on outbound internet access to fetch
 * the sample PDF and the pdf.js worker.
 */

async function waitForLoaded(page: Page): Promise<void> {
  // Use a unique room per test so authoritative view state does not leak
  // between independent sessions sharing the pilot's y-websocket server.
  const room = `e2e-view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto(`/?room=${room}`);
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.page-view').first()).toBeVisible({
    timeout: 45_000,
  });
  // View-state hook must be present.
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__pdfViewState)), {
      timeout: 15_000,
    })
    .toBe(true);
}

// Simulate a remote peer writing into the shared view-state map.
async function remoteSet(page: Page, partial: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => (window as any).__pdfViewState.set(p), partial);
}

function getViewMode(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__demoApp.getViewMode());
}
function getRotation(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__demoApp.getRotation());
}
function getCurrentPage(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__demoApp.getCurrentPage());
}
function getZoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__demoApp.getZoom());
}

test('remote view-mode change is reflected locally', async ({ page }) => {
  await waitForLoaded(page);
  expect(await getViewMode(page)).toBe('scroll');

  await remoteSet(page, { viewMode: 'single' });

  await expect.poll(() => getViewMode(page), { timeout: 10_000 }).toBe('single');
});

test('remote zoom change is reflected locally', async ({ page }) => {
  await waitForLoaded(page);
  const before = await getZoom(page);

  await remoteSet(page, { zoom: before + 0.5 });

  await expect
    .poll(() => getZoom(page), { timeout: 10_000 })
    .toBeCloseTo(before + 0.5, 3);
});

test('remote rotation change is reflected locally (absolute)', async ({ page }) => {
  await waitForLoaded(page);
  expect(await getRotation(page)).toBe(0);

  await remoteSet(page, { rotation: 90 });
  await expect.poll(() => getRotation(page), { timeout: 10_000 }).toBe(90);

  // Absolute apply: setting 270 directly must land on 270, not accumulate.
  await remoteSet(page, { rotation: 270 });
  await expect.poll(() => getRotation(page), { timeout: 10_000 }).toBe(270);
});

test('remote page change is reflected locally (single mode)', async ({ page }) => {
  await waitForLoaded(page);
  const total = await page.evaluate(() => (window as any).__demoApp.getTotalPages());
  expect(total).toBeGreaterThan(1);

  // Switch to single mode (via remote) then navigate to page 2 (via remote).
  await remoteSet(page, { viewMode: 'single' });
  await expect.poll(() => getViewMode(page), { timeout: 10_000 }).toBe('single');

  await remoteSet(page, { page: 2 });
  await expect.poll(() => getCurrentPage(page), { timeout: 10_000 }).toBe(2);
});

test('all four fields converge from a single remote update', async ({ page }) => {
  await waitForLoaded(page);
  const total = await page.evaluate(() => (window as any).__demoApp.getTotalPages());
  expect(total).toBeGreaterThan(1);

  await remoteSet(page, {
    viewMode: 'single',
    zoom: 1.5,
    rotation: 180,
    page: 2,
  });

  await expect.poll(() => getViewMode(page), { timeout: 10_000 }).toBe('single');
  await expect.poll(() => getRotation(page), { timeout: 10_000 }).toBe(180);
  await expect.poll(() => getCurrentPage(page), { timeout: 10_000 }).toBe(2);
  await expect
    .poll(() => getZoom(page), { timeout: 10_000 })
    .toBeCloseTo(1.5, 3);
});

test('no echo: applying a remote change does not mutate the shared value back', async ({
  page,
}) => {
  await waitForLoaded(page);

  await remoteSet(page, { zoom: 1.75 });
  await expect
    .poll(() => getZoom(page), { timeout: 10_000 })
    .toBeCloseTo(1.75, 3);

  // Settle, then confirm the remote/authoritative value has NOT drifted (no
  // local write-back ping-pong occurred while applying the remote zoom).
  await page.waitForTimeout(500);
  const shared = await page.evaluate(
    () => (window as any).__pdfViewState.getRemote().zoom
  );
  expect(shared).toBeCloseTo(1.75, 3);
  // And the local viewer still matches.
  expect(await getZoom(page)).toBeCloseTo(1.75, 3);
});

test('local UI change writes into the shared view state (single mode)', async ({
  page,
}) => {
  await waitForLoaded(page);

  // Toggle to single mode via the actual sidebar UI.
  await page.locator('.view-mode-btn[data-mode="single"]').click();
  await expect.poll(() => getViewMode(page), { timeout: 10_000 }).toBe('single');

  // The change must have propagated into the shared map (what a peer receives).
  await expect
    .poll(() => page.evaluate(() => (window as any).__pdfViewState.get().viewMode), {
      timeout: 10_000,
    })
    .toBe('single');

  // Zoom in via UI and confirm the shared zoom tracks it.
  const beforeZoom = await getZoom(page);
  await page.locator('#zoom-in').click();
  await expect
    .poll(() => getZoom(page), { timeout: 10_000 })
    .toBeGreaterThan(beforeZoom);
  await expect
    .poll(() => page.evaluate(() => (window as any).__pdfViewState.get().zoom), {
      timeout: 10_000,
    })
    .toBeGreaterThan(beforeZoom);
});

test('regression: applying a remote page in scroll mode does not drift the shared page (no scroll write-back)', async ({
  page,
}) => {
  await waitForLoaded(page);
  const total = await page.evaluate(() => (window as any).__demoApp.getTotalPages());
  expect(total).toBeGreaterThan(2);
  // Stay in the default scroll mode; applying a remote page scrolls the
  // container, whose debounced scroll listener could otherwise write a
  // neighbouring page back into the shared map as a local edit.
  expect(await getViewMode(page)).toBe('scroll');

  await remoteSet(page, { page: 3 });
  await expect.poll(() => getCurrentPage(page), { timeout: 10_000 }).toBe(3);

  // Wait well past the scroll debounce (100ms) and the settle window (250ms).
  await page.waitForTimeout(700);

  // The remote/authoritative page value must still be exactly 3 — no
  // write-back ping-pong from the local scroll listener.
  const sharedPage = await page.evaluate(
    () => (window as any).__pdfViewState.getRemote().page
  );
  expect(sharedPage).toBe(3);
});

test('regression: a remote view change preserves existing annotations', async ({
  page,
}) => {
  await waitForLoaded(page);

  // Draw an ink stroke first.
  const pageView = page.locator('.page-view').first();
  const canvas = pageView.locator('canvas').last();
  const box = (await canvas.boundingBox())!;
  const drawBtn = page.locator('.tool-btn[data-tool="draw"]');
  const active = await drawBtn.evaluate((el) => el.classList.contains('active'));
  if (!active) await drawBtn.click();
  await expect(drawBtn).toHaveClass(/active/);

  const sx = box.x + box.width * 0.3;
  const sy = box.y + box.height * 0.3;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + i * 5, sy + i * 4);
  }
  await page.mouse.up();

  const countBefore = await page.evaluate(() => {
    const arr = (window as any).__pdfSync.get();
    return Array.isArray(arr) ? arr.length : -1;
  });
  expect(countBefore).toBeGreaterThan(0);

  // Apply a remote zoom + rotation change.
  await remoteSet(page, { zoom: 1.5, rotation: 90 });
  await expect.poll(() => getRotation(page), { timeout: 10_000 }).toBe(90);

  // Annotations must still be present (view changes re-render, never drop them).
  const countAfter = await page.evaluate(() => {
    const arr = (window as any).__pdfSync.get();
    return Array.isArray(arr) ? arr.length : -1;
  });
  expect(countAfter).toBe(countBefore);
});
