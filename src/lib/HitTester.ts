import { PdfRenderer } from './PdfRenderer';
import { AnnotationStore } from './AnnotationStore';
import { AnnotationObject } from './models/AnnotationObject';

export interface HitTestResult {
  pageNumber: number;
  x: number;
  y: number;
  hit: AnnotationObject | null;
}

/**
 * Pure hit-testing helper. Given a client point, it resolves the page and
 * normalized coordinate via the renderer, then walks the annotations on that
 * page (top-most last-created first) invoking each object's own `hitTest`.
 *
 * Returns null only when the point is over no rendered page.
 */
export function hitTest(
  renderer: PdfRenderer,
  store: AnnotationStore,
  clientX: number,
  clientY: number
): HitTestResult | null {
  const pageHit = renderer.getPageAtClientPoint(clientX, clientY);
  if (!pageHit) return null;

  const { pageNumber } = pageHit;
  const norm = renderer.toNormalizedPoint(pageNumber, clientX, clientY);
  if (!norm) return null;

  const objects = store.getForPage(pageNumber);
  // Iterate in reverse so the most recently added (top-most) object wins.
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.hitTest(norm.x, norm.y)) {
      return { pageNumber, x: norm.x, y: norm.y, hit: obj };
    }
  }

  return { pageNumber, x: norm.x, y: norm.y, hit: null };
}

/**
 * Class wrapper for hit-testing, for hosts that prefer an object API.
 */
export class HitTester {
  private renderer: PdfRenderer;
  private store: AnnotationStore;

  constructor(renderer: PdfRenderer, store: AnnotationStore) {
    this.renderer = renderer;
    this.store = store;
  }

  public hitTest(clientX: number, clientY: number): HitTestResult | null {
    return hitTest(this.renderer, this.store, clientX, clientY);
  }
}
