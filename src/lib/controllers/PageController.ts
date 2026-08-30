import * as pdfjsLib from 'pdfjs-dist';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';
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
  /**
   * Whether this page's heavy content (canvas raster + text layer) is
   * currently rendered. Placeholders have a correctly-sized wrapper but no
   * raster/text so layout/scroll offsets stay correct without the render cost.
   */
  rendered: boolean;
  /** The in-flight pdf.js RenderTask for this page, if any (for cancellation). */
  renderTask: RenderTask | null;
}

/**
 * pdf.js throws a RenderingCancelledException (name === 'RenderingCancelledException')
 * when RenderTask.cancel() is called. We swallow it cleanly rather than logging.
 */
function isRenderingCancelled(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: string }).name === 'RenderingCancelledException'
  );
}

export class PageController {
  private pdfDoc: PDFDocumentProxy | null = null;
  private container: HTMLElement;
  /**
   * Maps EVERY page number (1..N) to its wrapper. In scroll mode this holds
   * ALL pages as placeholders up front; only pages in/near the viewport carry
   * rendered content (pageView.rendered === true). In single mode it holds
   * just the visible page(s). getAllPageViews()/getPageView() therefore return
   * wrappers regardless of render state — callers that need the DOM (binding,
   * coordinates, view-sync page detection, search highlight) work uniformly,
   * and lazily-rendered content is signalled via the onPageRendered callback.
   */
  private pageViews: Map<number, PageView> = new Map();
  private currentPageNumber: number = 1;
  private scale: number = 1;
  private rotation: number = 0;
  private viewModeController: ViewModeController;
  private annotationCallbacks: Set<(pageNumber: number, annotations: any[]) => void> = new Set();

  // Fired whenever a page's heavy content (canvas + text layer) finishes
  // rendering (lazy scroll render, visible re-raster after zoom, etc.) so the
  // host can (re)bind canvases and (re)apply annotations/search highlights for
  // just that page.
  private pageRenderedCallbacks: Set<(pageNumber: number) => void> = new Set();

  // Per-page text-content cache, keyed by page number. getTextContent() is
  // otherwise fetched on every rebuild (and separately by search); caching it
  // here avoids re-fetching across zoom/rotation/scroll re-renders. Cleared on
  // destroy / new document.
  private textContentCache: Map<number, Promise<any>> = new Map();

  // IntersectionObserver drives lazy render/teardown in scroll mode. Root is
  // the viewer container with a ~1-page buffer so content is ready slightly
  // before it scrolls into view.
  private intersectionObserver: IntersectionObserver | null = null;

  // Lazy-render queue. Pages entering the viewport are rendered one at a time
  // with a yield to the event loop between them, so a burst of buffer pages
  // does not build many text layers back-to-back in one long main-thread task
  // (which would starve user input / focus). A page that scrolls back out
  // before its turn is dequeued.
  private lazyRenderQueue: number[] = [];
  private lazyRenderPumping = false;

  // Debounce/coalesce rapid scale changes (e.g. Ctrl+wheel notches) so N steps
  // cause few re-rasters. rAF-coalesced with a short trailing timer.
  private pendingScale: number | null = null;
  private scaleDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private static readonly SCALE_DEBOUNCE_MS = 90;

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
    this.textContentCache.clear();
    await this.renderPagesForCurrentView();
  }

  private async renderPagesForCurrentView(): Promise<void> {
    if (!this.pdfDoc) return;

    const mode = this.viewModeController.getMode();
    const currentPage = this.currentPageNumber;
    const totalPages = this.pdfDoc.numPages;

    if (mode === 'scroll') {
      await this.buildScrollView();
    } else {
      const pagesToRender = this.viewModeController.getPagesToRender(currentPage, totalPages);
      await this.buildSingleView(pagesToRender);
    }
  }

  /**
   * Scroll mode: build ALL pages as correctly-sized placeholders up front
   * (cheap — no canvas raster, no text layer), then let the
   * IntersectionObserver render content for pages in/near the viewport.
   */
  private async buildScrollView(): Promise<void> {
    if (!this.pdfDoc) return;

    this.teardownAll();
    this.container.innerHTML = '';
    this.pageViews.clear();

    const fragment = document.createDocumentFragment();
    for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
      const pageView = await this.createPlaceholder(pageNum);
      this.pageViews.set(pageNum, pageView);
      fragment.appendChild(pageView.container);
    }
    this.container.appendChild(fragment);

    // Eagerly render the initial viewport batch (roughly what fits in the
    // container plus one page of buffer) and AWAIT it, so the first pages are
    // ready by the time loadDocument resolves — matching the old eager
    // behaviour for the initial view and avoiding a late render that could
    // fire onPageRendered while the user is already interacting. The
    // IntersectionObserver then owns render/teardown for everything else.
    const initialCount = this.estimateInitialVisibleCount();
    const initial: PageView[] = [];
    for (let n = 1; n <= Math.min(initialCount, this.pdfDoc.numPages); n++) {
      const pv = this.pageViews.get(n);
      if (pv) initial.push(pv);
    }
    await Promise.all(initial.map((pv) => this.renderPageContent(pv)));

    this.setupIntersectionObserver();
    for (const pv of this.pageViews.values()) {
      this.intersectionObserver?.observe(pv.container);
    }
  }

  /**
   * Estimate how many leading pages fit in the current viewport (plus one page
   * of buffer). Falls back to 2 when sizes are unknown (e.g. jsdom).
   */
  private estimateInitialVisibleCount(): number {
    const first = this.pageViews.get(1);
    const pageHeight = first?.container.offsetHeight || 0;
    const viewportHeight = this.container.clientHeight || 0;
    if (pageHeight <= 0 || viewportHeight <= 0) return 2;
    return Math.max(1, Math.ceil(viewportHeight / pageHeight) + 1);
  }

  /**
   * Single (and any non-scroll) mode: render just the requested page(s)
   * eagerly. Reuses the same content render/teardown path as scroll mode.
   */
  private async buildSingleView(pageNumbers: number[]): Promise<void> {
    if (!this.pdfDoc) return;

    this.teardownAll();
    this.disconnectObserver();
    this.container.innerHTML = '';
    this.pageViews.clear();

    const fragment = document.createDocumentFragment();
    const toRender: PageView[] = [];
    for (const pageNum of pageNumbers) {
      const pageView = await this.createPlaceholder(pageNum);
      this.pageViews.set(pageNum, pageView);
      fragment.appendChild(pageView.container);
      toRender.push(pageView);
    }
    this.container.appendChild(fragment);

    // Fire-and-forget the content render (like scroll mode's lazy path): the
    // wrappers/placeholders already exist synchronously so getAllPageViews and
    // layout are correct immediately; onPageRendered fires per page as each
    // raster + text layer completes.
    for (const pv of toRender) {
      void this.renderPageContent(pv);
    }
  }

  private setupIntersectionObserver(): void {
    this.disconnectObserver();
    if (typeof IntersectionObserver === 'undefined') return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const wrapper = entry.target as HTMLElement;
          const pageNum = Number(wrapper.dataset.pageNumber);
          const pv = this.pageViews.get(pageNum);
          if (!pv) continue;
          if (entry.isIntersecting) {
            if (!pv.rendered) this.enqueueLazyRender(pv);
          } else {
            this.dequeueLazyRender(pageNum);
            if (pv.rendered) this.teardownPageContent(pv);
          }
        }
      },
      {
        root: this.container,
        // ~1 page above and below so content is ready before it scrolls in.
        rootMargin: '100% 0px 100% 0px',
        threshold: 0,
      }
    );
  }

  private disconnectObserver(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.lazyRenderQueue = [];
    this.lazyRenderPumping = false;
  }

  private enqueueLazyRender(pv: PageView): void {
    if (pv.rendered) return;
    if (!this.lazyRenderQueue.includes(pv.pageNumber)) {
      this.lazyRenderQueue.push(pv.pageNumber);
    }
    this.pumpLazyRenderQueue();
  }

  private dequeueLazyRender(pageNumber: number): void {
    this.lazyRenderQueue = this.lazyRenderQueue.filter((n) => n !== pageNumber);
  }

  /**
   * Render queued pages one at a time, yielding to the event loop between each
   * so input/focus is not starved by a burst of text-layer builds.
   */
  private pumpLazyRenderQueue(): void {
    if (this.lazyRenderPumping) return;
    this.lazyRenderPumping = true;
    const step = async () => {
      const pageNum = this.lazyRenderQueue.shift();
      if (pageNum === undefined) {
        this.lazyRenderPumping = false;
        return;
      }
      const pv = this.pageViews.get(pageNum);
      if (pv && !pv.rendered) {
        await this.renderPageContent(pv);
      }
      // Yield before the next page so we never build multiple text layers in
      // one uninterrupted task.
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  /**
   * Create a correctly-sized placeholder wrapper (with empty child canvases +
   * text layer nodes) but WITHOUT rasterizing the PDF or building the text
   * layer. The intrinsic size keeps scrollbar/layout/offsets correct.
   */
  public async createPlaceholder(pageNumber: number): Promise<PageView> {
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

    const annotationCanvas = document.createElement('canvas');
    annotationCanvas.style.position = 'absolute';
    annotationCanvas.style.top = '0';
    annotationCanvas.style.left = '0';
    annotationCanvas.style.zIndex = '5';
    annotationCanvas.style.cursor = 'crosshair';

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
    // The zoom is applied entirely through the --total-scale-factor CSS
    // variable that pdf.js glyph spans reference; keep it set on the wrapper's
    // text layer so it is correct as soon as glyph spans render.
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
      rendered: false,
      renderTask: null,
    };

    return pageView;
  }

  /**
   * Fetch (and cache) a page's text content. Reused across re-renders and can
   * be shared with higher-level services that want the same items.
   */
  public getPageTextContent(pageNumber: number): Promise<any> {
    const cached = this.textContentCache.get(pageNumber);
    if (cached) return cached;
    const promise = (async () => {
      const proxy = this.pageViews.get(pageNumber)?.pageProxy
        ?? (this.pdfDoc ? await this.pdfDoc.getPage(pageNumber) : null);
      if (!proxy) return { items: [], styles: {} };
      return proxy.getTextContent();
    })();
    this.textContentCache.set(pageNumber, promise);
    return promise;
  }

  /**
   * Render the heavy content (canvas raster + text layer) for a page whose
   * wrapper already exists. Cancels any in-flight render for the page first,
   * so overlapping renders (rapid zoom / scroll) don't pile up. Fires the
   * onPageRendered callback on success so the host can (re)apply annotations
   * and search highlights for this page.
   */
  private async renderPageContent(pageView: PageView): Promise<void> {
    const { pageProxy, viewerCanvas, textLayer, viewport } = pageView;

    // Cancel any in-flight render for this page before starting a new one.
    if (pageView.renderTask) {
      try {
        pageView.renderTask.cancel();
      } catch {
        /* ignore */
      }
      pageView.renderTask = null;
    }

    const dpr = window.devicePixelRatio || 1;
    viewerCanvas.width = viewport.width * dpr;
    viewerCanvas.height = viewport.height * dpr;
    viewerCanvas.style.width = `${viewport.width}px`;
    viewerCanvas.style.height = `${viewport.height}px`;

    const ctx = viewerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const renderContext = {
      canvas: viewerCanvas,
      canvasContext: ctx,
      viewport,
    };

    try {
      const task = pageProxy.render(renderContext);
      pageView.renderTask = task;
      await task.promise;
      pageView.renderTask = null;

      // Build the text layer from the cached text content.
      textLayer.replaceChildren();
      const textContent = await this.getPageTextContent(pageView.pageNumber);
      const textLayerInstance = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
      });
      await textLayerInstance.render();

      pageView.rendered = true;
      this.notifyPageRendered(pageView.pageNumber);
    } catch (e) {
      pageView.renderTask = null;
      if (isRenderingCancelled(e)) return; // expected on cancel — swallow
      console.error(`Error rendering page ${pageView.pageNumber}:`, e);
    }
  }

  /**
   * Tear down a page's heavy content (cancel any in-flight render, clear the
   * raster canvas, empty the text layer) while KEEPING the placeholder wrapper
   * and its intrinsic size so layout/scroll offsets stay correct.
   */
  private teardownPageContent(pageView: PageView): void {
    if (pageView.renderTask) {
      try {
        pageView.renderTask.cancel();
      } catch {
        /* ignore */
      }
      pageView.renderTask = null;
    }
    // Release the raster backing store but keep the sized wrapper.
    pageView.viewerCanvas.width = 0;
    pageView.viewerCanvas.height = 0;
    pageView.textLayer.replaceChildren();
    // Also clear any annotation drawing (host will repaint when re-rendered).
    const actx = pageView.annotationCanvas.getContext('2d');
    if (actx) actx.clearRect(0, 0, pageView.annotationCanvas.width, pageView.annotationCanvas.height);
    pageView.rendered = false;
  }

  private teardownAll(): void {
    for (const pv of this.pageViews.values()) {
      if (pv.renderTask) {
        try {
          pv.renderTask.cancel();
        } catch {
          /* ignore */
        }
        pv.renderTask = null;
      }
    }
  }

  public getPageCount(): number {
    return this.pdfDoc?.numPages ?? 0;
  }

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
        void this.buildSingleView(
          this.viewModeController.getPagesToRender(pageNumber, this.getPageCount())
        );
      }
    }
  }

  public getPageView(pageNumber: number): PageView | undefined {
    return this.pageViews.get(pageNumber);
  }

  /**
   * Returns ALL page wrappers currently in the DOM. In scroll mode this
   * includes placeholders (rendered === false); callers that need rendered
   * content (search highlight, annotations) either check pageView.rendered or
   * react to the onPageRendered callback. This keeps binding/coordinate/
   * view-sync logic uniform across placeholders and rendered pages.
   */
  public getAllPageViews(): PageView[] {
    return Array.from(this.pageViews.values());
  }

  public getCurrentPageView(): PageView | undefined {
    return this.pageViews.get(this.currentPageNumber);
  }

  public updateScale(newScale: number): void {
    // Debounce/coalesce: N rapid steps (Ctrl+wheel notches) collapse into a
    // few re-rasters. The final scale wins.
    this.pendingScale = newScale;
    if (this.scaleDebounceHandle !== null) {
      clearTimeout(this.scaleDebounceHandle);
    }
    this.scaleDebounceHandle = setTimeout(() => {
      this.scaleDebounceHandle = null;
      const target = this.pendingScale;
      this.pendingScale = null;
      if (target === null) return;
      this.applyScaleInPlace(target);
    }, PageController.SCALE_DEBOUNCE_MS);
  }

  /**
   * In-place scale update: resize each existing wrapper + text layer and
   * re-raster ONLY the currently-rendered pages. Placeholders keep their
   * (resized) intrinsic size; the IntersectionObserver renders them on demand.
   * No full teardown / innerHTML wipe. Scroll anchor is preserved.
   */
  private applyScaleInPlace(newScale: number): void {
    this.scale = newScale;
    if (!this.pdfDoc) return;

    // Anchor: keep the current page's top in view proportionally.
    const anchor = this.captureScrollAnchor();

    for (const pv of this.pageViews.values()) {
      this.resizePageView(pv);
      // Re-raster pages that are rendered OR currently rendering. The latter
      // cancels the in-flight (now stale-scale) task before starting a fresh
      // one, so rapid zoom does not pile up overlapping renders.
      if (pv.rendered || pv.renderTask) {
        void this.renderPageContent(pv);
      }
    }

    this.restoreScrollAnchor(anchor);
  }

  /** Resize a page view's wrapper + child layers to the current scale/rotation. */
  private resizePageView(pv: PageView): void {
    const base = pv.pageProxy.getViewport({ scale: 1, rotation: this.rotation });
    const scaled = base.clone({ scale: this.scale, rotation: this.rotation });
    pv.viewport = scaled;
    pv.scale = this.scale;
    pv.rotation = this.rotation;

    pv.container.style.width = `${scaled.width}px`;
    pv.container.style.height = `${scaled.height}px`;

    pv.textLayer.style.width = `${scaled.width}px`;
    pv.textLayer.style.height = `${scaled.height}px`;
    pv.textLayer.style.setProperty('--total-scale-factor', String(scaled.scale));

    const dpr = window.devicePixelRatio || 1;
    pv.annotationCanvas.width = scaled.width * dpr;
    pv.annotationCanvas.height = scaled.height * dpr;
    pv.annotationCanvas.style.width = `${scaled.width}px`;
    pv.annotationCanvas.style.height = `${scaled.height}px`;
  }

  private captureScrollAnchor(): { pageNumber: number; ratio: number } | null {
    if (!this.viewModeController.isScrollMode()) return null;
    const pv = this.pageViews.get(this.currentPageNumber);
    if (!pv) return null;
    const top = pv.container.offsetTop;
    const height = pv.container.offsetHeight || 1;
    const ratio = (this.container.scrollTop - top) / height;
    return { pageNumber: this.currentPageNumber, ratio };
  }

  private restoreScrollAnchor(anchor: { pageNumber: number; ratio: number } | null): void {
    if (!anchor || !this.viewModeController.isScrollMode()) return;
    const pv = this.pageViews.get(anchor.pageNumber);
    if (!pv) return;
    const top = pv.container.offsetTop;
    const height = pv.container.offsetHeight || 1;
    this.container.scrollTop = top + anchor.ratio * height;
  }

  public updateRotation(newRotation: number): void {
    this.rotation = newRotation % 360;
    if (this.rotation < 0) this.rotation += 360;
    if (!this.pdfDoc) return;

    // Rotation is also in-place: resize wrappers + re-raster rendered pages.
    const anchor = this.captureScrollAnchor();
    for (const pv of this.pageViews.values()) {
      this.resizePageView(pv);
      if (pv.rendered || pv.renderTask) {
        void this.renderPageContent(pv);
      }
    }
    this.restoreScrollAnchor(anchor);
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

  /**
   * Subscribe to per-page render completion. Fires whenever a page's heavy
   * content (canvas + text layer) has just been (re)built — on lazy scroll
   * render and on in-place zoom/rotation re-raster of visible pages — so the
   * host can (re)bind that page's canvas and (re)apply annotations / search
   * highlights. Returns an unsubscribe function.
   */
  public onPageRendered(callback: (pageNumber: number) => void): () => void {
    this.pageRenderedCallbacks.add(callback);
    return () => this.pageRenderedCallbacks.delete(callback);
  }

  private notifyPageRendered(pageNumber: number): void {
    for (const cb of this.pageRenderedCallbacks) {
      try {
        cb(pageNumber);
      } catch (e) {
        console.error('Error in page rendered callback:', e);
      }
    }
  }

  public destroy(): void {
    if (this.scaleDebounceHandle !== null) {
      clearTimeout(this.scaleDebounceHandle);
      this.scaleDebounceHandle = null;
    }
    this.teardownAll();
    this.disconnectObserver();
    this.pageViews.clear();
    this.annotationCallbacks.clear();
    this.pageRenderedCallbacks.clear();
    this.textContentCache.clear();
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
