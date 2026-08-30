import { PageController } from './PageController';
import { ZoomController } from './ZoomController';
import { RotateController } from './RotateController';
import { ViewModeController, ViewMode } from './ViewModeController';

export interface NavigationControllerOptions {
  container: HTMLElement;
  pageController: PageController;
  zoomController: ZoomController;
  rotateController: RotateController;
  viewModeController: ViewModeController;
}

export class NavigationController {
  private container: HTMLElement;
  private pageController: PageController;
  private zoomCtrl: ZoomController;
  private rotateCtrl: RotateController;
  private viewModeCtrl: ViewModeController;

  private pageChangeCallbacks: Set<(pageNumber: number) => void> = new Set();
  private zoomChangeCallbacks: Set<(scale: number) => void> = new Set();
  private rotationChangeCallbacks: Set<(rotation: number) => void> = new Set();
  private viewModeChangeCallbacks: Set<(mode: ViewMode) => void> = new Set();

  constructor(options: NavigationControllerOptions) {
    this.container = options.container;
    this.pageController = options.pageController;
    this.zoomCtrl = options.zoomController;
    this.rotateCtrl = options.rotateController;
    this.viewModeCtrl = options.viewModeController;

    this.setupScrollListener();
    this.setupKeyboardShortcuts();
    this.setupWheelZoom();
  }

  private setupScrollListener(): void {
    let scrollTimeout: number | null = null;

    this.container.addEventListener('scroll', () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = window.setTimeout(() => {
        this.updateCurrentPageFromScroll();
      }, 100);
    });
  }

  private updateCurrentPageFromScroll(): void {
    const containerHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    const scrollMiddle = scrollTop + containerHeight / 2;

    const pageViews = this.pageController.getAllPageViews();
    for (const pageView of pageViews) {
      const pageTop = pageView.container.offsetTop;
      const pageBottom = pageTop + pageView.container.offsetHeight;

      if (scrollMiddle >= pageTop && scrollMiddle < pageBottom) {
        const currentPage = this.pageController.getCurrentPage();
        if (currentPage !== pageView.pageNumber) {
          this.pageController.setCurrentPage(pageView.pageNumber);
          this.notifyPageChange(pageView.pageNumber);
        }
        break;
      }
    }
  }

  /**
   * Ctrl/Cmd + mouse wheel zooms the document (like most PDF viewers) instead
   * of the browser's default page zoom. A plain wheel (no modifier) is left
   * untouched so normal scrolling still works. The listener is non-passive
   * because it must call preventDefault() when the modifier is held.
   */
  private setupWheelZoom(): void {
    this.container.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return; // plain wheel = scroll, leave it
        e.preventDefault();
        if (e.deltaY < 0) {
          this.zoomIn();
        } else if (e.deltaY > 0) {
          this.zoomOut();
        }
      },
      { passive: false }
    );
  }


  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          this.previousPage();
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'PageDown':
          this.nextPage();
          e.preventDefault();
          break;
        case 'Home':
          this.firstPage();
          e.preventDefault();
          break;
        case 'End':
          this.lastPage();
          e.preventDefault();
          break;
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            this.zoomIn();
            e.preventDefault();
          }
          break;
        case '-':
          if (e.ctrlKey || e.metaKey) {
            this.zoomOut();
            e.preventDefault();
          }
          break;
        case '0':
          if (e.ctrlKey || e.metaKey) {
            this.setZoom(1);
            e.preventDefault();
          }
          break;
      }
    });
  }

  public async goToPage(pageNumber: number): Promise<void> {
    const totalPages = this.getTotalPages();
    if (pageNumber < 1 || pageNumber > totalPages) return;

    this.pageController.scrollToPage(pageNumber);
    this.pageController.setCurrentPage(pageNumber);
    this.notifyPageChange(pageNumber);
  }

  public async nextPage(): Promise<void> {
    const current = this.pageController.getCurrentPage();
    const total = this.getTotalPages();
    if (current < total) {
      await this.goToPage(current + 1);
    }
  }

  public async previousPage(): Promise<void> {
    const current = this.pageController.getCurrentPage();
    if (current > 1) {
      await this.goToPage(current - 1);
    }
  }

  public async firstPage(): Promise<void> {
    await this.goToPage(1);
  }

  public async lastPage(): Promise<void> {
    await this.goToPage(this.getTotalPages());
  }

  public goToNextPage(): void {
    this.nextPage();
  }

  public goToPreviousPage(): void {
    this.previousPage();
  }

  public goToFirstPage(): void {
    this.firstPage();
  }

  public goToLastPage(): void {
    this.lastPage();
  }

  public zoomIn(): void {
    const newScale = this.zoomCtrl.zoomIn();
    this.pageController.updateScale(newScale);
    this.notifyZoomChange(newScale);
  }

  public zoomOut(): void {
    const newScale = this.zoomCtrl.zoomOut();
    this.pageController.updateScale(newScale);
    this.notifyZoomChange(newScale);
  }

  public setZoom(scale: number): void {
    const newScale = this.zoomCtrl.setScale(scale);
    this.pageController.updateScale(newScale);
    this.notifyZoomChange(newScale);
  }

  public zoomTo(percent: number): void {
    this.setZoom(percent / 100);
  }

  public fitToWidth(): void {
    const currentPageView = this.pageController.getCurrentPageView();
    if (!currentPageView) return;

    const containerWidth = this.container.clientWidth - 40;
    const pageWidth = currentPageView.viewport.width / currentPageView.scale;

    const newScale = this.zoomCtrl.fitToWidth(containerWidth, pageWidth);
    this.pageController.updateScale(newScale);
    this.notifyZoomChange(newScale);
  }

  public fitToPage(): void {
    const currentPageView = this.pageController.getCurrentPageView();
    if (!currentPageView) return;

    const containerWidth = this.container.clientWidth - 40;
    const containerHeight = this.container.clientHeight - 40;
    const pageWidth = currentPageView.viewport.width / currentPageView.scale;
    const pageHeight = currentPageView.viewport.height / currentPageView.scale;

    const newScale = this.zoomCtrl.fitToPage(containerWidth, containerHeight, pageWidth, pageHeight);
    this.pageController.updateScale(newScale);
    this.notifyZoomChange(newScale);
  }

  public rotateClockwise(): void {
    const newRotation = this.rotateCtrl.rotateClockwise();
    this.pageController.updateRotation(newRotation);
    this.notifyRotationChange(newRotation);
  }

  public rotateCounterClockwise(): void {
    const newRotation = this.rotateCtrl.rotateCounterClockwise();
    this.pageController.updateRotation(newRotation);
    this.notifyRotationChange(newRotation);
  }

  /**
   * Set an absolute rotation (in degrees). Used by remote view-state sync so
   * rotation is applied absolutely rather than by replaying clockwise steps.
   */
  public setRotation(degrees: number): void {
    const newRotation = this.rotateCtrl.setRotation(degrees);
    this.pageController.updateRotation(newRotation);
    this.notifyRotationChange(newRotation);
  }

  public getCurrentPage(): number {
    return this.pageController.getCurrentPage();
  }

  public getTotalPages(): number {
    return this.pageController.getPageCount();
  }

  public getZoom(): number {
    return this.zoomCtrl.getScale();
  }

  public getZoomPercent(): number {
    return this.zoomCtrl.getZoomPercent();
  }

  public getRotation(): number {
    return this.rotateCtrl.getRotation();
  }

  public getViewMode(): ViewMode {
    return this.viewModeCtrl.getMode();
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    this.viewModeCtrl.setMode(mode);
    await this.pageController.setViewMode(mode);
    this.notifyViewModeChange(mode);
  }

  public toggleScrollMode(): void {
    this.setViewMode('scroll');
  }

  public toggleSingleMode(): void {
    this.setViewMode('single');
  }

  public onPageChange(callback: (pageNumber: number) => void): () => void {
    this.pageChangeCallbacks.add(callback);
    return () => this.pageChangeCallbacks.delete(callback);
  }

  public onZoomChange(callback: (scale: number) => void): () => void {
    this.zoomChangeCallbacks.add(callback);
    return () => this.zoomChangeCallbacks.delete(callback);
  }

  public onRotationChange(callback: (rotation: number) => void): () => void {
    this.rotationChangeCallbacks.add(callback);
    return () => this.rotationChangeCallbacks.delete(callback);
  }

  public onViewModeChange(callback: (mode: ViewMode) => void): () => void {
    this.viewModeChangeCallbacks.add(callback);
    return () => this.viewModeChangeCallbacks.delete(callback);
  }

  private notifyPageChange(pageNumber: number): void {
    for (const callback of this.pageChangeCallbacks) {
      try {
        callback(pageNumber);
      } catch (e) {
        console.error('Error in page change callback:', e);
      }
    }
  }

  private notifyZoomChange(scale: number): void {
    for (const callback of this.zoomChangeCallbacks) {
      try {
        callback(scale);
      } catch (e) {
        console.error('Error in zoom change callback:', e);
      }
    }
  }

  private notifyRotationChange(rotation: number): void {
    for (const callback of this.rotationChangeCallbacks) {
      try {
        callback(rotation);
      } catch (e) {
        console.error('Error in rotation change callback:', e);
      }
    }
  }

  private notifyViewModeChange(mode: ViewMode): void {
    for (const callback of this.viewModeChangeCallbacks) {
      try {
        callback(mode);
      } catch (e) {
        console.error('Error in view mode change callback:', e);
      }
    }
  }

  public canZoomIn(): boolean {
    return this.zoomCtrl.canZoomIn();
  }

  public canZoomOut(): boolean {
    return this.zoomCtrl.canZoomOut();
  }

  public canGoNext(): boolean {
    return this.pageController.getCurrentPage() < this.getTotalPages();
  }

  public canGoPrevious(): boolean {
    return this.pageController.getCurrentPage() > 1;
  }

  public destroy(): void {
    this.pageChangeCallbacks.clear();
    this.zoomChangeCallbacks.clear();
    this.rotationChangeCallbacks.clear();
    this.viewModeChangeCallbacks.clear();
  }
}
