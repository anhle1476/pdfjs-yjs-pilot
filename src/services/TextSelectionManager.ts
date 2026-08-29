import { TextLayerService, TextNodeInfo } from './TextLayerService';

export interface TextRange {
  pageNumber: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  text: string;
}

/**
 * Manager to handle text selection using the Selection API.
 */
export class TextSelectionManager {
  private _selection: Selection | null = null;
  private _textLayerService: TextLayerService;

  constructor(textLayerService: TextLayerService) {
    this._textLayerService = textLayerService;
  }

  /**
   * Captures the current browser selection and returns text range info.
   */
  public getSelection(): TextRange[] {
    this._selection = window.getSelection();
    if (!this._selection || this._selection.isCollapsed) return [];

    const ranges: TextRange[] = [];
    for (let i = 0; i < this._selection.rangeCount; i++) {
      const range = this._selection.getRangeAt(i);
      const container = range.commonAncestorContainer;

      // Find which page this range belongs to
      let pageView = container instanceof HTMLElement ? container.closest('.page-view') : container.parentElement?.closest('.page-view');
      if (!pageView) continue;

      const pageNumber = parseInt((pageView as HTMLElement).dataset.pageNumber || '1', 10);
      const rects = range.getClientRects();
      const pageRect = pageView.getBoundingClientRect();

      for (const rect of Array.from(rects)) {
        ranges.push({
          pageNumber,
          startX: (rect.left - pageRect.left) / pageRect.width,
          startY: (rect.top - pageRect.top) / pageRect.height,
          endX: (rect.right - pageRect.left) / pageRect.width,
          endY: (rect.bottom - pageRect.top) / pageRect.height,
          text: range.toString()
        });
      }
    }

    return ranges;
  }

  /**
   * Clears the current selection.
   */
  public clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    this._selection = null;
  }
}
