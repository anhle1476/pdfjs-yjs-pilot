import { AnnotationStore } from '../AnnotationStore';
import { HighlightObject } from '../models/HighlightObject';
import { Rect } from '../models/AnnotationObject';
import { FreeHighlightOutliner } from '../drawers/HighlightOutliner';

export type HighlightMode = 'free' | 'box' | 'text';

export interface HighlightToolOptions {
  color?: string;
  opacity?: number;
  mode?: HighlightMode;
}

export interface HighlightToolState {
  color: string;
  opacity: number;
  mode: HighlightMode;
  drawing: boolean;
  previewPath: string | null;
}

export interface TextRange {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * HighlightTool — pure business API for highlight creation. Owns NO DOM,
 * installs NO event listeners and does NOT manage text-selection detection
 * (that is host-app input responsibility). Text-based highlights are created
 * by the host calling `createFromTextRange` with coordinates it resolved
 * itself.
 *
 * Coordinate contracts mirror the previous HighlightPlugin:
 *  - box mode: caller supplies normalized (0-1) Rects, plus the canvas pixel
 *    dimensions so the outliner can build device-space geometry.
 *  - free mode: caller supplies pixel coordinates within the canvas.
 *  - text mode: caller supplies a normalized text range.
 */
export class HighlightTool {
  private store: AnnotationStore;
  private freeOutliner: FreeHighlightOutliner | null = null;
  private drawing = false;
  private previewPath: string | null = null;
  private pageNumber = 1;
  private thickness = 12;

  public color: string;
  public opacity: number;
  public mode: HighlightMode;

  private stateChangeCallbacks: Set<(state: HighlightToolState) => void> = new Set();

  constructor(store: AnnotationStore, options: HighlightToolOptions = {}) {
    this.store = store;
    this.color = options.color ?? '#fff066';
    this.opacity = options.opacity ?? 0.4;
    this.mode = options.mode ?? 'text';
  }

  /**
   * Create a box-mode highlight from one or more normalized (0-1) rectangles.
   *
   * The stored HighlightObject keeps NO svgPath/paths: HighlightObject.render
   * treats an empty path/svgPath as "fill the normalized bounds directly"
   * (bounds.x * canvasWidth, ...), which matches the normalized preview drawn
   * during the drag. The union of the supplied rects becomes the bounds.
   *
   * The pixel canvas dimensions are accepted for API symmetry with the
   * freeform path but are not needed here because geometry stays normalized.
   *
   * Returns the created HighlightObject, or null when the boxes are empty.
   */
  public createFromBoxes(
    pageNumber: number,
    boxes: Rect[],
    _canvasWidthPx: number,
    _canvasHeightPx: number
  ): HighlightObject | null {
    if (!boxes || boxes.length === 0) return null;

    // Union of all normalized rects.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }

    const bounds: Rect = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    const obj = new HighlightObject(
      `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      [], // no polygon paths — render falls back to normalized fillRect(bounds)
      this.color,
      this.opacity,
      bounds,
      undefined,
      '', // no svgPath — keep the normalized bounds fill path in render()
      false
    );
    obj.pageNumber = pageNumber;
    this.store.add(obj);
    return obj;
  }

  /**
   * Create a text-mode highlight from a normalized text range.
   */
  public createFromTextRange(pageNumber: number, range: TextRange): HighlightObject {
    const obj = new HighlightObject(
      `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      [],
      this.color,
      this.opacity,
      {
        x: range.startX,
        y: range.startY,
        width: range.endX - range.startX,
        height: range.endY - range.startY,
      },
      undefined,
      '',
      false
    );
    obj.pageNumber = pageNumber;
    this.store.add(obj);
    return obj;
  }

  /**
   * Begin a freeform highlight stroke at the given pixel coordinate.
   */
  public beginFreeform(
    pageNumber: number,
    canvasWidthPx: number,
    canvasHeightPx: number,
    x: number,
    y: number
  ): void {
    this.pageNumber = pageNumber;
    this.drawing = true;
    this.previewPath = null;
    this.freeOutliner = new FreeHighlightOutliner(
      { x, y },
      [0, 0, canvasWidthPx, canvasHeightPx],
      1,
      this.thickness / 2,
      true,
      0.001
    );
    this.notify();
  }

  /**
   * Extend the current freeform stroke. Returns the SVG preview path or null.
   */
  public extendFreeform(x: number, y: number): string | null {
    if (!this.drawing || !this.freeOutliner) return null;
    this.freeOutliner.add({ x, y });
    if (!this.freeOutliner.isEmpty()) {
      this.previewPath = this.freeOutliner.toSVGPath();
      this.notify();
      return this.previewPath;
    }
    return null;
  }

  /**
   * Finish the current freeform stroke, creating a HighlightObject and adding
   * it to the store. Returns the created object, or null if the stroke was
   * empty.
   */
  public endFreeform(): HighlightObject | null {
    let created: HighlightObject | null = null;

    if (this.drawing && this.freeOutliner && !this.freeOutliner.isEmpty()) {
      const outline = this.freeOutliner.getOutlines();
      created = new HighlightObject(
        `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        [],
        this.color,
        this.opacity,
        {
          x: outline.box[0],
          y: outline.box[1],
          width: outline.box[2],
          height: outline.box[3],
        },
        undefined,
        outline.toSVGPath(),
        true
      );
      created.pageNumber = this.pageNumber;
      created.setOutline(outline);
      this.store.add(created);
    }

    this.drawing = false;
    this.freeOutliner = null;
    this.previewPath = null;
    this.notify();
    return created;
  }

  public setColor(color: string): void {
    this.color = color;
    this.notify();
  }

  public setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
    this.notify();
  }

  public setMode(mode: HighlightMode): void {
    this.mode = mode;
    this.notify();
  }

  public getState(): HighlightToolState {
    return {
      color: this.color,
      opacity: this.opacity,
      mode: this.mode,
      drawing: this.drawing,
      previewPath: this.previewPath,
    };
  }

  public onStateChange(cb: (state: HighlightToolState) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(state);
      } catch (e) {
        console.error('Error in HighlightTool state change callback:', e);
      }
    }
  }
}
