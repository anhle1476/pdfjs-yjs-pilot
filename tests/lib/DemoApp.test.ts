import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

// Avoid the real WebsocketProvider (no network in jsdom): expose a plain Y.Array.
vi.mock('../../src/demo/sync', () => {
  const doc = new Y.Doc();
  return {
    doc,
    yAnnotations: doc.getArray('annotations'),
    provider: { on: () => {} },
  };
});

// Mock pdfjs-dist so importing PdfRenderer (via DemoApp) does not pull the real
// worker. DemoApp constructs a PdfRenderer but we never call loadDocument in
// this test; we drive the tool state and inject fake page views instead.
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

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

import { DemoApp } from '../../src/demo/DemoApp';
import type { PageView } from '../../src/lib';

function makeFakePageView(pageNumber: number): PageView {
  const container = document.createElement('div');
  container.className = 'page-view';
  const annotationCanvas = document.createElement('canvas');
  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  container.appendChild(annotationCanvas);
  container.appendChild(textLayer);
  return {
    pageNumber,
    pageProxy: {} as any,
    viewport: {} as any,
    container,
    viewerCanvas: document.createElement('canvas'),
    annotationCanvas,
    textLayer,
    scale: 1,
    rotation: 0,
  };
}

describe('DemoApp text-selection blocking (Bug 4)', () => {
  let app: DemoApp;
  let pageViews: PageView[];

  beforeEach(() => {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);

    app = new DemoApp(container);
    pageViews = [makeFakePageView(1), makeFakePageView(2)];

    // Inject fake page views so rebindCanvases / updateCanvasInteractivity have
    // something to iterate over.
    vi.spyOn(app.renderer, 'getAllPageViews').mockReturnValue(pageViews);
    vi.spyOn(app.renderer, 'getCurrentPage').mockReturnValue(1);
    vi.spyOn(app.renderer, 'getCurrentPageView').mockReturnValue(pageViews[0]);
    vi.spyOn(app.renderer, 'getPageView').mockImplementation((n: number) =>
      pageViews.find((p) => p.pageNumber === n)
    );

    // Bind canvases so the bindings array (used by updateCanvasInteractivity)
    // is populated for the fake page views.
    (app as any).rebindCanvases();
  });

  it('setTool("ink") marks every text layer drawing-active', () => {
    app.setTool('ink');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(true);
    }
  });

  it('setTool("select") clears drawing-active (text selectable)', () => {
    app.setTool('ink');
    app.setTool('select');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(false);
    }
  });

  it('highlight free/box mode blocks selection, text mode allows it', () => {
    app.setTool('highlight');
    app.setHighlightMode('box');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(true);
    }
    app.setHighlightMode('free');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(true);
    }
    app.setHighlightMode('text');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(false);
    }
  });

  it('freetext tool blocks text selection', () => {
    app.setTool('freetext');
    for (const pv of pageViews) {
      expect(pv.textLayer.classList.contains('drawing-active')).toBe(true);
    }
  });
});
