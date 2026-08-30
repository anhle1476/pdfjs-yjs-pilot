import { test, expect, devices, Page } from '@playwright/test';

test.use({ ...devices['Pixel 5'] });

async function waitForLoaded(page: Page): Promise<void> {
  const room = `e2e-touch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto(`/?room=${room}`);
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('.page-view').first()).toBeVisible({
    timeout: 45_000,
  });
  // The app test hook + default tool are wired up once the document has fully
  // loaded. With virtualization the page-view placeholders become visible
  // before that, so wait for the hook before interacting with the toolbar.
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__demoApp)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function dispatchTouchMove(
  page: Page,
  touchCount: number
): Promise<boolean> {
  return page.evaluate((count) => {
    const viewer = document.getElementById('viewer-container');
    if (!viewer) throw new Error('Viewer container not found');

    const makeTouch = (identifier: number): Touch =>
      new Touch({
        identifier,
        target: viewer,
        clientX: 120 + identifier * 40,
        clientY: 180 + identifier * 40,
      });
    const touches = Array.from({ length: count }, (_, index) =>
      makeTouch(index + 1)
    );
    const event = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches,
      targetTouches: touches,
      changedTouches: touches,
    });
    const dispatched = viewer.dispatchEvent(event);
    return event.defaultPrevented || !dispatched;
  }, touchCount);
}

test('drawing tools block one-finger pan but preserve two-finger gestures', async ({
  page,
}) => {
  await waitForLoaded(page);

  for (const tool of ['draw', 'highlight', 'freetext']) {
    const button = page.locator(`.tool-btn[data-tool="${tool}"]`);
    const active = await button.evaluate((element) =>
      element.classList.contains('active')
    );
    if (!active) await button.click();
    await expect(button).toHaveClass(/active/);
    expect(await dispatchTouchMove(page, 1), `${tool} one-finger move`).toBe(
      true
    );
    expect(await dispatchTouchMove(page, 2), `${tool} two-finger move`).toBe(
      false
    );
  }

  const selectButton = page.locator('.tool-btn[data-tool="select"]');
  await selectButton.click();
  expect(await dispatchTouchMove(page, 1), 'select one-finger move').toBe(
    false
  );
  expect(await dispatchTouchMove(page, 2), 'select two-finger move').toBe(
    false
  );
});
