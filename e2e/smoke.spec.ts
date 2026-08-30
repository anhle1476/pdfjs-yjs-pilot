import { test, expect, Page } from '@playwright/test';

/**
 * Smoke test for the PDF.js + Yjs pilot viewer.
 *
 * Coverage:
 *  1. Page loads and the viewer container + sidebar UI appear.
 *  2. The sample PDF loads over the network (loading text hides, viewer
 *     canvas renders, annotation canvas becomes available).
 *  3. Selecting the "Draw" (ink) tool via the sidebar and drawing a stroke
 *     on the annotation canvas creates at least one annotation object,
 *     verified through the window-exposed Yjs sync store (window.__pdfSync).
 *
 * NOTE: This test depends on outbound internet access:
 *   - the sample PDF is fetched from raw.githubusercontent.com
 *   - the pdf.js worker is fetched from cdn.jsdelivr.net
 * The Yjs WebSocket server (ws://localhost:1234) is NOT required — the app
 * writes annotations into the local Yjs doc regardless of connection status.
 */

// Helper: count annotations currently in the Yjs sync store.
async function annotationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sync = (window as any).__pdfSync;
    if (!sync) return -1;
    const arr = sync.get();
    return Array.isArray(arr) ? arr.length : -1;
  });
}

test('smoke: page loads, PDF renders, ink tool creates an annotation', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  // 1. Basic UI present.
  await expect(page.locator('#viewer-container')).toBeVisible();
  await expect(page.locator('#sidebar')).toBeVisible();

  // Sidebar buttons rendered by createSidebar().
  const drawBtn = page.locator('.tool-btn[data-tool="draw"]');
  await expect(drawBtn).toBeVisible();

  // 2. PDF loads: loading text should be hidden once the PDF is ready,
  //    and the viewer / annotation canvases should be rendered.
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });

  // A .page-view wrapper with the annotation canvas (z-index 3) appears
  // once PageController renders the first page.
  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });

  // Two canvases per page-view: viewerCanvas + annotationCanvas.
  const annotationCanvas = pageView.locator('canvas').last();
  await expect(annotationCanvas).toBeVisible();

  // Sanity: the window test hooks are exposed.
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__pdfSync)), {
      timeout: 15_000,
    })
    .toBe(true);

  const before = await annotationCount(page);
  expect(before).toBeGreaterThanOrEqual(0);

  // 3. Select the ink/draw tool via the sidebar UI.
  //    (App also defaults to 'ink' on startup, but we exercise the UI toggle.)
  //    Because startup calls setActiveTool('draw'), the button may already be
  //    active; ensure the ink tool is active by clicking only if not active.
  const isActive = await drawBtn.evaluate((el) => el.classList.contains('active'));
  if (!isActive) {
    await drawBtn.click();
    await expect(drawBtn).toHaveClass(/active/);
  }

  // Draw a stroke on the annotation canvas using pointer events.
  const box = await annotationCanvas.boundingBox();
  expect(box).not.toBeNull();
  const b = box!;

  const startX = b.x + b.width * 0.3;
  const startY = b.y + b.height * 0.3;
  const endX = b.x + b.width * 0.6;
  const endY = b.y + b.height * 0.6;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate moves so the InkDrawOutliner accumulates points.
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();

  // Assert at least one new annotation was created in the sync store.
  await expect
    .poll(() => annotationCount(page), { timeout: 10_000 })
    .toBeGreaterThan(before);
});

// Helper: count annotations of a given type in the sync store.
async function annotationCountOfType(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => {
    const sync = (window as any).__pdfSync;
    if (!sync) return -1;
    const arr = sync.get();
    if (!Array.isArray(arr)) return -1;
    return arr.filter((a: any) => a && a.type === t).length;
  }, type);
}

test('text-mode highlight: selecting text with the highlight tool persists a highlight', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });

  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });

  // Wait for the text layer to render spans.
  const firstSpan = pageView.locator('.text-layer span').first();
  await expect(firstSpan).toBeVisible({ timeout: 30_000 });

  // Activate the highlight tool and switch it to text mode.
  await page.locator('.tool-btn[data-tool="highlight"]').click();
  await page.locator('.hl-mode-btn[data-hl-mode="text"]').click();

  const beforeHighlights = await annotationCountOfType(page, 'highlight');

  // Select a run of text by dragging across the first few spans.
  const spans = pageView.locator('.text-layer span');
  const count = await spans.count();
  const startBox = await spans.nth(0).boundingBox();
  const endBox = await spans.nth(Math.min(3, count - 1)).boundingBox();
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();

  await page.mouse.move(startBox!.x + 2, startBox!.y + startBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    endBox!.x + endBox!.width - 2,
    endBox!.y + endBox!.height / 2,
    { steps: 6 }
  );
  await page.mouse.up();

  // A highlight annotation should now be persisted.
  await expect
    .poll(() => annotationCountOfType(page, 'highlight'), { timeout: 10_000 })
    .toBeGreaterThan(beforeHighlights);
});

test('multi-tool: ink, box highlight, and freetext all persist together', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loading-text')).toBeHidden({ timeout: 45_000 });

  const pageView = page.locator('.page-view').first();
  await expect(pageView).toBeVisible({ timeout: 45_000 });
  const canvas = pageView.locator('canvas').last();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box).not.toBeNull();

  // 1. Ink stroke. The app defaults to the draw tool active on startup, so
  // only click to activate if it is not already active (clicking an active
  // tool toggles it off).
  const drawBtn = page.locator('.tool-btn[data-tool="draw"]');
  const drawActive = await drawBtn.evaluate((el) => el.classList.contains('active'));
  if (!drawActive) {
    await drawBtn.click();
  }
  await expect(drawBtn).toHaveClass(/active/);
  {
    const startX = box.x + box.width * 0.3;
    const startY = box.y + box.height * 0.3;
    const endX = box.x + box.width * 0.6;
    const endY = box.y + box.height * 0.6;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / steps,
        startY + ((endY - startY) * i) / steps
      );
    }
    await page.mouse.up();
  }

  await expect
    .poll(() => annotationCountOfType(page, 'ink'), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 2. Box highlight (right blank margin, avoiding text spans).
  await page.locator('.tool-btn[data-tool="highlight"]').click();
  await page.locator('.hl-mode-btn[data-hl-mode="box"]').click();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.55, {
    steps: 5,
  });
  await page.mouse.up();

  await expect
    .poll(() => annotationCountOfType(page, 'highlight'), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 3. FreeText (click at the proven-reachable region, then type & commit).
  await page.locator('.tool-btn[data-tool="freetext"]').click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  // Wait for the editor's contentEditable to appear, then type directly into it
  // (focus is applied asynchronously by the tool, so target the element).
  const editorContent = page.locator('.freetext-editor.editing .editor-content');
  await expect(editorContent).toBeVisible({ timeout: 10_000 });
  await editorContent.click();
  await editorContent.type('hello e2e');
  // Commit by pressing Escape (persists non-empty content).
  await page.keyboard.press('Escape');

  await expect
    .poll(() => annotationCountOfType(page, 'freetext'), { timeout: 10_000 })
    .toBeGreaterThan(0);
});
