import { AnnotationObject, Rect } from './AnnotationObject';

export interface InkPath {
  line: number[];
  points: number[];
}

export interface InkObjectData {
  type: 'ink';
  id: string;
  paths: InkPath[];
  color: string;
  strokeWidth: number;
  bounds: Rect;
}

export class InkObject extends AnnotationObject {
  public id: string;
  public paths: InkPath[];
  public color: string;
  public strokeWidth: number;
  public bounds: Rect;

  constructor(id: string = '', paths: InkPath[] = [], color: string = '#000000', strokeWidth: number = 1, bounds?: Rect) {
    super();
    this.id = id;
    this.paths = paths;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.bounds = bounds || this.calculateBounds();
  }

  private calculateBounds(): Rect {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { line } of this.paths) {
      for (let i = 4; i < line.length; i += 2) {
        if (!isNaN(line[i]) && !isNaN(line[i+1])) {
          minX = Math.min(minX, line[i]);
          minY = Math.min(minY, line[i+1]);
          maxX = Math.max(maxX, line[i]);
          maxY = Math.max(maxY, line[i+1]);
        }
      }
    }
    if (minX === Infinity) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  hitTest(x: number, y: number): boolean {
    const margin = Math.max(this.strokeWidth / 1000, 0.01);
    if (x < this.bounds.x - margin || x > this.bounds.x + this.bounds.width + margin ||
        y < this.bounds.y - margin || y > this.bounds.y + this.bounds.height + margin) {
      return false;
    }

    for (const { line } of this.paths) {
      for (let i = 4; i < line.length; i += 2) {
        if (!isNaN(line[i])) {
          const px = line[i];
          const py = line[i+1];
          const dist = Math.hypot(x - px, y - py);
          if (dist <= margin * 2) return true;
        }
      }
    }
    return false;
  }

  getBounds(): Rect {
    return this.bounds;
  }

  move(dx: number, dy: number): void {
    for (const { line } of this.paths) {
      for (let i = 4; i < line.length; i += 2) {
        if (!isNaN(line[i])) {
          line[i] += dx;
          line[i+1] += dy;
        }
      }
    }
    this.bounds.x += dx;
    this.bounds.y += dy;
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

    for (const { line } of this.paths) {
      for (let i = 4; i < line.length; i += 2) {
        if (!isNaN(line[i])) {
          const relX = line[i] - (this.bounds.x - (anchor.includes('w') ? dx : 0));
          const relY = line[i+1] - (this.bounds.y - (anchor.includes('n') ? dy : 0));
          line[i] = this.bounds.x + relX * scaleX;
          line[i+1] = this.bounds.y + relY * scaleY;
        }
      }
    }
  }

  serialize(): any {
    return {
      type: 'ink',
      id: this.id,
      paths: JSON.parse(JSON.stringify(this.paths, (_key, value) => {
        if (Number.isNaN(value)) return null;
        return value;
      })),
      color: this.color,
      strokeWidth: this.strokeWidth,
      bounds: { ...this.bounds },
      page: this.pageNumber
    };
  }

  deserialize(data: any): void {
    this.id = data.id;
    const restoreNaN = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(v => v === null ? NaN : restoreNaN(v));
      if (obj && typeof obj === 'object') {
        const newObj: any = {};
        for (const k in obj) newObj[k] = restoreNaN(obj[k]);
        return newObj;
      }
      return obj;
    };
    this.paths = restoreNaN(data.paths);
    this.color = data.color;
    this.strokeWidth = data.strokeWidth;
    this.bounds = { ...data.bounds };
    this.pageNumber = data.page ?? 1;
  }

  render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    ctx.beginPath();

    for (const { line } of this.paths) {
      ctx.moveTo(line[4] * canvasWidth, line[5] * canvasHeight);

      if (line.length === 6) {
        ctx.lineTo(line[4] * canvasWidth + 0.1, line[5] * canvasHeight);
        continue;
      }
      if (line.length === 12 && isNaN(line[6])) {
        ctx.lineTo(line[10] * canvasWidth, line[11] * canvasHeight);
        continue;
      }
      for (let i = 6, ii = line.length; i < ii; i += 6) {
        ctx.bezierCurveTo(
          line[i] * canvasWidth, line[i+1] * canvasHeight,
          line[i+2] * canvasWidth, line[i+3] * canvasHeight,
          line[i+4] * canvasWidth, line[i+5] * canvasHeight
        );
      }
    }

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}
