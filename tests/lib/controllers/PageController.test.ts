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

function makeMockViewport() {
  return {
    width: 600,
    height: 800,
    clone() {
      return makeMockViewport();
    },
  } as any;
}

function makeMockPdfDoc(numPages: number) {
  return {
    numPages,
    getPage: vi.fn(async (_pageNumber: number) => {
      return {
        getViewport: () => makeMockViewport(),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: [], styles: {} }),
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
