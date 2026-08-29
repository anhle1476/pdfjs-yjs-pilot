import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

export interface TextNodeInfo {
  element: HTMLElement;
  text: string;
  bounds: DOMRect;
  pageNumber: number;
}

/**
 * Service to manage interaction with the PDF.js Text Layer.
 */
export class TextLayerService {
  private _container: HTMLElement;

  constructor(container: HTMLElement) {
    this._container = container;
  }

  /**
   * Find all text nodes within a given page that are partially or fully within the specified bounds.
   * @param pageNumber The page number to search in.
   * @param bounds The bounds in viewport coordinates.
   */
  public findTextNodesInRange(pageNumber: number, bounds: { x: number, y: number, width: number, height: number }): TextNodeInfo[] {
    const pageView = this._container.querySelector(`.page-view[data-page-number="${pageNumber}"]`);
    if (!pageView) return [];

    const textLayer = pageView.querySelector('.text-layer');
    if (!textLayer) return [];

    const result: TextNodeInfo[] = [];
    const spans = textLayer.querySelectorAll('span');

    for (const span of Array.from(spans)) {
      const rect = span.getBoundingClientRect();
      const pageRect = pageView.getBoundingClientRect();

      // Convert to local coordinates within the page view
      const localRect = {
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top,
        width: rect.width,
        height: rect.height
      };

      // Check for overlap
      if (
        localRect.left < bounds.x + bounds.width &&
        localRect.right > bounds.x &&
        localRect.top < bounds.y + bounds.height &&
        localRect.bottom > bounds.y
      ) {
        result.push({
          element: span,
          text: span.textContent || '',
          bounds: span.getBoundingClientRect(),
          pageNumber
        });
      }
    }

    return result;
  }

  /**
   * Get all text nodes for a specific page.
   */
  public getTextNodesForPage(pageNumber: number): TextNodeInfo[] {
    const pageView = this._container.querySelector(`.page-view[data-page-number="${pageNumber}"]`);
    if (!pageView) return [];

    const textLayer = pageView.querySelector('.text-layer');
    if (!textLayer) return [];

    const spans = textLayer.querySelectorAll('span');
    return Array.from(spans).map(span => ({
      element: span,
      text: span.textContent || '',
      bounds: span.getBoundingClientRect(),
      pageNumber
    }));
  }
}
