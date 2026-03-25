import * as pdfjsLib from 'pdfjs-dist';
import { InkPlugin } from './plugins/InkPlugin';
import { HighlightPlugin } from './plugins/HighlightPlugin';
import { AnnotationObject } from './plugins/IToolPlugin';
import { InkObject } from './models/InkObject';
import { HighlightObject } from './models/HighlightObject';
import { ToolManager } from './tools';
import { Annotation, ToolType } from './types';
import { sync } from './sync';
import {
  PageController,
  ZoomController,
  RotateController,
  NavigationController,
  ViewModeController,
} from './controllers';

export interface PdfPilotOptions {
  workerSrc?: string;
  onAnnotationCreated?: (annotation: Annotation) => void;
  onAnnotationsCleared?: () => void;
  onPageChange?: (pageNumber: number) => void;
  onZoomChange?: (scale: number) => void;
}

export class PdfPilot {
  private container: HTMLElement;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

  private pageController: PageController | null = null;
  private zoomController: ZoomController | null = null;
  private rotateController: RotateController | null = null;
  private viewModeController: ViewModeController | null = null;
  private navigationController: NavigationController | null = null;

  private toolManager: ToolManager | null = null;
  private currentToolManager: ToolManager | null = null;

  private annotations: Map<string, Annotation> = new Map();
  private sharedStore: AnnotationObject[] = [];
  private inkPlugin: InkPlugin;
  private highlightPlugin: HighlightPlugin;
  private options: PdfPilotOptions;
  private syncUnsubscribe: (() => void) | null = null;

  private currentPageNumber: number = 1;

  constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
    this.container = container;
    this.options = options;
    this.inkPlugin = new InkPlugin(this.sharedStore);
    this.highlightPlugin = new HighlightPlugin(this.sharedStore);

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      options.workerSrc ||
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@^5.5.207/build/pdf.worker.min.mjs';
  }

  public async loadDocument(url: string): Promise<void> {
    const loadingTask = pdfjsLib.getDocument(url);
    this.pdfDoc = await loadingTask.promise;

    this.setupControllers();
    await this.pageController!.initialize(this.pdfDoc);

    this.setupToolManager();
    this.setupAnnotationPlugins();

    this.navigationController!.onPageChange((pageNum) => {
      this.currentPageNumber = pageNum;
      this.setupAnnotationPluginsForCurrentPage();
      if (this.options.onPageChange) {
        this.options.onPageChange(pageNum);
      }
    });

    this.navigationController!.onZoomChange((scale) => {
      if (this.options.onZoomChange) {
        this.options.onZoomChange(scale);
      }
    });
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

  private setupToolManager(): void {
    const currentPageView = this.pageController?.getCurrentPageView();
    if (!currentPageView) return;

    if (this.toolManager) {
      this.toolManager.destroy();
    }

    this.toolManager = new ToolManager({
      canvas: currentPageView.annotationCanvas,
      getPage: () => this.currentPageNumber,
      onAnnotationPreview: (_svgPath, _color, _thickness) => {
        if (this.toolManager?.getTool() !== 'ink') {
          this.renderAnnotationsForCurrentPage();
        }
      },
      onAnnotationCreate: (annotation) => {
        if (annotation.type !== 'ink') {
          this.addAnnotation(annotation);
          if (this.options.onAnnotationCreated) {
            this.options.onAnnotationCreated(annotation);
          }
        }
      },
    });

    this.currentToolManager = this.toolManager;
  }

  private setupAnnotationPlugins(): void {
    const currentPageView = this.pageController?.getCurrentPageView();
    if (!currentPageView) return;

    const ctx = currentPageView.annotationCanvas.getContext('2d');
    if (!ctx) return;

    this.inkPlugin.setPageNumber(this.currentPageNumber);
    this.inkPlugin.activate(currentPageView.annotationCanvas);
    this.inkPlugin.onRenderNeeded = () => this.renderAnnotationsForCurrentPage();
    this.inkPlugin.onObjectCreated = (obj) => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).push(obj.serialize());
      });
    };

    this.highlightPlugin.setPageNumber(this.currentPageNumber);
    this.highlightPlugin.activate(currentPageView.annotationCanvas, ctx);
    this.highlightPlugin.onRenderNeeded = () => this.renderAnnotationsForCurrentPage();
    this.highlightPlugin.onObjectCreated = (obj) => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).push(obj.serialize());
      });
    };

    this.setupAnnotationEventListeners(currentPageView.annotationCanvas);
    this.setupSyncSubscription();
  }

  private setupAnnotationPluginsForCurrentPage(): void {
    const currentPageView = this.pageController?.getCurrentPageView();
    if (!currentPageView) return;

    this.inkPlugin.setPageNumber(this.currentPageNumber);
    this.inkPlugin.deactivate();
    this.inkPlugin.activate(currentPageView.annotationCanvas);
    this.inkPlugin.onRenderNeeded = () => this.renderAnnotationsForCurrentPage();
    this.inkPlugin.onObjectCreated = (obj) => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).push(obj.serialize());
      });
    };

    this.highlightPlugin.setPageNumber(this.currentPageNumber);
    const ctx = currentPageView.annotationCanvas.getContext('2d');
    if (ctx) {
      this.highlightPlugin.activate(currentPageView.annotationCanvas, ctx);
    }
    this.highlightPlugin.onRenderNeeded = () => this.renderAnnotationsForCurrentPage();
    this.highlightPlugin.onObjectCreated = (obj) => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).push(obj.serialize());
      });
    };

    this.setupAnnotationEventListeners(currentPageView.annotationCanvas);
    this.renderAnnotationsForCurrentPage();
  }

  private setupAnnotationEventListeners(canvas: HTMLCanvasElement): void {
    canvas.onpointerdown = null;
    canvas.onpointermove = null;
    canvas.onpointerup = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (this.currentToolManager?.getTool() === 'ink') {
        this.inkPlugin.onPointerDown(e);
      }
      if (this.currentToolManager?.getTool() === 'highlight') {
        this.highlightPlugin.onPointerDown(e);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.currentToolManager?.getTool() === 'ink') {
        this.inkPlugin.onPointerMove(e);
      }
      if (this.currentToolManager?.getTool() === 'highlight') {
        this.highlightPlugin.onPointerMove(e);
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.currentToolManager?.getTool() === 'ink') {
        this.inkPlugin.onPointerUp(e);
      }
      if (this.currentToolManager?.getTool() === 'highlight') {
        this.highlightPlugin.onPointerUp(e);
      }
    });
  }

  private renderAnnotationsForCurrentPage(): void {
    const currentPageView = this.pageController?.getCurrentPageView();
    if (!currentPageView) return;

    const ctx = currentPageView.annotationCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(
      0,
      0,
      currentPageView.annotationCanvas.width,
      currentPageView.annotationCanvas.height
    );

    if (this.inkPlugin) {
      this.inkPlugin.render(ctx);
    }
    if (this.highlightPlugin) {
      this.highlightPlugin.render(ctx);
    }
  }

  private setupSyncSubscription(): void {
    if (this.syncUnsubscribe) return;

    this.syncUnsubscribe = sync.subscribe(() => {
      const syncedAnnotations = sync.get() as Annotation[];
      this.sharedStore.length = 0;

      for (const ann of syncedAnnotations) {
        if (ann.type === 'ink') {
          const inkObj = new InkObject();
          inkObj.deserialize(ann);
          this.sharedStore.push(inkObj);
        } else if (ann.type === 'highlight') {
          const highlightObj = new HighlightObject();
          highlightObj.deserialize(ann);
          this.sharedStore.push(highlightObj);
        }
      }

      this.renderAnnotationsForCurrentPage();
    });

    const initialAnnotations = sync.get() as Annotation[];
    for (const ann of initialAnnotations) {
      if (ann.type === 'ink') {
        const inkObj = new InkObject();
        inkObj.deserialize(ann);
        this.sharedStore.push(inkObj);
      } else if (ann.type === 'highlight') {
        const highlightObj = new HighlightObject();
        highlightObj.deserialize(ann);
        this.sharedStore.push(highlightObj);
      }
    }
  }

  public setTool(tool: ToolType): void {
    if (this.currentToolManager) {
      this.currentToolManager.setTool(tool);
    }
  }

  public clearAnnotations(): void {
    this.annotations.clear();
    this.renderAnnotationsForCurrentPage();
    if (this.options.onAnnotationsCleared) {
      this.options.onAnnotationsCleared();
    }
  }

  public addAnnotation(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
    this.renderAnnotationsForCurrentPage();
  }

  public removeAnnotation(id: string): void {
    if (this.annotations.has(id)) {
      this.annotations.delete(id);
      this.renderAnnotationsForCurrentPage();
    }
  }

  public getAnnotations(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  public loadAnnotations(annotations: Annotation[]): void {
    this.annotations.clear();
    for (const ann of annotations) {
      this.annotations.set(ann.id, ann);
    }
    this.renderAnnotationsForCurrentPage();
  }

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

  public getViewMode(): 'scroll' | 'single' {
    return this.navigationController?.getViewMode() ?? 'scroll';
  }

  public setViewMode(mode: 'scroll' | 'single'): void {
    this.navigationController?.setViewMode(mode);
  }

  public toggleScrollMode(): void {
    this.navigationController?.toggleScrollMode();
  }

  public toggleSingleMode(): void {
    this.navigationController?.toggleSingleMode();
  }

  public onViewModeChange(callback: (mode: 'scroll' | 'single') => void): () => void {
    return this.navigationController?.onViewModeChange(callback) ?? (() => {});
  }

  public getCurrentPage(): number {
    return this.navigationController?.getCurrentPage() ?? 1;
  }

  public getTotalPages(): number {
    return this.navigationController?.getTotalPages() ?? 0;
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

  public onPageChange(callback: (pageNumber: number) => void): () => void {
    return this.navigationController?.onPageChange(callback) ?? (() => {});
  }

  public onZoomChange(callback: (scale: number) => void): () => void {
    return this.navigationController?.onZoomChange(callback) ?? (() => {});
  }

  public onRotationChange(callback: (rotation: number) => void): () => void {
    return this.navigationController?.onRotationChange(callback) ?? (() => {});
  }

  public getPageController(): PageController | null {
    return this.pageController;
  }

  public getNavigationController(): NavigationController | null {
    return this.navigationController;
  }

  public getAnnotationCanvas(): HTMLCanvasElement | null {
    return this.pageController?.getCurrentPageView()?.annotationCanvas ?? null;
  }

  public destroy(): void {
    if (this.toolManager) {
      this.toolManager.destroy();
    }
    this.navigationController?.destroy();
    this.pageController?.destroy();
    this.inkPlugin.deactivate();
    this.highlightPlugin.deactivate();
    if (this.syncUnsubscribe) {
      this.syncUnsubscribe();
      this.syncUnsubscribe = null;
    }
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
