import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock pdfjs-dist so PageController can render pages in jsdom without a real
// PDF/worker. We stub the parts PageController touches: getDocument is not used
// here (we inject a mock PDFDocumentProxy directly), TextLayer.render resolves,
// and each page proxy's render()/getTextContent() resolve.
vi.mock('pdfjs-dist', () => {
  class TextLayer {
    render() {
      return Promise.resolve();
    }
  }
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    TextLayer,
    getDocument: vi.fn(),
  };
});

import { PageController } from '../../../src/lib/controllers/PageController';
import { ViewModeController } from '../../../src/lib/controllers/ViewModeController';

function makeMockViewport(scale = 1) {
  return {
    width: 600 * scale,
    height: 800 * scale,
    scale,
    clone(opts?: { scale?: number; rotation?: number }) {
      return makeMockViewport(opts?.scale ?? scale);
    },
  } as any;
}

function makeMockPdfDoc(numPages: number, hooks?: {
  getTextContent?: () => Promise<any>;
  makeRenderTask?: () => any;
}) {
  const getTextContent =
    hooks?.getTextContent ?? (async () => ({ items: [], styles: {} }));
  return {
    numPages,
    getPage: vi.fn(async (_pageNumber: number) => {
      return {
        getViewport: (opts?: { scale?: number }) =>
          makeMockViewport(opts?.scale ?? 1),
        render: () =>
          hooks?.makeRenderTask
            ? hooks.makeRenderTask()
            : { promise: Promise.resolve(), cancel: () => {} },
        getTextContent,
      } as any;
    }),
  } as any;
}

describe('PageController view-mode rebuild (Bug 3)', () => {
  let container: HTMLElement;
  let vmc: ViewModeController;
  let controller: PageController;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    vmc = new ViewModeController();
    controller = new PageController(container, vmc);
  });

  it('single (page 2) then scroll renders exactly one ordered 1..N sequence', async () => {
    const N = 5;
    const doc = makeMockPdfDoc(N);
    await controller.initialize(doc); // starts in scroll mode

    // Switch to single mode and navigate to page 2.
    await controller.setViewMode('single');
    controller.setCurrentPage(2);
    // Allow the async renderVisiblePages triggered by setCurrentPage to settle.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    let views = controller.getAllPageViews();
    expect(views.map((v) => v.pageNumber)).toEqual([2]);

    // Switch back to scroll — must produce exactly pages 1..N with no dup.
    await controller.setViewMode('scroll');

    views = controller.getAllPageViews();
    expect(views).toHaveLength(N);
    expect(views.map((v) => v.pageNumber)).toEqual([1, 2, 3, 4, 5]);

    // DOM must contain exactly N page-view nodes in order 1..N (no leftover
    // page-2 node from single mode).
    const nodes = Array.from(
      container.querySelectorAll('.page-view')
    ) as HTMLElement[];
    expect(nodes).toHaveLength(N);
    expect(nodes.map((n) => n.dataset.pageNumber)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    // First rendered node is page 1, not the duplicated page 2.
    expect(nodes[0].dataset.pageNumber).toBe('1');
  });

  it('scroll mode renders 1..N with no duplicates on initialize', async () => {
    const N = 3;
    const doc = makeMockPdfDoc(N);
    await controller.initialize(doc);

    const views = controller.getAllPageViews();
    expect(views).toHaveLength(N);
    expect(views.map((v) => v.pageNumber)).toEqual([1, 2, 3]);
    expect(container.querySelectorAll('.page-view')).toHaveLength(N);
  });
});

describe('PageController virtualization + performance', () => {
  let container: HTMLElement;
  let vmc: ViewModeController;
  let controller: PageController;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    vmc = new ViewModeController();
    controller = new PageController(container, vmc);

    // jsdom has no 2D canvas backend; stub a minimal context so the render
    // path (raster + text layer + onPageRendered) can execute.
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
      setTransform: () => {},
      scale: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillRect: () => {},
    }));
  });

  it('scroll mode renders an initial batch and leaves the rest as placeholders', async () => {
    // jsdom has no IntersectionObserver; scroll init eagerly renders only the
    // initial viewport batch (2 pages when sizes are unmeasurable) and leaves
    // the remaining pages as placeholders until scrolled near.
    const doc = makeMockPdfDoc(5);
    await controller.initialize(doc);
    await new Promise((r) => setTimeout(r, 0));

    const views = controller.getAllPageViews();
    expect(views).toHaveLength(5);
    const renderedNums = views.filter((v) => v.rendered).map((v) => v.pageNumber);
    // Only the leading batch is rendered; NOT every page (virtualization).
    expect(renderedNums.length).toBeLessThan(5);
    expect(renderedNums).toContain(1);
    // Pages beyond the batch remain placeholders.
    expect(views.some((v) => !v.rendered)).toBe(true);
  });

  it('single mode eagerly renders the current page and fires onPageRendered', async () => {
    const doc = makeMockPdfDoc(4);

    const rendered: number[] = [];
    controller.onPageRendered((n) => rendered.push(n));

    await controller.initialize(doc);
    await controller.setViewMode('single');
    // Allow the eager render's async text-layer step to settle.
    await new Promise((r) => setTimeout(r, 0));

    const views = controller.getAllPageViews();
    expect(views.map((v) => v.pageNumber)).toEqual([1]);
    expect(views[0].rendered).toBe(true);
    expect(rendered).toContain(1);
  });

  it('caches getTextContent per page (no duplicate fetch for the same page)', async () => {
    const perPageCalls = new Map<number, number>();
    const doc = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => ({
        getViewport: (opts?: { scale?: number }) =>
          makeMockViewport(opts?.scale ?? 1),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        getTextContent: async () => {
          perPageCalls.set(pageNumber, (perPageCalls.get(pageNumber) ?? 0) + 1);
          return { items: [], styles: {} };
        },
      })),
    } as any;

    await controller.initialize(doc); // scroll: renders initial batch (pages 1,2)
    await controller.setViewMode('single'); // re-renders page 1 -> cache hit
    await new Promise((r) => setTimeout(r, 0));

    // Page 1 fetched exactly once despite being rendered in both views.
    expect(perPageCalls.get(1)).toBe(1);

    // The public accessor also reuses the cache (no extra fetch).
    await controller.getPageTextContent(1);
    expect(perPageCalls.get(1)).toBe(1);
  });

  it('in-place scale does NOT tear down the text layer / DOM (same wrapper reused)', async () => {
    const doc = makeMockPdfDoc(3);
    await controller.initialize(doc);
    await controller.setViewMode('single');
    await new Promise((r) => setTimeout(r, 0));

    const before = controller.getPageView(1)!;
    const beforeWrapper = before.container;
    const beforeTextLayer = before.textLayer;

    controller.updateScale(2);
    // updateScale is debounced; wait past the debounce window.
    await new Promise((r) => setTimeout(r, 150));

    const after = controller.getPageView(1)!;
    // Same PageView + DOM nodes reused (no innerHTML wipe / re-create).
    expect(after).toBe(before);
    expect(after.container).toBe(beforeWrapper);
    expect(after.textLayer).toBe(beforeTextLayer);
    // Wrapper resized to the new scale.
    expect(after.container.style.width).toBe('1200px');
    expect(after.textLayer.style.getPropertyValue('--total-scale-factor')).toBe(
      '2'
    );
  });

  it('cancels an in-flight RenderTask when a page re-renders (rapid zoom)', async () => {
    const cancels: number[] = [];
    let taskId = 0;
    let zoomStarted = false;
    // Before the first zoom, render tasks resolve so initialize()/setViewMode()
    // complete. Once zooming starts, re-raster tasks stay in-flight so we can
    // observe the NEXT re-raster cancelling the previous one.
    const doc = makeMockPdfDoc(3, {
      makeRenderTask: () => {
        const id = ++taskId;
        if (!zoomStarted) {
          return { promise: Promise.resolve(), cancel: () => cancels.push(id) };
        }
        return {
          promise: new Promise(() => {}),
          cancel: () => cancels.push(id),
        };
      },
    });
    await controller.initialize(doc);
    await controller.setViewMode('single'); // page 1 rendered
    await new Promise((r) => setTimeout(r, 0));

    zoomStarted = true;
    // First zoom -> re-raster starts an in-flight task.
    controller.updateScale(1.5);
    await new Promise((r) => setTimeout(r, 150));
    const cancelsAfterFirstZoom = cancels.length;
    // Second zoom -> re-raster must cancel the in-flight task from the first
    // zoom before starting a new one.
    controller.updateScale(2);
    await new Promise((r) => setTimeout(r, 150));

    expect(cancels.length).toBeGreaterThan(cancelsAfterFirstZoom);
  });
});
