import * as pdfjsLib from 'pdfjs-dist';
import { InkPlugin } from './plugins/InkPlugin';
import { HighlightPlugin } from './plugins/HighlightPlugin';
import { AnnotationObject } from './plugins/IToolPlugin';
import { ToolManager } from './tools';
import { Annotation, ToolType } from './types';

export interface PdfPilotOptions {
  workerSrc?: string;
  onAnnotationCreated?: (annotation: Annotation) => void;
  onAnnotationsCleared?: () => void;
}

export class PdfPilot {
  private container: HTMLElement;
  private viewerCanvas: HTMLCanvasElement;
  private annotationCanvas: HTMLCanvasElement;
  
  private currentPage: pdfjsLib.PDFPageProxy | null = null;
  private currentViewport: pdfjsLib.PageViewport | null = null;
  private toolManager: ToolManager | null = null;
  
  private annotations: Map<string, Annotation> = new Map();
  private sharedStore: AnnotationObject[] = [];
  private inkPlugin: InkPlugin;
  private highlightPlugin: HighlightPlugin;
  private options: PdfPilotOptions;

  constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
    this.container = container;
    this.options = options;
    this.inkPlugin = new InkPlugin(this.sharedStore);
    this.highlightPlugin = new HighlightPlugin(this.sharedStore);
    
    // Setup worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@^5.5.207/build/pdf.worker.min.mjs';

    // Setup DOM
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';

    this.viewerCanvas = document.createElement('canvas');
    this.viewerCanvas.style.position = 'absolute';
    this.viewerCanvas.style.top = '0';
    this.viewerCanvas.style.left = '0';
    this.viewerCanvas.style.zIndex = '1';

    this.annotationCanvas = document.createElement('canvas');
    this.annotationCanvas.style.position = 'absolute';
    this.annotationCanvas.style.top = '0';
    this.annotationCanvas.style.left = '0';
    this.annotationCanvas.style.zIndex = '2';
    this.annotationCanvas.style.cursor = 'crosshair';

    this.container.appendChild(this.viewerCanvas);
    this.container.appendChild(this.annotationCanvas);
  }

  public async loadDocument(url: string, pageNumber: number = 1): Promise<void> {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdfDoc = await loadingTask.promise;
    
    this.currentPage = await pdfDoc.getPage(pageNumber);
    
    const scale = window.devicePixelRatio || 1;
    this.currentViewport = this.currentPage.getViewport({ scale: 1 });

    const width = this.currentViewport.width;
    const height = this.currentViewport.height;

    // Create an inner wrapper for canvases to center them
    let canvasWrapper = this.container.querySelector('.canvas-wrapper') as HTMLElement;
    if (!canvasWrapper) {
      canvasWrapper = document.createElement('div');
      canvasWrapper.className = 'canvas-wrapper';
      canvasWrapper.style.position = 'relative';
      canvasWrapper.style.margin = '20px auto';
      this.container.appendChild(canvasWrapper);
      
      canvasWrapper.appendChild(this.viewerCanvas);
      canvasWrapper.appendChild(this.annotationCanvas);
    }
    
    canvasWrapper.style.width = `${width}px`;
    canvasWrapper.style.height = `${height}px`;

    // Resize viewer canvas
    this.viewerCanvas.width = width * scale;
    this.viewerCanvas.height = height * scale;
    this.viewerCanvas.style.width = `${width}px`;
    this.viewerCanvas.style.height = `${height}px`;

    // Resize annotation canvas
    this.annotationCanvas.width = width * scale;
    this.annotationCanvas.height = height * scale;
    this.annotationCanvas.style.width = `${width}px`;
    this.annotationCanvas.style.height = `${height}px`;

    const ctx = this.viewerCanvas.getContext('2d');
    if (ctx) {
      ctx.scale(scale, scale);
      
      const renderContext = {
        canvasContext: ctx,
        viewport: this.currentViewport,
        canvas: this.viewerCanvas,
      };
      
      // Some versions of PDF.js might require passing canvas or just canvasContext
      try {
        await this.currentPage.render(renderContext).promise;
      } catch (e) {
        console.error('Render error:', e);
      }
    }

    // Setup ToolManager
    this.setupToolManager();

    // Setup InkPlugin
    const ctx2 = this.annotationCanvas.getContext('2d');
    if (ctx2) {
      this.inkPlugin.activate(this.annotationCanvas);
      this.inkPlugin.onRenderNeeded = () => this.renderAnnotations();

      this.highlightPlugin.activate(this.annotationCanvas, ctx2);
      this.highlightPlugin.onRenderNeeded = () => this.renderAnnotations();

      this.annotationCanvas.addEventListener('pointerdown', (e) => {
        if (this.toolManager?.getTool() === 'ink') this.inkPlugin.onPointerDown(e);
        if (this.toolManager?.getTool() === 'highlight') this.highlightPlugin.onPointerDown(e);
      });
      this.annotationCanvas.addEventListener('pointermove', (e) => {
        if (this.toolManager?.getTool() === 'ink') this.inkPlugin.onPointerMove(e);
        if (this.toolManager?.getTool() === 'highlight') this.highlightPlugin.onPointerMove(e);
      });
      this.annotationCanvas.addEventListener('pointerup', (e) => {
        if (this.toolManager?.getTool() === 'ink') {
          this.inkPlugin.onPointerUp(e);
        }
        if (this.toolManager?.getTool() === 'highlight') {
          this.highlightPlugin.onPointerUp(e);
        }
      });
    }

    this.renderAnnotations();
  }

  private setupToolManager() {
    if (this.toolManager) {
      this.toolManager.destroy();
    }

    this.toolManager = new ToolManager({
      canvas: this.annotationCanvas,
      getPage: () => this.currentPage?.pageNumber || 1,
      onAnnotationPreview: (_svgPath, _color, _thickness) => {
        if (this.toolManager?.getTool() !== 'ink') {
          this.renderAnnotations();
        }
      },
      onAnnotationCreate: (annotation) => {
        // Since InkPlugin handles ink objects, only add non-ink annotations here
        if (annotation.type !== 'ink') {
          this.addAnnotation(annotation);
          if (this.options.onAnnotationCreated) {
            this.options.onAnnotationCreated(annotation);
          }
        }
      }
    });
  }

  // --- Public API ---

  public setTool(tool: ToolType): void {
    if (this.toolManager) {
      this.toolManager.setTool(tool);
    }
  }

  public clearAnnotations(): void {
    this.annotations.clear();
    this.renderAnnotations();
    if (this.options.onAnnotationsCleared) {
      this.options.onAnnotationsCleared();
    }
  }

  public addAnnotation(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
    this.renderAnnotations();
  }

  public removeAnnotation(id: string): void {
    if (this.annotations.has(id)) {
      this.annotations.delete(id);
      this.renderAnnotations();
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
    this.renderAnnotations();
  }

  // --- Rendering ---

  private renderAnnotations(): void {
    const ctx = this.annotationCanvas.getContext('2d');
    if (!ctx) return;

    if (this.inkPlugin) {
      this.inkPlugin.render(ctx);
    }
    if (this.highlightPlugin) {
      this.highlightPlugin.render(ctx);
    }
  }

  public destroy(): void {
    if (this.toolManager) {
      this.toolManager.destroy();
    }
    this.container.innerHTML = '';
  }
}
