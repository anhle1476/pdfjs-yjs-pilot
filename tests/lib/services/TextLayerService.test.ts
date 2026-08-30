import { describe, expect, it, beforeEach } from 'vitest';
import { TextLayerService } from '../../../src/lib/services/TextLayerService';

// jsdom does not implement layout, so getBoundingClientRect returns zeros.
// We stub it per-element to simulate positioned spans.
function stubRect(el: Element, rect: Partial<DOMRect>): void {
  const full: DOMRect = {
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? 0,
    bottom: rect.bottom ?? 0,
    width: (rect.right ?? 0) - (rect.left ?? 0),
    height: (rect.bottom ?? 0) - (rect.top ?? 0),
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => ({}),
  };
  (el as any).getBoundingClientRect = () => full;
}

function buildContainer(): HTMLElement {
  const container = document.createElement('div');
  const page = document.createElement('div');
  page.className = 'page-view';
  page.dataset.pageNumber = '1';
  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  page.appendChild(textLayer);
  container.appendChild(page);
  document.body.appendChild(container);

  // Page occupies 0,0 → 1000,800.
  stubRect(page, { left: 0, top: 0, right: 1000, bottom: 800 });

  // Span A at 100..200 x, 100..120 y.
  const spanA = document.createElement('span');
  spanA.textContent = 'AAA';
  textLayer.appendChild(spanA);
  stubRect(spanA, { left: 100, top: 100, right: 200, bottom: 120 });

  // Span B at 500..600 x, 400..420 y.
  const spanB = document.createElement('span');
  spanB.textContent = 'BBB';
  textLayer.appendChild(spanB);
  stubRect(spanB, { left: 500, top: 400, right: 600, bottom: 420 });

  return container;
}

describe('TextLayerService', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('getTextNodesForPage returns all spans on the page', () => {
    const container = buildContainer();
    const svc = new TextLayerService(container);
    const nodes = svc.getTextNodesForPage(1);
    expect(nodes.map((n) => n.text)).toEqual(['AAA', 'BBB']);
  });

  it('findTextNodesInRange returns only overlapping spans (page-local px)', () => {
    const container = buildContainer();
    const svc = new TextLayerService(container);
    // Bounds around span A only.
    const hits = svc.findTextNodesInRange(1, { x: 90, y: 90, width: 120, height: 40 });
    expect(hits.map((n) => n.text)).toEqual(['AAA']);
  });

  it('returns empty for a page that does not exist', () => {
    const container = buildContainer();
    const svc = new TextLayerService(container);
    expect(svc.getTextNodesForPage(99)).toEqual([]);
    expect(svc.findTextNodesInRange(99, { x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
  });
});
