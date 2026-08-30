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
