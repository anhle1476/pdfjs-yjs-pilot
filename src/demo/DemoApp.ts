// DemoApp — the host-app orchestrator.
//
// This class shows how a host application drives the pure-API lib in src/lib.
// Responsibilities that the lib intentionally does NOT own now live here:
//   - creating the Y.Doc + WebsocketProvider (see ./sync)
//   - binding pointerdown/move/up listeners onto each page's annotation canvas
//   - deciding which lib tool method to call based on the active tool
//   - rendering committed annotations onto each page's annotation canvas
//     (the lib no longer auto-renders; models still expose render())
//   - activating/deactivating the FreeTextTool per page
//
// The lib pieces used: PdfRenderer, AnnotationStore, InkTool, HighlightTool,
// FreeTextTool, HitTester (+ models via the store).

import {
  PdfRenderer,
  AnnotationStore,
  InkTool,
  HighlightTool,
  FreeTextTool,
  HitTester,
  TextLayerService,
  TextSelectionManager,
  type PageView,
  type ViewMode,
  type HighlightMode,
} from '../lib';
import { yAnnotations } from './sync';

export type DemoTool = 'ink' | 'highlight' | 'freetext' | 'select' | null;

export interface DemoAppOptions {
  onPageChange?: (pageNumber: number) => void;
  onZoomChange?: (scale: number) => void;
  onViewModeChange?: (mode: ViewMode) => void;
}

interface CanvasBinding {
  canvas: HTMLCanvasElement;
  pageNumber: number;
  onDown: (e: PointerEvent) => void;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
}

export class DemoApp {
  private options: DemoAppOptions;

  public readonly renderer: PdfRenderer;
  public readonly store: AnnotationStore;
  public readonly inkTool: InkTool;
  public readonly highlightTool: HighlightTool;
  public readonly freeTextTool: FreeTextTool;
  public readonly hitTester: HitTester;

  private textSelectionManager: TextSelectionManager;

  private currentTool: DemoTool = null;

  // Raw pixel points collected during an in-progress stroke, used purely to
  // draw a transient preview (the committed geometry comes from the lib).
  private previewPoints: { x: number; y: number }[] = [];
  private activePointerPage: number | null = null;

  // Box-mode highlight drag state (normalized 0-1 within the page).
  private boxStart: { x: number; y: number } | null = null;
  private boxCurrent: { x: number; y: number } | null = null;

  // Currently selected annotation id (via the 'select' tool / hit testing).
  private selectedId: string | null = null;

  private bindings: CanvasBinding[] = [];
  private storeUnsub: (() => void) | null = null;
  private onDocumentMouseUp: (() => void) | null = null;

  constructor(container: HTMLElement, options: DemoAppOptions = {}) {
    this.options = options;

    this.renderer = new PdfRenderer(container);
    this.store = new AnnotationStore(yAnnotations);
    this.inkTool = new InkTool(this.store, { color: '#2563eb', strokeWidth: 2 });
    this.highlightTool = new HighlightTool(this.store, {
      color: '#fff066',
      opacity: 0.4,
      mode: 'free', // demo drives highlight via freeform drag
    });
    this.freeTextTool = new FreeTextTool(this.store, {
      defaultFontSize: 12,
      defaultColor: '#000000',
    });

    this.hitTester = new HitTester(this.renderer, this.store);
    // The text-selection manager resolves the browser selection into
    // normalized per-page ranges. Its TextLayerService is scoped to the
    // renderer's container so span queries stay within this viewer.
    this.textSelectionManager = new TextSelectionManager(
      new TextLayerService(container)
    );
  }

  public async loadDocument(url: string): Promise<void> {
    await this.renderer.loadDocument(url);

    // Bind pointer listeners onto every rendered page's annotation canvas.
    this.rebindCanvases();

    // Activate the freetext tool for the current page container.
    this.activateFreeTextForCurrentPage();

    // Re-render committed annotations for every page.
    this.renderAllPages();

    // Re-render (and rebuild freetext editors) when the shared doc changes,
    // whether from local edits or remote peers.
    this.storeUnsub = this.store.subscribe(() => {
      this.renderAllPages();
      this.freeTextTool.setPageNumber(this.renderer.getCurrentPage());
    });

    // Text-mode highlight: when the highlight tool is active AND in text mode,
    // a completed text selection (mouseup) becomes one highlight per client
    // rect. This mirrors the original HighlightPlugin's selection listener.
    this.onDocumentMouseUp = () => {
      if (this.currentTool !== 'highlight' || this.highlightTool.mode !== 'text') {
        return;
      }
      const ranges = this.textSelectionManager.getSelection();
      if (ranges.length === 0) return;
      for (const range of ranges) {
        this.highlightTool.createFromTextRange(range.pageNumber, {
          startX: range.startX,
          startY: range.startY,
          endX: range.endX,
          endY: range.endY,
        });
      }
      this.textSelectionManager.clearSelection();
      this.renderAllPages();
    };
    document.addEventListener('mouseup', this.onDocumentMouseUp);

    // React to navigation: rebind canvases (single-page mode swaps the DOM),
    // and move the freetext editor container to the new page.
    this.renderer.onPageChange((pageNumber) => {
      this.rebindCanvases();
      this.activateFreeTextForCurrentPage();
      this.renderAllPages();
      this.options.onPageChange?.(pageNumber);
    });

    this.renderer.onZoomChange((scale) => {
      // Zoom rebuilds page canvases; rebind + re-render.
      this.rebindCanvases();
      this.activateFreeTextForCurrentPage();
      this.renderAllPages();
      this.options.onZoomChange?.(scale);
    });

    this.renderer.onRotationChange(() => {
      this.rebindCanvases();
      this.activateFreeTextForCurrentPage();
      this.renderAllPages();
    });

    this.renderer.onViewModeChange((mode) => {
      this.rebindCanvases();
      this.activateFreeTextForCurrentPage();
      this.renderAllPages();
      this.options.onViewModeChange?.(mode);
    });
  }

  // ----- Tool management -----

  public setTool(tool: DemoTool): void {
    if (this.currentTool === 'freetext' && tool !== 'freetext') {
      // Leaving freetext: keep editors visible but commit any active one.
      this.freeTextTool.setPageNumber(this.renderer.getCurrentPage());
    }
    this.currentTool = tool;

    // Toggle pointer-events so freetext editors are only interactive when the
    // freetext tool is active; otherwise the annotation canvas gets the events.
    this.updateCanvasInteractivity();

    if (tool === 'freetext') {
      this.activateFreeTextForCurrentPage();
    }
  }

  public getTool(): DemoTool {
    return this.currentTool;
  }

  /**
   * Switch the highlight tool's sub-mode: 'free' (drag paint), 'box' (drag a
   * rectangle) or 'text' (highlight the current text selection).
   */
  public setHighlightMode(mode: HighlightMode): void {
    this.highlightTool.setMode(mode);
  }

  public getHighlightMode(): HighlightMode {
    return this.highlightTool.mode;
  }

  public getSelectedId(): string | null {
    return this.selectedId;
  }

  private updateCanvasInteractivity(): void {
    for (const { canvas } of this.bindings) {
      // The annotation canvas always receives pointer events; freetext editor
      // DOM sits above and has its own pointer-events via CSS.
      canvas.style.pointerEvents = 'auto';
    }
  }

  // ----- Canvas binding -----

  private rebindCanvases(): void {
    this.unbindCanvases();

    for (const pageView of this.renderer.getAllPageViews()) {
      this.bindCanvas(pageView);
    }
  }

  private unbindCanvases(): void {
    for (const b of this.bindings) {
      b.canvas.removeEventListener('pointerdown', b.onDown);
      b.canvas.removeEventListener('pointermove', b.onMove);
      b.canvas.removeEventListener('pointerup', b.onUp);
    }
    this.bindings = [];
  }

  private bindCanvas(pageView: PageView): void {
    const canvas = pageView.annotationCanvas;
    const pageNumber = pageView.pageNumber;

    const onDown = (e: PointerEvent) => this.handlePointerDown(e, pageView);
    const onMove = (e: PointerEvent) => this.handlePointerMove(e, pageView);
    const onUp = (e: PointerEvent) => this.handlePointerUp(e, pageView);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);

    this.bindings.push({ canvas, pageNumber, onDown, onMove, onUp });
  }

  // ----- Pointer coordinate helpers -----

  /**
   * Return the pointer position expressed in the annotation canvas' backing
   * pixel space (canvas.width/height, DPR-scaled). Ink/Highlight tools expect
   * pixel coordinates in this space.
   */
  private toCanvasPixels(
    pageView: PageView,
    e: PointerEvent
  ): { x: number; y: number } {
    const rect = pageView.annotationCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    return {
      x: nx * pageView.annotationCanvas.width,
      y: ny * pageView.annotationCanvas.height,
    };
  }

  private toNormalized(
    pageView: PageView,
    e: PointerEvent
  ): { x: number; y: number } {
    const rect = pageView.annotationCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  // ----- Pointer dispatch -----

  private handlePointerDown(e: PointerEvent, pageView: PageView): void {
    const canvas = pageView.annotationCanvas;

    if (this.currentTool === 'ink') {
      canvas.setPointerCapture?.(e.pointerId);
      const { x, y } = this.toCanvasPixels(pageView, e);
      this.previewPoints = [{ x, y }];
      this.activePointerPage = pageView.pageNumber;
      this.inkTool.beginStroke(
        pageView.pageNumber,
        canvas.width,
        canvas.height,
        x,
        y
      );
    } else if (this.currentTool === 'highlight') {
      // Text mode is handled by the document mouseup selection listener; do
      // not start a drag stroke in that case.
      if (this.highlightTool.mode === 'text') return;

      canvas.setPointerCapture?.(e.pointerId);
      this.activePointerPage = pageView.pageNumber;

      if (this.highlightTool.mode === 'box') {
        const norm = this.toNormalized(pageView, e);
        this.boxStart = { x: norm.x, y: norm.y };
        this.boxCurrent = { x: norm.x, y: norm.y };
      } else {
        const { x, y } = this.toCanvasPixels(pageView, e);
        this.previewPoints = [{ x, y }];
        this.highlightTool.beginFreeform(
          pageView.pageNumber,
          canvas.width,
          canvas.height,
          x,
          y
        );
      }
    } else if (this.currentTool === 'select') {
      // Hit test the point; select the top-most annotation under it (if any).
      const result = this.hitTester.hitTest(e.clientX, e.clientY);
      this.selectedId = result?.hit?.id ?? null;
      this.renderAllPages();
    } else if (this.currentTool === 'freetext') {
      // If the pointerdown landed on an existing editor DOM, ignore it — the
      // editor handles its own interaction. Otherwise spawn a new editor.
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.freetext-editor')) {
        return;
      }
      const norm = this.toNormalized(pageView, e);
      this.freeTextTool.setPageNumber(pageView.pageNumber);
      this.freeTextTool.createAt(norm.x, norm.y);
    }
  }

  private handlePointerMove(e: PointerEvent, pageView: PageView): void {
    if (this.activePointerPage !== pageView.pageNumber) return;

    if (this.currentTool === 'ink') {
      const { x, y } = this.toCanvasPixels(pageView, e);
      const changed = this.inkTool.extendStroke(x, y);
      if (changed) {
        this.previewPoints.push({ x, y });
        this.renderPreview(pageView);
      }
    } else if (this.currentTool === 'highlight') {
      if (this.highlightTool.mode === 'box') {
        const norm = this.toNormalized(pageView, e);
        this.boxCurrent = { x: norm.x, y: norm.y };
        this.renderBoxPreview(pageView);
        return;
      }
      const { x, y } = this.toCanvasPixels(pageView, e);
      const changed = this.highlightTool.extendFreeform(x, y);
      if (changed) {
        this.previewPoints.push({ x, y });
        this.renderPreview(pageView);
      }
    }
  }

  private handlePointerUp(e: PointerEvent, pageView: PageView): void {
    if (this.activePointerPage !== pageView.pageNumber) return;
    const canvas = pageView.annotationCanvas;
    canvas.releasePointerCapture?.(e.pointerId);

    if (this.currentTool === 'ink') {
      const { x, y } = this.toCanvasPixels(pageView, e);
      this.inkTool.endStroke(x, y);
      this.previewPoints = [];
      this.activePointerPage = null;
      this.renderAnnotationsForPage(pageView.pageNumber);
    } else if (this.currentTool === 'highlight') {
      if (this.highlightTool.mode === 'box') {
        if (this.boxStart && this.boxCurrent) {
          const x = Math.min(this.boxStart.x, this.boxCurrent.x);
          const y = Math.min(this.boxStart.y, this.boxCurrent.y);
          const width = Math.abs(this.boxCurrent.x - this.boxStart.x);
          const height = Math.abs(this.boxCurrent.y - this.boxStart.y);
          if (width > 0.001 && height > 0.001) {
            this.highlightTool.createFromBoxes(
              pageView.pageNumber,
              [{ x, y, width, height }],
              canvas.width,
              canvas.height
            );
          }
        }
        this.boxStart = null;
        this.boxCurrent = null;
        this.activePointerPage = null;
        this.renderAnnotationsForPage(pageView.pageNumber);
        return;
      }
      this.highlightTool.endFreeform();
      this.previewPoints = [];
      this.activePointerPage = null;
      this.renderAnnotationsForPage(pageView.pageNumber);
    }
  }

  // ----- Rendering -----

  /**
   * Render all committed annotations for a given page onto its annotation
   * canvas. Uses the model's own render(ctx, width, height); FreeText renders
   * nothing to canvas (it lives as editor DOM managed by FreeTextTool).
   */
  public renderAnnotationsForPage(pageNumber: number): void {
    const pageView = this.renderer.getPageView(pageNumber);
    if (!pageView) return;

    const ctx = pageView.annotationCanvas.getContext('2d');
    if (!ctx) return;

    const w = pageView.annotationCanvas.width;
    const h = pageView.annotationCanvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const obj of this.store.getForPage(pageNumber)) {
      try {
        obj.render(ctx, w, h);
      } catch (err) {
        console.error('Error rendering annotation', obj.id, err);
      }
    }

    // Draw a selection outline around the currently selected annotation.
    if (this.selectedId) {
      const selected = this.store
        .getForPage(pageNumber)
        .find((o) => o.id === this.selectedId);
      if (selected) {
        const b = selected.getBounds();
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(b.x * w, b.y * h, b.width * w, b.height * h);
        ctx.restore();
      }
    }
  }

  /**
   * Draw a transient rectangle preview during a box-mode highlight drag.
   */
  private renderBoxPreview(pageView: PageView): void {
    const ctx = pageView.annotationCanvas.getContext('2d');
    if (!ctx || !this.boxStart || !this.boxCurrent) return;

    this.renderAnnotationsForPage(pageView.pageNumber);

    const w = pageView.annotationCanvas.width;
    const h = pageView.annotationCanvas.height;
    const x = Math.min(this.boxStart.x, this.boxCurrent.x) * w;
    const y = Math.min(this.boxStart.y, this.boxCurrent.y) * h;
    const width = Math.abs(this.boxCurrent.x - this.boxStart.x) * w;
    const height = Math.abs(this.boxCurrent.y - this.boxStart.y) * h;

    ctx.save();
    ctx.fillStyle = this.highlightTool.color;
    ctx.globalAlpha = this.highlightTool.opacity;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  /**
   * Delete the currently selected annotation (if any).
   */
  public deleteSelected(): boolean {
    if (!this.selectedId) return false;
    this.store.remove(this.selectedId);
    this.selectedId = null;
    this.renderAllPages();
    return true;
  }

  private renderAllPages(): void {
    for (const pageView of this.renderer.getAllPageViews()) {
      this.renderAnnotationsForPage(pageView.pageNumber);
    }
  }

  /**
   * Draw a transient preview of the in-progress stroke using the raw pixel
   * points collected during the drag. The committed geometry is produced by
   * the lib on pointerup and rendered via renderAnnotationsForPage.
   */
  private renderPreview(pageView: PageView): void {
    const ctx = pageView.annotationCanvas.getContext('2d');
    if (!ctx) return;

    // Repaint committed annotations first, then overlay the preview.
    this.renderAnnotationsForPage(pageView.pageNumber);

    if (this.previewPoints.length < 2) return;

    ctx.save();
    if (this.currentTool === 'ink') {
      ctx.strokeStyle = this.inkTool.color;
      ctx.lineWidth = this.inkTool.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    } else {
      // highlight
      ctx.strokeStyle = this.highlightTool.color;
      ctx.globalAlpha = this.highlightTool.opacity;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    ctx.beginPath();
    ctx.moveTo(this.previewPoints[0].x, this.previewPoints[0].y);
    for (let i = 1; i < this.previewPoints.length; i++) {
      ctx.lineTo(this.previewPoints[i].x, this.previewPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ----- FreeText activation -----

  private activateFreeTextForCurrentPage(): void {
    const pageView = this.renderer.getCurrentPageView();
    if (!pageView) return;
    // The FreeTextTool attaches its editor container to the page container and
    // rebuilds editors for the page. It is safe to call even when the freetext
    // tool is not the active tool — existing text annotations still render.
    this.freeTextTool.activate(pageView.container, pageView.pageNumber);
  }

  // ----- Color / options passthrough -----

  public setInkColor(color: string): void {
    this.inkTool.setColor(color);
  }

  public setHighlightColor(color: string): void {
    this.highlightTool.setColor(color);
  }

  public setFreeTextColor(color: string): void {
    this.freeTextTool.defaultColor = color;
  }

  // ----- Clear -----

  public clearAnnotations(): void {
    for (const obj of this.store.getAll()) {
      this.store.remove(obj.id);
    }
    this.renderAllPages();
    this.freeTextTool.setPageNumber(this.renderer.getCurrentPage());
  }

  // ----- Navigation passthrough -----

  public nextPage(): void {
    this.renderer.nextPage();
  }
  public previousPage(): void {
    this.renderer.previousPage();
  }
  public zoomIn(): void {
    this.renderer.zoomIn();
  }
  public zoomOut(): void {
    this.renderer.zoomOut();
  }
  public fitToPage(): void {
    this.renderer.fitToPage();
  }
  public rotateClockwise(): void {
    this.renderer.rotateClockwise();
  }
  public async setViewMode(mode: ViewMode): Promise<void> {
    await this.renderer.setViewMode(mode);
  }
  public getViewMode(): ViewMode {
    return this.renderer.getViewMode();
  }
  public getCurrentPage(): number {
    return this.renderer.getCurrentPage();
  }
  public getTotalPages(): number {
    return this.renderer.getTotalPages();
  }
  public getZoomPercent(): number {
    return this.renderer.getZoomPercent();
  }

  public destroy(): void {
    this.unbindCanvases();
    this.storeUnsub?.();
    this.storeUnsub = null;
    if (this.onDocumentMouseUp) {
      document.removeEventListener('mouseup', this.onDocumentMouseUp);
      this.onDocumentMouseUp = null;
    }
    this.freeTextTool.deactivate();
    this.renderer.destroy();
  }
}
