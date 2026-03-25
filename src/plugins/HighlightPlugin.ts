import { IToolPlugin, AnnotationObject, Rect } from './IToolPlugin';
import { HighlightObject } from '../models/HighlightObject';
import { HighlightOutliner, FreeHighlightOutliner } from '../drawers/HighlightOutliner';

export class HighlightPlugin implements IToolPlugin {
  private _canvas: HTMLCanvasElement | null = null;
  private _store: AnnotationObject[];
  private _isDrawing = false;
  private _currentBoxes: Rect[] = [];
  private _outliner: HighlightOutliner | null = null;
  private _freeOutliner: FreeHighlightOutliner | null = null;
  public color: string = '#fff066';
  public opacity: number = 1;
  public thickness: number = 12;
  public mode: 'free' | 'box' = 'free';
  public onRenderNeeded?: () => void;
  private _currentPageNumber: number = 1;

  constructor(sharedStore: AnnotationObject[]) {
    this._store = sharedStore;
  }

  activate(canvas: HTMLCanvasElement, _context: CanvasRenderingContext2D): void {
    this._canvas = canvas;
  }

  deactivate(): void {
    this._isDrawing = false;
    this._currentBoxes = [];
    this._outliner = null;
    this._freeOutliner = null;
    this._canvas = null;
  }

  setPageNumber(page: number): void {
    this._currentPageNumber = page;
  }

  getPageNumber(): number {
    return this._currentPageNumber;
  }

  setColor(color: string): void {
    this.color = color;
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));
  }

  private _getCanvasPoint(e: PointerEvent): { x: number, y: number } {
    if (!this._canvas) return { x: 0, y: 0 };
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  onPointerDown(evt: PointerEvent): void {
    if (!this._canvas) return;
    this._isDrawing = true;
    const point = this._getCanvasPoint(evt);
    const normalizedX = point.x / this._canvas.width;
    const normalizedY = point.y / this._canvas.height;

    if (this.mode === 'box') {
      this._currentBoxes = [{ x: normalizedX, y: normalizedY, width: 0, height: 0 }];
    } else {
      this._freeOutliner = new FreeHighlightOutliner(
        { x: point.x, y: point.y },
        [0, 0, this._canvas.width, this._canvas.height],
        1,
        this.thickness / 2,
        true,
        0.001
      );
    }
  }

  onPointerMove(evt: PointerEvent): void {
    if (!this._isDrawing || !this._canvas) return;
    const point = this._getCanvasPoint(evt);

    if (this.mode === 'box') {
      if (this._currentBoxes.length === 0) return;
      const normalizedX = point.x / this._canvas.width;
      const normalizedY = point.y / this._canvas.height;

      const startBox = this._currentBoxes[0];
      const width = normalizedX - startBox.x;
      const height = normalizedY - startBox.y;

      if (width >= 0) {
        startBox.width = width;
      } else {
        startBox.x = normalizedX;
        startBox.width = -width;
      }

      if (height >= 0) {
        startBox.height = height;
      } else {
        startBox.y = normalizedY;
        startBox.height = -height;
      }
    } else if (this._freeOutliner) {
      this._freeOutliner.add({ x: point.x, y: point.y });
    }

    if (this.onRenderNeeded) this.onRenderNeeded();
  }

  onPointerUp(evt: PointerEvent): void {
    if (!this._isDrawing || !this._canvas) return;

    if (this.mode === 'box' && this._currentBoxes.length > 0) {
      const point = this._getCanvasPoint(evt);
      const normalizedX = point.x / this._canvas.width;
      const normalizedY = point.y / this._canvas.height;

      const startBox = this._currentBoxes[0];
      const width = normalizedX - startBox.x;
      const height = normalizedY - startBox.y;

      if (width < 0) {
        startBox.x = normalizedX;
        startBox.width = -width;
      } else {
        startBox.width = width;
      }

      if (height < 0) {
        startBox.y = normalizedY;
        startBox.height = -height;
      } else {
        startBox.height = height;
      }

      if (startBox.width > 0.001 && startBox.height > 0.001) {
        this._outliner = new HighlightOutliner(
          this._currentBoxes,
          0.001,
          0.001,
          true
        );
        const highlightOutline = this._outliner.getOutlines();

        const obj = new HighlightObject(
          `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          [{ polygon: highlightOutline.outlines[0] || [] }],
          this.color,
          this.opacity,
          {
            x: highlightOutline.box[0],
            y: highlightOutline.box[1],
            width: highlightOutline.box[2],
            height: highlightOutline.box[3]
          },
          undefined,
          highlightOutline.toSVGPath(),
          false
        );
        obj.pageNumber = this._currentPageNumber;
        obj.setOutline(highlightOutline);
        this._store.push(obj);
      }
    } else if (this.mode === 'free' && this._freeOutliner && !this._freeOutliner.isEmpty()) {
      const outline = this._freeOutliner.getOutlines();
      const obj = new HighlightObject(
        `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        [],
        this.color,
        this.opacity,
        {
          x: outline.box[0],
          y: outline.box[1],
          width: outline.box[2],
          height: outline.box[3]
        },
        undefined,
        outline.toSVGPath(),
        true
      );
      obj.pageNumber = this._currentPageNumber;
      obj.setOutline(outline);
      this._store.push(obj);
    }

    this._isDrawing = false;
    this._currentBoxes = [];
    this._outliner = null;
    this._freeOutliner = null;
    if (this.onRenderNeeded) this.onRenderNeeded();
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this._canvas) return;

    const scale = window.devicePixelRatio || 1;
    const width = this._canvas.width / scale;
    const height = this._canvas.height / scale;

    ctx.save();
    ctx.scale(scale, scale);

    for (const obj of this._store) {
      if (obj instanceof HighlightObject && obj.pageNumber === this._currentPageNumber) {
        obj.render(ctx, width, height);
      }
    }

    if (this._isDrawing) {
      if (this.mode === 'box' && this._currentBoxes.length > 0) {
        ctx.save();
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = this.opacity;
        ctx.lineWidth = 2;

        for (const box of this._currentBoxes) {
          ctx.strokeRect(
            box.x * width,
            box.y * height,
            box.width * width,
            box.height * height
          );
        }
        ctx.restore();
      } else if (this.mode === 'free' && this._freeOutliner && !this._freeOutliner.isEmpty()) {
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.opacity;
        ctx.scale(width, height);
        const path = new Path2D(this._freeOutliner.toSVGPath());
        ctx.fill(path);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  getObjects(): AnnotationObject[] {
    return this._store.filter(obj => obj.pageNumber === this._currentPageNumber);
  }

  getAllObjects(): AnnotationObject[] {
    return this._store;
  }
}
