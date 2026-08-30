import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PageController,
  ZoomController,
  RotateController,
  NavigationController,
  ViewModeController,
} from './controllers';
import type { PageView } from './controllers';
import type { ViewMode } from './controllers';

export type { PageView, ViewMode };

export interface PdfRendererOptions {
  workerSrc?: string;
}

/**
 * PdfRenderer — a render/view-only wrapper around the PDF.js page + navigation
 * controllers. It intentionally contains NO annotation/tool logic and installs
 * NO pointer/annotation input listeners. The only listeners in play are the
 * navigation-related keyboard/scroll listeners owned by NavigationController,
 * which are part of the view/navigation feature-set (not annotation input).
 *
 * Coordinate helpers (getPageAtClientPoint / toNormalizedPoint) let a host app
 * translate raw pointer coordinates into page + normalized (0-1) coordinates,
 * which it then feeds into the annotation tools it drives itself.
 */
export class PdfRenderer {
  private container: HTMLElement;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

  private pageController: PageController | null = null;
  private zoomController: ZoomController | null = null;
  private rotateController: RotateController | null = null;
  private viewModeController: ViewModeController | null = null;
  private navigationController: NavigationController | null = null;

  constructor(rootElement: HTMLElement, options: PdfRendererOptions = {}) {
    this.container = rootElement;
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc || pdfWorkerUrl;
  }

  public async loadDocument(url: string): Promise<void> {
    const loadingTask = pdfjsLib.getDocument(url);
    this.pdfDoc = await loadingTask.promise;

    this.setupControllers();
    await this.pageController!.initialize(this.pdfDoc);
  }

  private setupControllers(): void {
    this.viewModeController = new ViewModeController();
    this.pageController = new PageController(this.container, this.viewModeController);
    this.zoomController = new ZoomController();
    this.rotateController = new RotateController();

    this.navigationController = new NavigationController({
      container: this.container,
      pageController: this.pageController,
      zoomController: this.zoomController,
      rotateController: this.rotateController,
      viewModeController: this.viewModeController,
    });
  }

  // ----- Page access -----

  public getPageView(pageNumber: number): PageView | undefined {
    return this.pageController?.getPageView(pageNumber);
  }

  public getAllPageViews(): PageView[] {
    return this.pageController?.getAllPageViews() ?? [];
  }

  public getCurrentPageView(): PageView | undefined {
    return this.pageController?.getCurrentPageView();
  }

  public getCurrentPage(): number {
    return this.navigationController?.getCurrentPage() ?? 1;
  }

  public getTotalPages(): number {
    return this.navigationController?.getTotalPages() ?? 0;
  }

  /**
   * Expose the underlying PDFDocumentProxy for higher-level services (search,
   * outline). Returns null until a document has been loaded.
   */
  public getDocument(): pdfjsLib.PDFDocumentProxy | null {
    return this.pdfDoc ?? this.pageController?.getPdfDoc() ?? null;
  }

  // ----- Navigation -----

  public goToPage(pageNumber: number): void {
    this.navigationController?.goToPage(pageNumber);
  }

  public nextPage(): void {
    this.navigationController?.nextPage();
  }

  public previousPage(): void {
    this.navigationController?.previousPage();
  }

  public firstPage(): void {
    this.navigationController?.firstPage();
  }

  public lastPage(): void {
    this.navigationController?.lastPage();
  }

  // ----- Zoom / rotation -----

  public zoomIn(): void {
    this.navigationController?.zoomIn();
  }

  public zoomOut(): void {
    this.navigationController?.zoomOut();
  }

  public setZoom(scale: number): void {
    this.navigationController?.setZoom(scale);
  }

  public zoomTo(percent: number): void {
    this.navigationController?.zoomTo(percent);
  }

  public fitToWidth(): void {
    this.navigationController?.fitToWidth();
  }

  public fitToPage(): void {
    this.navigationController?.fitToPage();
  }

  public rotateClockwise(): void {
    this.navigationController?.rotateClockwise();
  }

  public rotateCounterClockwise(): void {
    this.navigationController?.rotateCounterClockwise();
  }

  public setRotation(degrees: number): void {
    this.navigationController?.setRotation(degrees);
  }

  public getZoom(): number {
    return this.navigationController?.getZoom() ?? 1;
  }

  public getZoomPercent(): number {
    return this.navigationController?.getZoomPercent() ?? 100;
  }

  public getRotation(): number {
    return this.navigationController?.getRotation() ?? 0;
  }

  // ----- View mode -----

  public getViewMode(): ViewMode {
    return this.navigationController?.getViewMode() ?? 'scroll';
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    await this.navigationController?.setViewMode(mode);
  }

  public toggleScrollMode(): void {
    this.navigationController?.toggleScrollMode();
  }

  public toggleSingleMode(): void {
    this.navigationController?.toggleSingleMode();
  }

  // ----- Subscriptions (return unsubscribe fn) -----

  public onPageChange(callback: (pageNumber: number) => void): () => void {
    return this.navigationController?.onPageChange(callback) ?? (() => {});
  }

  public onZoomChange(callback: (scale: number) => void): () => void {
    return this.navigationController?.onZoomChange(callback) ?? (() => {});
  }

  public onRotationChange(callback: (rotation: number) => void): () => void {
    return this.navigationController?.onRotationChange(callback) ?? (() => {});
  }

  public onViewModeChange(callback: (mode: ViewMode) => void): () => void {
    return this.navigationController?.onViewModeChange(callback) ?? (() => {});
  }

  /**
   * Subscribe to per-page render completion (lazy scroll render + in-place
   * zoom/rotation re-raster of visible pages). The host uses this to (re)bind
   * a newly-rendered page's canvas and (re)apply annotations / search
   * highlights for that page — required for correctness with virtualization,
   * where pages far from the viewport are placeholders until scrolled near.
   */
  public onPageRendered(callback: (pageNumber: number) => void): () => void {
    return this.pageController?.onPageRendered(callback) ?? (() => {});
  }

  // ----- Coordinate helpers (NEW) -----

  /**
   * Given a client (viewport) point, find which rendered page contains it.
   * Iterates over all page views and tests against each page container's
   * bounding rect. Returns null if the point is over no page.
   */
  public getPageAtClientPoint(
    clientX: number,
    clientY: number
  ): { pageNumber: number; pageView: PageView } | null {
    for (const pageView of this.getAllPageViews()) {
      const rect = pageView.container.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { pageNumber: pageView.pageNumber, pageView };
      }
    }
    return null;
  }

  /**
   * Convert a client (viewport) point into normalized (0-1) coordinates
   * within the given page's annotation canvas. Returns null if the page is
   * not rendered.
   */
  public toNormalizedPoint(
    pageNumber: number,
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null {
    const pageView = this.getPageView(pageNumber);
    if (!pageView) return null;

    const rect = pageView.annotationCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }

  // ----- Lifecycle -----

  public getPageController(): PageController | null {
    return this.pageController;
  }

  public getNavigationController(): NavigationController | null {
    return this.navigationController;
  }

  public destroy(): void {
    this.navigationController?.destroy();
    this.pageController?.destroy();
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
