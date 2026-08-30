import { Outline } from './Outline';

export class InkDrawOutliner {
  private _last = new Float64Array(6);
  private _line: number[] = [];
  private _lines: { line: number[], points: number[] }[] = [];
  private _rotation: number;
  private _points: number[] = [];
  private _lastSVGPath = "";
  private _lastIndex = 0;
  private _parentWidth: number;
  private _parentHeight: number;

  constructor(x: number, y: number, parentWidth: number, parentHeight: number, rotation: number, _thickness: number) {
    this._parentWidth = parentWidth;
    this._parentHeight = parentHeight;
    this._rotation = rotation;

    const [nx, ny] = this._normalizePoint(x, y);
    const line = [NaN, NaN, NaN, NaN, nx, ny];
    this._line = line;
    this._points = [nx, ny];
    this._lines = [{ line, points: this._points }];
    this._last.set(line, 0);
  }

  private _normalizePoint(x: number, y: number) {
    return Outline._normalizePoint(x, y, this._parentWidth, this._parentHeight, this._rotation);
  }

  add(x: number, y: number) {
    const [nx, ny] = this._normalizePoint(x, y);
    const [x1, y1, x2, y2] = this._last.subarray(2, 6);
    
    const diffX = nx - x2;
    const diffY = ny - y2;
    const d = Math.hypot(this._parentWidth * diffX, this._parentHeight * diffY);
    
    if (d <= 2) {
      return null;
    }

    this._points.push(nx, ny);

    if (isNaN(x1)) {
      // We've only one point.
      this._last.set([x2, y2, nx, ny], 2);
      this._line.push(NaN, NaN, NaN, NaN, nx, ny);
      return { path: { d: this.toSVGPath() } };
    }

    if (isNaN(this._last[0])) {
      // We've only two points.
      this._line.splice(6, 6);
    }

    this._last.set([x1, y1, x2, y2, nx, ny], 0);
    this._line.push(...Outline.createBezierPoints(x1, y1, x2, y2, nx, ny));

    return { path: { d: this.toSVGPath() } };
  }

  end(x: number, y: number) {
    const change = this.add(x, y);
    if (change) {
      return change;
    }
    if (this._points.length === 2) {
      return { path: { d: this.toSVGPath() } };
    }
    return null;
  }

  toSVGPath() {
    const firstX = Outline.svgRound(this._line[4]);
    const firstY = Outline.svgRound(this._line[5]);
    
    if (this._points.length === 2) {
      this._lastSVGPath = `${this._lastSVGPath} M ${firstX} ${firstY} Z`;
      return this._lastSVGPath;
    }

    if (this._points.length <= 6) {
      const i = this._lastSVGPath.lastIndexOf("M");
      if (i !== -1) {
        this._lastSVGPath = `${this._lastSVGPath.slice(0, i)} M ${firstX} ${firstY}`;
      } else {
        this._lastSVGPath = `M ${firstX} ${firstY}`;
      }
      this._lastIndex = 6;
    }

    if (this._points.length === 4) {
      const secondX = Outline.svgRound(this._line[10]);
      const secondY = Outline.svgRound(this._line[11]);
      this._lastSVGPath = `${this._lastSVGPath} L ${secondX} ${secondY}`;
      this._lastIndex = 12;
      return this._lastSVGPath;
    }

    const buffer = [];
    if (this._lastIndex === 0) {
      buffer.push(`M ${firstX} ${firstY}`);
      this._lastIndex = 6;
    }

    for (let i = this._lastIndex, ii = this._line.length; i < ii; i += 6) {
      const [c1x, c1y, c2x, c2y, cx, cy] = this._line.slice(i, i + 6).map(Outline.svgRound);
      buffer.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${cx} ${cy}`);
    }
    
    if (buffer.length > 0) {
      this._lastSVGPath += (this._lastSVGPath ? " " : "") + buffer.join(" ");
    }
    this._lastIndex = this._line.length;

    return this._lastSVGPath;
  }

  getLines() {
    return this._lines;
  }
}
