import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { ViewModeController, ViewMode } from './ViewModeController';

export interface PageView {
  pageNumber: number;
  pageProxy: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLElement;
  viewerCanvas: HTMLCanvasElement;
  annotationCanvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  scale: number;
  rotation: number;
}

export class PageController {
  private pdfDoc: PDFDocumentProxy | null = null;
  private container: HTMLElement;
  private pageViews: Map<number, PageView> = new Map();
  private currentPageNumber: number = 1;
  private scale: number = 1;
  private rotation: number = 0;
  private viewModeController: ViewModeController;
  private annotationCallbacks: Set<(pageNumber: number, annotations: any[]) => void> = new Set();

  constructor(container: HTMLElement, viewModeController: ViewModeController) {
    this.container = container;
    this.viewModeController = viewModeController;
    this.setupContainer();
  }

  private setupContainer(): void {
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';
    this.container.innerHTML = '';
  }

  public async initialize(pdfDoc: PDFDocumentProxy): Promise<void> {
    this.pdfDoc = pdfDoc;
    this.currentPageNumber = 1;
    await this.renderPagesForCurrentView();
  }

  private async renderPagesForCurrentView(): Promise<void> {
    if (!this.pdfDoc) return;

    const mode = this.viewModeController.getMode();
    const currentPage = this.currentPageNumber;
    const totalPages = this.pdfDoc.numPages;

    if (mode === 'scroll') {
      await this.renderAllPages();
    } else {
      const pagesToRender = this.viewModeController.getPagesToRender(currentPage, totalPages);
      await this.renderVisiblePages(pagesToRender);
    }
  }

  private async renderAllPages(): Promise<void> {
    if (!this.pdfDoc) return;

    // Rebuilding must be idempotent: clear any pages left over from a prior
    // view (e.g. the single page-2 node when switching single->scroll) so we
    // render exactly one ordered sequence 1..N. Mirrors renderVisiblePages.
    this.container.innerHTML = '';
    this.pageViews.clear();

    const fragment = document.createDocumentFragment();

    for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
      const pageView = await this.createPageView(pageNum);
      this.pageViews.set(pageNum, pageView);
      fragment.appendChild(pageView.container);
    }

    this.container.appendChild(fragment);
  }

  private async renderVisiblePages(pageNumbers: number[]): Promise<void> {
    if (!this.pdfDoc) return;

    this.container.innerHTML = '';
    this.pageViews.clear();

    const fragment = document.createDocumentFragment();

    for (const pageNum of pageNumbers) {
      const pageView = await this.createPageView(pageNum);
      this.pageViews.set(pageNum, pageView);
      fragment.appendChild(pageView.container);
    }

    this.container.appendChild(fragment);
  }

  public async createPageView(pageNumber: number): Promise<PageView> {
    if (!this.pdfDoc) {
      throw new Error('PDF document not initialized');
    }

    const pageProxy = await this.pdfDoc.getPage(pageNumber);
    const viewport = pageProxy.getViewport({ scale: 1, rotation: this.rotation });

    const scale = this.scale;
    const scaledViewport = viewport.clone({ scale, rotation: this.rotation });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-view';
    wrapper.style.position = 'relative';
    wrapper.style.margin = '20px auto';
    wrapper.style.width = `${scaledViewport.width}px`;
    wrapper.style.height = `${scaledViewport.height}px`;
    wrapper.dataset.pageNumber = String(pageNumber);

    const viewerCanvas = document.createElement('canvas');
    viewerCanvas.style.position = 'absolute';
    viewerCanvas.style.top = '0';
    viewerCanvas.style.left = '0';
    viewerCanvas.style.zIndex = '1';

    // Annotation canvas sits above the base PDF canvas but BELOW the text layer,
    // so that blank areas (where the text layer has pointer-events:none) route
    // pointer events to this canvas for ink/highlight/freetext drawing, while
    // text glyph spans (pointer-events:auto, z-index above) remain selectable.
    const annotationCanvas = document.createElement('canvas');
    annotationCanvas.style.position = 'absolute';
    annotationCanvas.style.top = '0';
    annotationCanvas.style.left = '0';
    annotationCanvas.style.zIndex = '5';
    annotationCanvas.style.cursor = 'crosshair';

    // Text layer: production selection styling. The layer itself does not
    // receive pointer events (blank space falls through to the annotation
    // canvas); individual glyph spans opt back in via CSS (.text-layer span
    // { pointer-events: auto }) so text remains selectable. Glyphs are
    // transparent; only the ::selection highlight is visible.
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    textLayer.style.position = 'absolute';
    textLayer.style.top = '0';
    textLayer.style.left = '0';
    textLayer.style.zIndex = '10';
    textLayer.style.opacity = '1';
    textLayer.style.lineHeight = '1';
    textLayer.style.pointerEvents = 'none';
    textLayer.style.width = `${scaledViewport.width}px`;
    textLayer.style.height = `${scaledViewport.height}px`;
    // pdf.js TextLayer renders each glyph span with
    // `font-size: calc(var(--total-scale-factor) * var(--font-height))` and
    // `transform: scaleX(var(--scale-x))`, where --font-height/--scale-x are set
    // inline per span at the PDF's *unscaled* (scale=1) units. The zoom is
    // applied entirely through the --total-scale-factor CSS variable, which the
    // host layer must provide. Without it the glyphs fall back to the browser
    // default font-size (16px) and mismatch the canvas text — causing the HTML
    // selection to drift from the underlying glyphs. This is the viewport zoom
    // only (dpr is a canvas backing-store concern, not a CSS layout one).
    textLayer.style.setProperty('--total-scale-factor', String(scaledViewport.scale));

    const dpr = window.devicePixelRatio || 1;
    annotationCanvas.width = scaledViewport.width * dpr;
    annotationCanvas.height = scaledViewport.height * dpr;
    annotationCanvas.style.width = `${scaledViewport.width}px`;
    annotationCanvas.style.height = `${scaledViewport.height}px`;

    wrapper.appendChild(viewerCanvas);
    wrapper.appendChild(annotationCanvas);
    wrapper.appendChild(textLayer);

    const pageView: PageView = {
      pageNumber,
      pageProxy,
      viewport: scaledViewport,
      container: wrapper,
      viewerCanvas,
      annotationCanvas,
      textLayer,
      scale,
      rotation: this.rotation,
    };

    await this.renderPageContent(pageView);

    return pageView;
  }

  private async renderPageContent(pageView: PageView): Promise<void> {
    const { pageProxy, viewerCanvas, textLayer, viewport } = pageView;
    const scale = window.devicePixelRatio || 1;

    viewerCanvas.width = viewport.width * scale;
    viewerCanvas.height = viewport.height * scale;
    viewerCanvas.style.width = `${viewport.width}px`;
    viewerCanvas.style.height = `${viewport.height}px`;

    const ctx = viewerCanvas.getContext('2d');
    if (ctx) {
      ctx.scale(scale, scale);

      const renderContext = {
        canvas: viewerCanvas,
        canvasContext: ctx,
        viewport: viewport,
      };

      try {
        await pageProxy.render(renderContext).promise;

        // Render Text Layer
        const textContent = await pageProxy.getTextContent();
        const textLayerInstance = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: viewport
        });
        await textLayerInstance.render();

      } catch (e) {
        console.error(`Error rendering page ${pageView.pageNumber}:`, e);
      }
    }
  }

  public getPageCount(): number {
    return this.pdfDoc?.numPages ?? 0;
  }

  /**
   * Expose the underlying PDFDocumentProxy so higher-level services (search,
   * outline) can extract per-page text content and resolve destinations.
   * Returns null until a document has been initialized.
   */
  public getPdfDoc(): PDFDocumentProxy | null {
    return this.pdfDoc;
  }

  public getCurrentPage(): number {
    return this.currentPageNumber;
  }

  public setCurrentPage(pageNumber: number): void {
    if (pageNumber >= 1 && pageNumber <= this.getPageCount()) {
      const previousPage = this.currentPageNumber;
      this.currentPageNumber = pageNumber;

      if (!this.viewModeController.isScrollMode() && previousPage !== pageNumber) {
        this.renderVisiblePages(
          this.viewModeController.getPagesToRender(pageNumber, this.getPageCount())
        );
      }
    }
  }

  public getPageView(pageNumber: number): PageView | undefined {
    return this.pageViews.get(pageNumber);
  }

  public getAllPageViews(): PageView[] {
    return Array.from(this.pageViews.values());
  }

  public getCurrentPageView(): PageView | undefined {
    return this.pageViews.get(this.currentPageNumber);
  }

  public updateScale(newScale: number): void {
    this.scale = newScale;
    this.rebuildAllPages();
  }

  public updateRotation(newRotation: number): void {
    this.rotation = newRotation % 360;
    if (this.rotation < 0) this.rotation += 360;
    this.rebuildAllPages();
  }

  public setViewMode(mode: ViewMode): Promise<void> {
    this.viewModeController.setMode(mode);
    return this.renderPagesForCurrentView();
  }

  public getViewMode(): ViewMode {
    return this.viewModeController.getMode();
  }

  public getViewModeController(): ViewModeController {
    return this.viewModeController;
  }

  private async rebuildAllPages(): Promise<void> {
    if (!this.pdfDoc) return;

    let currentPageOffset = 0;

    const currentPageView = this.pageViews.get(this.currentPageNumber);
    if (currentPageView) {
      currentPageOffset = currentPageView.container.offsetTop;
    }

    await this.renderPagesForCurrentView();

    if (this.viewModeController.isScrollMode()) {
      this.container.scrollTop = currentPageOffset;
    }
  }

  public scrollToPage(pageNumber: number): void {
    const pageView = this.pageViews.get(pageNumber);
    if (pageView) {
      const containerRect = this.container.getBoundingClientRect();
      const pageRect = pageView.container.getBoundingClientRect();
      const offsetTop = pageRect.top - containerRect.top + this.container.scrollTop;
      this.container.scrollTop = offsetTop;
      this.setCurrentPage(pageNumber);
    }
  }

  public getViewport(pageNumber: number): PageViewport | undefined {
    return this.pageViews.get(pageNumber)?.viewport;
  }

  public renderAnnotations(pageNumber: number, annotations: any[]): void {
    const pageView = this.pageViews.get(pageNumber);
    if (!pageView) return;

    const ctx = pageView.annotationCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, pageView.annotationCanvas.width, pageView.annotationCanvas.height);

    for (const ann of annotations) {
      if (ann.page === pageNumber) {
        this.renderAnnotation(ctx, ann, pageView);
      }
    }
  }

  private renderAnnotation(ctx: CanvasRenderingContext2D, annotation: any, pageView: PageView): void {
    if (annotation.type === 'ink' && annotation.data?.paths) {
      ctx.save();
      ctx.strokeStyle = annotation.color || '#2563eb';
      ctx.lineWidth = annotation.data.strokeWidth || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const scaleX = pageView.annotationCanvas.width;
      const scaleY = pageView.annotationCanvas.height;

      for (const path of annotation.data.paths) {
        if (path.points && path.points.length >= 4) {
          ctx.beginPath();
          const pts = path.points;
          ctx.moveTo(pts[0] * scaleX, pts[1] * scaleY);

          for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i] * scaleX, pts[i + 1] * scaleY);
          }

          ctx.stroke();
        }
      }

      ctx.restore();
    } else if (annotation.type === 'highlight' && annotation.data) {
      ctx.save();
      ctx.fillStyle = annotation.color || '#ffeb3b';
      ctx.globalAlpha = 0.4;

      const x = annotation.position?.x || 0;
      const y = annotation.position?.y || 0;
      const w = annotation.data.width || 100;
      const h = annotation.data.height || 20;

      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  }

  public onAnnotationRender(callback: (pageNumber: number, annotations: any[]) => void): void {
    this.annotationCallbacks.add(callback);
  }

  public destroy(): void {
    this.pageViews.clear();
    this.annotationCallbacks.clear();
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
