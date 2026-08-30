// TextSelectionManager — framework-free wrapper over the browser Selection API,
// ported from the original src/services/TextSelectionManager.ts.
//
// It reads the current window selection and, for each client rect of each
// range, resolves the owning `.page-view` and emits a normalized (0-1) text
// range relative to that page. The host app (e.g. DemoApp) calls
// `getSelection()` on `mouseup`/`selectionchange` while the highlight tool is
// in text mode, then feeds each range to HighlightTool.createFromTextRange.
//
// This class owns NO DOM and installs NO listeners — the host owns input.

import { TextLayerService } from './TextLayerService';

export interface SelectedTextRange {
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
  // Kept for parity with the original API surface; the service is available to
  // hosts that want span-level queries alongside selection ranges.
  private _textLayerService: TextLayerService;

  constructor(textLayerService: TextLayerService) {
    this._textLayerService = textLayerService;
  }

  public get textLayerService(): TextLayerService {
    return this._textLayerService;
  }

  /**
   * Captures the current browser selection and returns normalized text range
   * info per client rect. Returns an empty array when there is no selection or
   * the selection is collapsed.
   */
  public getSelection(): SelectedTextRange[] {
    this._selection = window.getSelection();
    if (!this._selection || this._selection.isCollapsed) return [];

    const ranges: SelectedTextRange[] = [];
    for (let i = 0; i < this._selection.rangeCount; i++) {
      const range = this._selection.getRangeAt(i);
      const container = range.commonAncestorContainer;

      // Find which page this range belongs to.
      const pageView =
        container instanceof HTMLElement
          ? container.closest('.page-view')
          : container.parentElement?.closest('.page-view');
      if (!pageView) continue;

      const pageNumber = parseInt(
        (pageView as HTMLElement).dataset.pageNumber || '1',
        10
      );
      const rects = range.getClientRects();
      const pageRect = pageView.getBoundingClientRect();
      if (pageRect.width === 0 || pageRect.height === 0) continue;

      for (const rect of Array.from(rects)) {
        // Skip zero-size rects (e.g. collapsed line breaks).
        if (rect.width === 0 || rect.height === 0) continue;
        ranges.push({
          pageNumber,
          startX: (rect.left - pageRect.left) / pageRect.width,
          startY: (rect.top - pageRect.top) / pageRect.height,
          endX: (rect.right - pageRect.left) / pageRect.width,
          endY: (rect.bottom - pageRect.top) / pageRect.height,
          text: range.toString(),
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
