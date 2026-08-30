import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TextSelectionManager } from '../../../src/lib/services/TextSelectionManager';
import { TextLayerService } from '../../../src/lib/services/TextLayerService';

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

function makeManager() {
  const container = document.createElement('div');
  const page = document.createElement('div');
  page.className = 'page-view';
  page.dataset.pageNumber = '2';
  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  const span = document.createElement('span');
  span.textContent = 'Selected text';
  textLayer.appendChild(span);
  page.appendChild(textLayer);
  container.appendChild(page);
  document.body.appendChild(container);

  // Page occupies 0,0 → 1000,800.
  stubRect(page, { left: 0, top: 0, right: 1000, bottom: 800 });

  const mgr = new TextSelectionManager(new TextLayerService(container));
  return { container, page, span, mgr };
}

describe('TextSelectionManager', () => {
  const originalGetSelection = window.getSelection;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    window.getSelection = originalGetSelection;
    vi.restoreAllMocks();
  });

  it('returns empty array when selection is collapsed', () => {
    const { mgr } = makeManager();
    window.getSelection = () => ({ isCollapsed: true, rangeCount: 0 } as any);
    expect(mgr.getSelection()).toEqual([]);
  });

  it('returns empty array when there is no selection', () => {
    const { mgr } = makeManager();
    window.getSelection = () => null as any;
    expect(mgr.getSelection()).toEqual([]);
  });

  it('normalizes selection rects to 0-1 relative to the owning page', () => {
    const { span, mgr } = makeManager();

    // A range whose commonAncestorContainer is the span, with one client rect
    // at 250..750 x (0.25..0.75) and 80..120 y (0.1..0.15) on the 1000x800 page.
    const fakeRange = {
      commonAncestorContainer: span,
      getClientRects: () => [
        { left: 250, top: 80, right: 750, bottom: 120, width: 500, height: 40 },
      ],
      toString: () => 'Selected text',
    };

    window.getSelection = () =>
      ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => fakeRange,
      } as any);

    const ranges = mgr.getSelection();
    expect(ranges).toHaveLength(1);
    const r = ranges[0];
    expect(r.pageNumber).toBe(2);
    expect(r.startX).toBeCloseTo(0.25);
    expect(r.startY).toBeCloseTo(0.1);
    expect(r.endX).toBeCloseTo(0.75);
    expect(r.endY).toBeCloseTo(0.15);
    expect(r.text).toBe('Selected text');
  });

  it('skips ranges not inside any page-view', () => {
    const { mgr } = makeManager();
    const orphan = document.createElement('span');
    document.body.appendChild(orphan);

    window.getSelection = () =>
      ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: orphan,
          getClientRects: () => [{ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }],
          toString: () => 'x',
        }),
      } as any);

    expect(mgr.getSelection()).toEqual([]);
  });
});
