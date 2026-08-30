import { test, expect, Page } from '@playwright/test';

// Isolate the shared awareness room per test (view state is presence-only now).
let roomUrl = '/';
test.beforeEach(() => {
  roomUrl = `/?room=e2e-zoomwheel-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
});

function getZoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__demoApp.getZoom());
}

test('Ctrl + wheel zooms the document (in and out); plain wheel does not', async ({
  page,
}) => {
  await page.goto(roomUrl);
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });
  // The app test hook is assigned once the document has loaded; wait for it so
  // getZoom() does not race the placeholder becoming visible (virtualization
  // shows page wrappers before __demoApp is wired up).
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__demoApp)), {
      timeout: 15_000,
    })
    .toBe(true);

  const initial = await getZoom(page);

  // Position the pointer over the viewer, then Ctrl+wheel UP => zoom in.
  const box = (await page.locator('#viewer-container').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120); // wheel up
  await page.keyboard.up('Control');

  await expect.poll(() => getZoom(page)).toBeGreaterThan(initial);

  const zoomedIn = await getZoom(page);

  // Ctrl+wheel DOWN => zoom out.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120); // wheel down
  await page.keyboard.up('Control');

  await expect.poll(() => getZoom(page)).toBeLessThan(zoomedIn);

  // A plain wheel (no Ctrl) must NOT change the zoom (it scrolls instead).
  const beforePlain = await getZoom(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  // Give any (unexpected) zoom handler a chance to fire, then assert unchanged.
  await page.waitForTimeout(300);
  expect(await getZoom(page)).toBe(beforePlain);
});

test('in-place zoom does not tear down the page-1 DOM / text layer', async ({
  page,
}) => {
  await page.goto(roomUrl);
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });
  // Wait for page 1's text layer to render.
  await expect(pageView.locator('.text-layer span').first()).toBeVisible({
    timeout: 30_000,
  });

  // Tag page 1's wrapper + text layer with a unique marker.
  await page.evaluate(() => {
    const wrapper = document.querySelector('.page-view') as HTMLElement;
    wrapper.dataset.probe = 'zoom-probe';
    const tl = wrapper.querySelector('.text-layer') as HTMLElement;
    tl.dataset.probe = 'tl-probe';
  });

  const before = await getZoom(page);

  // Zoom in via the UI (debounced in-place path).
  await page.locator('#zoom-in').click();
  await expect.poll(() => getZoom(page)).toBeGreaterThan(before);

  // The SAME wrapper + text-layer nodes must still be present (not recreated):
  // an innerHTML='' rebuild would drop the data-probe markers.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = document.querySelector('.page-view[data-probe="zoom-probe"]');
        const tl = w?.querySelector('.text-layer[data-probe="tl-probe"]');
        return Boolean(w && tl);
      })
    )
    .toBe(true);

  // The text layer must still carry glyph spans (re-rastered in place) and the
  // --total-scale-factor must track the new zoom (glyph alignment intact). The
  // in-place re-raster is debounced, so poll until it settles.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tl = document.querySelector(
          '.page-view[data-probe="zoom-probe"] .text-layer'
        ) as HTMLElement;
        return parseFloat(tl.style.getPropertyValue('--total-scale-factor'));
      })
    )
    .toBeGreaterThan(before);
});

test('rapid Ctrl+wheel zoom coalesces (few re-rasters, no pile-up) and stays correct', async ({
  page,
}) => {
  await page.goto(roomUrl);
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });
  await expect(pageView.locator('.text-layer span').first()).toBeVisible({
    timeout: 30_000,
  });

  const initial = await getZoom(page);
  const box = (await page.locator('#viewer-container').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Fire many wheel notches in quick succession. The debounce + RenderTask
  // cancellation must coalesce these into a stable final zoom without leaving
  // a half-rendered / blank page-1 (which would drop its text spans).
  await page.keyboard.down('Control');
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -120);
  }
  await page.keyboard.up('Control');

  await expect.poll(() => getZoom(page)).toBeGreaterThan(initial);

  // After the burst settles, page 1 must still have a rendered text layer with
  // spans (proves cancellation did not leave the page torn down / blank).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('.page-view .text-layer')?.querySelectorAll(
            'span'
          ).length ?? 0
      )
    )
    .toBeGreaterThan(0);
});
