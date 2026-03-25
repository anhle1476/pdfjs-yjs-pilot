import { IToolPlugin, AnnotationObject } from './IToolPlugin';
import { InkDrawOutliner } from '../drawers/InkDrawOutliner';
import { InkObject } from '../models/InkObject';

export class InkPlugin implements IToolPlugin {
  private canvas: HTMLCanvasElement | null = null;
  private store: AnnotationObject[];
  private isDrawing = false;
  private outliner: InkDrawOutliner | null = null;
  public currentColor: string = '#2563eb';
  public strokeWidth: number = 2;
  private previewPath: string | null = null;
  public onRenderNeeded?: () => void;
  private currentPageNumber: number = 1;

  constructor(sharedStore: AnnotationObject[]) {
    this.store = sharedStore;
  }

  activate(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  deactivate(): void {
    this.isDrawing = false;
    this.outliner = null;
    this.canvas = null;
  }

  setPageNumber(page: number): void {
    this.currentPageNumber = page;
  }

  getPageNumber(): number {
    return this.currentPageNumber;
  }

  private getCanvasPoint(e: PointerEvent): { x: number, y: number } {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  onPointerDown(evt: PointerEvent): void {
    if (!this.canvas) return;
    this.isDrawing = true;
    const point = this.getCanvasPoint(evt);

    this.outliner = new InkDrawOutliner(
      point.x,
      point.y,
      this.canvas.width,
      this.canvas.height,
      0,
      this.strokeWidth
    );
  }

  onPointerMove(evt: PointerEvent): void {
    if (!this.isDrawing || !this.outliner || !this.canvas) return;
    const point = this.getCanvasPoint(evt);
    const change = this.outliner.add(point.x, point.y);
    if (change && change.path && change.path.d) {
      this.previewPath = change.path.d;
      if (this.onRenderNeeded) this.onRenderNeeded();
    }
  }

  onPointerUp(evt: PointerEvent): void {
    if (!this.isDrawing || !this.outliner || !this.canvas) return;
    const point = this.getCanvasPoint(evt);
    this.outliner.end(point.x, point.y);

    const lines = this.outliner.getLines();
    if (lines.length > 0) {
      const obj = new InkObject(
        `ink_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        lines,
        this.currentColor,
        this.strokeWidth
      );
      obj.pageNumber = this.currentPageNumber;
      this.store.push(obj);
    }

    this.isDrawing = false;
    this.outliner = null;
    this.previewPath = null;
    if (this.onRenderNeeded) this.onRenderNeeded();
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;

    const scale = window.devicePixelRatio || 1;
    const width = this.canvas.width / scale;
    const height = this.canvas.height / scale;

    ctx.save();
    ctx.scale(scale, scale);

    for (const obj of this.store) {
      if (obj instanceof InkObject && obj.pageNumber === this.currentPageNumber) {
        obj.render(ctx, width, height);
      }
    }

    if (this.previewPath) {
      this.drawSvgPath(ctx, this.previewPath, this.currentColor, this.strokeWidth, width, height);
    }

    ctx.restore();
  }

  private drawSvgPath(ctx: CanvasRenderingContext2D, svgPath: string, color: string, thickness: number, width: number, height: number) {
    ctx.save();
    ctx.scale(width / 10000, height / 10000);

    const p = new Path2D(svgPath);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness / (width / 10000);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(p);

    ctx.restore();
  }

  getObjects(): AnnotationObject[] {
    return this.store.filter(obj => obj.pageNumber === this.currentPageNumber);
  }

  getAllObjects(): AnnotationObject[] {
    return this.store;
  }
}
