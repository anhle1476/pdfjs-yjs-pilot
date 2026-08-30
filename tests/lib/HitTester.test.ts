import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnnotationStore } from '../../src/lib/AnnotationStore';
import { hitTest, HitTester } from '../../src/lib/HitTester';
import { HighlightTool } from '../../src/lib/tools/HighlightTool';
import type { PdfRenderer } from '../../src/lib/PdfRenderer';

/**
 * The hitTest helper only calls renderer.getPageAtClientPoint and
 * renderer.toNormalizedPoint, so a minimal stub is sufficient and lets us
 * unit-test hit resolution without loading a real PDF.
 *
 * The stub maps client coordinates directly to normalized coordinates
 * (divided by 1000) and always reports page 1.
 */
function makeStubRenderer(): PdfRenderer {
  return {
    getPageAtClientPoint: (x: number, y: number) => {
      if (x < 0 || y < 0) return null;
      return { pageNumber: 1, pageView: {} as any };
    },
    toNormalizedPoint: (_page: number, x: number, y: number) => {
      return { x: x / 1000, y: y / 1000 };
    },
  } as unknown as PdfRenderer;
}

/**
 * Build a hittable box-mode highlight (real svgPath outline + polygon) on
 * page 1 spanning the given normalized rect, via the production tool path.
 */
function addBoxHighlight(
  store: AnnotationStore,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const tool = new HighlightTool(store, { mode: 'box' });
  const obj = tool.createFromBoxes(1, [{ x, y, width: w, height: h }], 1000, 800)!;
  // Give the test a deterministic id for assertions.
  store.remove(obj.id);
  obj.id = id;
  store.add(obj);
  return obj;
}

describe('HitTester', () => {
  it('returns the object under the point', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));
    const obj = addBoxHighlight(store, 'a', 0.1, 0.1, 0.2, 0.2);

    const renderer = makeStubRenderer();
    // Client point at the center of the object's bounds (x1000 stub scale).
    const b = obj.getBounds();
    const cx = (b.x + b.width / 2) * 1000;
    const cy = (b.y + b.height / 2) * 1000;
    const result = hitTest(renderer, store, cx, cy);
    expect(result).not.toBeNull();
    expect(result!.pageNumber).toBe(1);
    expect(result!.hit).not.toBeNull();
    expect(result!.hit!.id).toBe('a');
  });

  it('returns hit=null when the point is over no object', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));
    addBoxHighlight(store, 'a', 0.1, 0.1, 0.1, 0.1);

    const renderer = makeStubRenderer();
    // Point (900,900) → normalized (0.9,0.9), well outside a.
    const result = hitTest(renderer, store, 900, 900);
    expect(result).not.toBeNull();
    expect(result!.hit).toBeNull();
  });

  it('returns null when the point is over no page', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));
    const renderer = makeStubRenderer();
    expect(hitTest(renderer, store, -1, -1)).toBeNull();
  });

  it('top-most (last-added) object wins when objects overlap', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));
    // Two overlapping boxes; b added last should win.
    addBoxHighlight(store, 'a', 0.1, 0.1, 0.4, 0.4);
    const b = addBoxHighlight(store, 'b', 0.1, 0.1, 0.4, 0.4);

    const renderer = makeStubRenderer();
    const bb = b.getBounds();
    const cx = (bb.x + bb.width / 2) * 1000;
    const cy = (bb.y + bb.height / 2) * 1000;
    const result = hitTest(renderer, store, cx, cy);
    expect(result!.hit!.id).toBe('b');
  });

  it('class wrapper delegates to the hitTest function', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));
    const obj = addBoxHighlight(store, 'a', 0.1, 0.1, 0.2, 0.2);

    const renderer = makeStubRenderer();
    const tester = new HitTester(renderer, store);
    const bb = obj.getBounds();
    const result = tester.hitTest(
      (bb.x + bb.width / 2) * 1000,
      (bb.y + bb.height / 2) * 1000
    );
    expect(result!.hit!.id).toBe('a');
  });
});
