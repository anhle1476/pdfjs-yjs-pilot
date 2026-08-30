// TextLayerService — framework-free query layer over the PDF.js text layer,
// ported from the original src/services/TextLayerService.ts.
//
// Given a root container that holds `.page-view[data-page-number]` elements
// (each containing a `.text-layer` with per-glyph <span>s produced by the
// pdf.js TextLayer), this service finds the text spans that fall within a
// bounds rectangle (expressed in page-local pixel coordinates) or lists all
// spans for a page. It owns NO DOM and installs NO listeners.

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
   * Find all text nodes within a given page that are partially or fully within
   * the specified bounds (page-local pixel coordinates).
   */
  public findTextNodesInRange(
    pageNumber: number,
    bounds: { x: number; y: number; width: number; height: number }
  ): TextNodeInfo[] {
    const pageView = this._container.querySelector(
      `.page-view[data-page-number="${pageNumber}"]`
    );
    if (!pageView) return [];

    const textLayer = pageView.querySelector('.text-layer');
    if (!textLayer) return [];

    const result: TextNodeInfo[] = [];
    const spans = textLayer.querySelectorAll('span');
    const pageRect = pageView.getBoundingClientRect();

    for (const span of Array.from(spans)) {
      const rect = span.getBoundingClientRect();

      // Convert to local coordinates within the page view.
      const localRect = {
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top,
        width: rect.width,
        height: rect.height,
      };

      // Check for overlap.
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
          pageNumber,
        });
      }
    }

    return result;
  }

  /**
   * Get all text nodes for a specific page.
   */
  public getTextNodesForPage(pageNumber: number): TextNodeInfo[] {
    const pageView = this._container.querySelector(
      `.page-view[data-page-number="${pageNumber}"]`
    );
    if (!pageView) return [];

    const textLayer = pageView.querySelector('.text-layer');
    if (!textLayer) return [];

    const spans = textLayer.querySelectorAll('span');
    return Array.from(spans).map((span) => ({
      element: span,
      text: span.textContent || '',
      bounds: span.getBoundingClientRect(),
      pageNumber,
    }));
  }
}
