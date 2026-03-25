import type { ToolType, Annotation, InkData, Point } from './types';
import { InkDrawOutliner } from './drawers/InkDrawOutliner';

export interface ToolManagerOptions {
  canvas: HTMLCanvasElement;
  onAnnotationCreate: (annotation: Annotation) => void;
  onAnnotationPreview: (svgPath: string, color: string, thickness: number) => void;
  getPage: () => number;
}

export class ToolManager {
  private canvas: HTMLCanvasElement;
  private onAnnotationCreate: (annotation: Annotation) => void;
  private onAnnotationPreview: (svgPath: string, color: string, thickness: number) => void;
  private getPage: () => number;

  private currentTool: ToolType = 'ink';
  private currentColor: string = '#2563eb';
  private strokeWidth: number = 2;

  private isDrawing: boolean = false;
  private outliner: InkDrawOutliner | null = null;

  constructor(options: ToolManagerOptions) {
    this.canvas = options.canvas;
    this.onAnnotationCreate = options.onAnnotationCreate;
    this.onAnnotationPreview = options.onAnnotationPreview;
    this.getPage = options.getPage;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseUp);
  }

  private getCanvasPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.currentTool !== 'ink') return;

    this.isDrawing = true;
    const point = this.getCanvasPoint(e);
    
    // Create new InkDrawOutliner
    this.outliner = new InkDrawOutliner(
      point.x, 
      point.y, 
      this.canvas.width, 
      this.canvas.height, 
      0, // rotation
      this.strokeWidth
    );
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isDrawing || !this.outliner || this.currentTool !== 'ink') return;

    const point = this.getCanvasPoint(e);
    const change = this.outliner.add(point.x, point.y);
    
    if (change && change.path && change.path.d) {
      this.onAnnotationPreview(change.path.d, this.currentColor, this.strokeWidth);
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (!this.isDrawing || !this.outliner || this.currentTool !== 'ink') return;

    const point = this.getCanvasPoint(e);
    const change = this.outliner.end(point.x, point.y);

    if (change && change.path && change.path.d) {
      this.onAnnotationPreview(change.path.d, this.currentColor, this.strokeWidth);
    }

    const lines = this.outliner.getLines();
    if (lines.length > 0) {
      const data: InkData = {
        paths: lines,
        strokeWidth: this.strokeWidth,
      };
      
      const annotation: Annotation = {
        id: this.generateId(),
        type: 'ink',
        page: this.getPage(),
        position: { x: 0, y: 0 },
        data,
        color: this.currentColor,
        createdAt: Date.now(),
      };
      
      this.onAnnotationCreate(annotation);
    }

    this.resetDrawingState();
  };

  private resetDrawingState(): void {
    this.isDrawing = false;
    this.outliner = null;
    this.onAnnotationPreview('', '', 0); // clear preview
  }

  private generateId(): string {
    return `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.resetDrawingState();
  }

  public getTool(): ToolType {
    return this.currentTool;
  }

  public setColor(color: string): void {
    this.currentColor = color;
  }

  public getColor(): string {
    return this.currentColor;
  }

  public destroy(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    this.resetDrawingState();
  }
}
