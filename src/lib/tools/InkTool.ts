import { AnnotationStore } from '../AnnotationStore';
import { InkDrawOutliner } from '../drawers/InkDrawOutliner';
import { InkObject } from '../models/InkObject';

export interface InkToolOptions {
  color?: string;
  strokeWidth?: number;
}

export interface InkToolState {
  drawing: boolean;
  color: string;
  strokeWidth: number;
  previewPath: string | null;
}

/**
 * InkTool — pure business API for freehand ink drawing. It owns NO DOM and
 * installs NO event listeners. The host app is responsible for detecting
 * pointer input and calling begin/extend/end with pixel coordinates measured
 * against the target canvas.
 *
 * Coordinate contract: `x`/`y` are pixel coordinates inside the annotation
 * canvas (same convention InkDrawOutliner expects). `canvasWidthPx` /
 * `canvasHeightPx` are that canvas' backing pixel dimensions (e.g.
 * `annotationCanvas.width` / `.height`).
 */
export class InkTool {
  private store: AnnotationStore;
  private outliner: InkDrawOutliner | null = null;
  private drawing = false;
  private previewPath: string | null = null;
  private pageNumber = 1;

  public color: string;
  public strokeWidth: number;

  private stateChangeCallbacks: Set<(state: InkToolState) => void> = new Set();

  constructor(store: AnnotationStore, options: InkToolOptions = {}) {
    this.store = store;
    this.color = options.color ?? '#2563eb';
    this.strokeWidth = options.strokeWidth ?? 2;
  }

  /**
   * Begin a new stroke at the given pixel coordinate.
   */
  public beginStroke(
    pageNumber: number,
    canvasWidthPx: number,
    canvasHeightPx: number,
    x: number,
    y: number
  ): void {
    this.pageNumber = pageNumber;
    this.drawing = true;
    this.previewPath = null;

    this.outliner = new InkDrawOutliner(
      x,
      y,
      canvasWidthPx,
      canvasHeightPx,
      0,
      this.strokeWidth
    );
    this.notify();
  }

  /**
   * Extend the current stroke. Returns the SVG preview path (normalized to the
   * 0-10000 space used by InkDrawOutliner) or null when no stroke is active or
   * the movement was below the sampling threshold.
   */
  public extendStroke(x: number, y: number): string | null {
    if (!this.drawing || !this.outliner) return null;
    const change = this.outliner.add(x, y);
    if (change && change.path && change.path.d) {
      this.previewPath = change.path.d;
      this.notify();
      return this.previewPath;
    }
    return null;
  }

  /**
   * Finish the current stroke, creating an InkObject and adding it to the
   * store. Returns the created object, or null if the stroke was empty.
   */
  public endStroke(x: number, y: number): InkObject | null {
    if (!this.drawing || !this.outliner) return null;
    this.outliner.end(x, y);

    const lines = this.outliner.getLines();
    let created: InkObject | null = null;

    if (lines.length > 0) {
      created = new InkObject(
        `ink_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        lines,
        this.color,
        this.strokeWidth
      );
      created.pageNumber = this.pageNumber;
      this.store.add(created);
    }

    this.drawing = false;
    this.outliner = null;
    this.previewPath = null;
    this.notify();
    return created;
  }

  /**
   * Abort the current stroke without persisting anything.
   */
  public cancelStroke(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.outliner = null;
    this.previewPath = null;
    this.notify();
  }

  public setColor(color: string): void {
    this.color = color;
    this.notify();
  }

  public setStrokeWidth(width: number): void {
    this.strokeWidth = width;
    this.notify();
  }

  public getState(): InkToolState {
    return {
      drawing: this.drawing,
      color: this.color,
      strokeWidth: this.strokeWidth,
      previewPath: this.previewPath,
    };
  }

  public onStateChange(cb: (state: InkToolState) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(state);
      } catch (e) {
        console.error('Error in InkTool state change callback:', e);
      }
    }
  }
}
