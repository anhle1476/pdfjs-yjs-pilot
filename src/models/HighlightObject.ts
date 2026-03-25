import { AnnotationObject, Rect } from '../plugins/IToolPlugin';

export interface HighlightPath {
  polygon: number[];
}

export interface HighlightObjectData {
  type: 'highlight';
  id: string;
  paths?: HighlightPath[];
  svgPath?: string;
  color: string;
  opacity: number;
  bounds: Rect;
  quadPoints?: Float32Array;
  freeDraw?: boolean;
}

export class HighlightObject extends AnnotationObject {
  public id: string;
  public paths: HighlightPath[];
  public svgPath?: string;
  public color: string;
  public opacity: number;
  public bounds: Rect;
  public quadPoints?: Float32Array;
  public freeDraw: boolean;
  private _outline: any | null = null;

  constructor(
    id: string = '',
    paths: HighlightPath[] = [],
    color: string = '#fff066',
    opacity: number = 1,
    bounds?: Rect,
    quadPoints?: Float32Array,
    svgPath?: string,
    freeDraw: boolean = false
  ) {
    super();
    this.id = id;
    this.paths = paths;
    this.svgPath = svgPath;
    this.color = color;
    this.opacity = opacity;
    this.bounds = bounds || this._calculateBounds();
    this.quadPoints = quadPoints;
    this.freeDraw = freeDraw;
  }

  private _calculateBounds(): Rect {
    if (this.paths.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { polygon } of this.paths) {
      for (let i = 0; i < polygon.length; i += 2) {
        minX = Math.min(minX, polygon[i]);
        maxX = Math.max(maxX, polygon[i]);
      }
      for (let i = 1; i < polygon.length; i += 2) {
        minY = Math.min(minY, polygon[i]);
        maxY = Math.max(maxY, polygon[i]);
      }
    }
    if (minX === Infinity) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  hitTest(x: number, y: number): boolean {
    const margin = 0.005;
    if (
      x < this.bounds.x - margin ||
      x > this.bounds.x + this.bounds.width + margin ||
      y < this.bounds.y - margin ||
      y > this.bounds.y + this.bounds.height + margin
    ) {
      return false;
    }

    if (this.svgPath) {
      // Use an offscreen canvas context to test path if available
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const path = new Path2D(this.svgPath);
          ctx.translate(this.bounds.x, this.bounds.y);
          ctx.scale(this.bounds.width, this.bounds.height);
          return ctx.isPointInPath(path, x, y);
        }
      } catch (e) {
        // Fallback to bounding box if Path2D is not supported
        return true;
      }
      return true; // Simple fallback
    }

    for (const { polygon } of this.paths) {
      if (this._pointInPolygon(x, y, polygon)) {
        return true;
      }
    }
    return false;
  }

  private _pointInPolygon(x: number, y: number, polygon: number[]): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = polygon[i], yi = polygon[i + 1];
      const xj = polygon[j], yj = polygon[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  getBounds(): Rect {
    return this.bounds;
  }

  move(dx: number, dy: number): void {
    for (const { polygon } of this.paths) {
      for (let i = 0; i < polygon.length; i += 2) {
        polygon[i] += dx;
        polygon[i + 1] += dy;
      }
    }
    this.bounds.x += dx;
    this.bounds.y += dy;
    if (this.quadPoints) {
      for (let i = 0; i < this.quadPoints.length; i += 2) {
        this.quadPoints[i] += dx;
        this.quadPoints[i + 1] += dy;
      }
    }
  }

  resize(anchor: string, dx: number, dy: number): void {
    const oldWidth = this.bounds.width;
    const oldHeight = this.bounds.height;

    if (anchor.includes('e')) this.bounds.width += dx;
    if (anchor.includes('s')) this.bounds.height += dy;
    if (anchor.includes('w')) {
      this.bounds.x += dx;
      this.bounds.width -= dx;
    }
    if (anchor.includes('n')) {
      this.bounds.y += dy;
      this.bounds.height -= dy;
    }

    const scaleX = oldWidth === 0 ? 1 : this.bounds.width / oldWidth;
    const scaleY = oldHeight === 0 ? 1 : this.bounds.height / oldHeight;

    for (const { polygon } of this.paths) {
      for (let i = 0; i < polygon.length; i += 2) {
        const relX = polygon[i] - (anchor.includes('w') ? this.bounds.x - dx : this.bounds.x);
        const relY = polygon[i + 1] - (anchor.includes('n') ? this.bounds.y - dy : this.bounds.y);
        polygon[i] = this.bounds.x + relX * scaleX;
        polygon[i + 1] = this.bounds.y + relY * scaleY;
      }
    }
  }

  serialize(): any {
    return {
      type: 'highlight',
      id: this.id,
      paths: JSON.parse(JSON.stringify(this.paths)),
      svgPath: this.svgPath,
      color: this.color,
      opacity: this.opacity,
      bounds: { ...this.bounds },
      quadPoints: this.quadPoints ? Array.from(this.quadPoints) : undefined,
      freeDraw: this.freeDraw,
      page: this.pageNumber
    };
  }

  deserialize(data: any): void {
    this.id = data.id;
    this.paths = data.paths ? JSON.parse(JSON.stringify(data.paths)) : [];
    this.svgPath = data.svgPath;
    this.color = data.color;
    this.opacity = data.opacity ?? 1;
    this.bounds = { ...data.bounds };
    this.quadPoints = data.quadPoints ? new Float32Array(data.quadPoints) : undefined;
    this.freeDraw = !!data.freeDraw;
    this.pageNumber = data.page ?? 1;
  }

  render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    ctx.save();

    if (this.svgPath) {
      ctx.translate(this.bounds.x * canvasWidth, this.bounds.y * canvasHeight);
      ctx.scale(this.bounds.width * canvasWidth, this.bounds.height * canvasHeight);
      const path = new Path2D(this.svgPath);
      ctx.fillStyle = this.color;
      ctx.globalAlpha = this.opacity;
      ctx.fill(path);
    } else {
      for (const { polygon } of this.paths) {
        if (polygon.length < 4) continue;

        ctx.beginPath();
        let [prevX, prevY] = polygon;
        ctx.moveTo(prevX * canvasWidth, prevY * canvasHeight);

        for (let i = 2; i < polygon.length; i += 2) {
          const x = polygon[i];
          const y = polygon[i + 1];
          if (x === prevX) {
            ctx.lineTo(x * canvasWidth, y * canvasHeight);
          } else if (y === prevY) {
            ctx.lineTo(x * canvasWidth, y * canvasHeight);
          }
          prevX = x;
          prevY = y;
        }
        ctx.closePath();
      }

      ctx.fillStyle = this.color;
      ctx.globalAlpha = this.opacity;
      ctx.fill();
    }

    ctx.restore();
  }

  setOutline(outline: any): void {
    this._outline = outline;
    if (outline && outline.box) {
      this.bounds = {
        x: outline.box[0],
        y: outline.box[1],
        width: outline.box[2],
        height: outline.box[3]
      };
    }
  }

  get outlineData(): { svgPath: string; box: Float32Array; firstPoint: [number, number]; lastPoint: [number, number] } | null {
    if (!this._outline) return null;
    return {
      svgPath: this._outline.toSVGPath(),
      box: this._outline.box,
      firstPoint: this._outline.firstPoint,
      lastPoint: this._outline.lastPoint
    };
  }
}
