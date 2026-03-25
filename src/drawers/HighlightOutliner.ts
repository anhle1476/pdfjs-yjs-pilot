import { Outline } from './Outline';

class Util {
  static pointBoundingBox(x: number, y: number, minMax: number[] | Float32Array) {
    if (x < minMax[0]) minMax[0] = x;
    if (y < minMax[1]) minMax[1] = y;
    if (x > minMax[2]) minMax[2] = x;
    if (y > minMax[3]) minMax[3] = y;
  }

  static rectBoundingBox(x1: number, y1: number, x2: number, y2: number, minMax: number[] | Float32Array) {
    if (x1 < minMax[0]) minMax[0] = x1;
    if (y1 < minMax[1]) minMax[1] = y1;
    if (x2 > minMax[2]) minMax[2] = x2;
    if (y2 > minMax[3]) minMax[3] = y2;
  }

  static bezierBoundingBox(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    minMax: number[] | Float32Array
  ) {
    let minX = Math.min(x0, x3);
    let maxX = Math.max(x0, x3);
    let minY = Math.min(y0, y3);
    let maxY = Math.max(y0, y3);

    const checkPoint = (t: number) => {
      if (t > 0 && t < 1) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        const mt3 = mt2 * mt;
        const t3 = t2 * t;
        
        const x = mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3;
        const y = mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3;
        
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    };

    let a = -3 * x0 + 9 * x1 - 9 * x2 + 3 * x3;
    let b = 6 * x0 - 12 * x1 + 6 * x2;
    let c = -3 * x0 + 3 * x1;
    
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) checkPoint(-c / b);
    } else {
      const delta = b * b - 4 * a * c;
      if (delta >= 0) {
        const sqrtDelta = Math.sqrt(delta);
        checkPoint((-b + sqrtDelta) / (2 * a));
        checkPoint((-b - sqrtDelta) / (2 * a));
      }
    }

    a = -3 * y0 + 9 * y1 - 9 * y2 + 3 * y3;
    b = 6 * y0 - 12 * y1 + 6 * y2;
    c = -3 * y0 + 3 * y1;

    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) checkPoint(-c / b);
    } else {
      const delta = b * b - 4 * a * c;
      if (delta >= 0) {
        const sqrtDelta = Math.sqrt(delta);
        checkPoint((-b + sqrtDelta) / (2 * a));
        checkPoint((-b - sqrtDelta) / (2 * a));
      }
    }

    minMax[0] = minX;
    minMax[1] = minY;
    minMax[2] = maxX;
    minMax[3] = maxY;
  }
}

export class HighlightOutline extends Outline {
  private _box: Float32Array;
  private _outlines: number[][];
  public firstPoint: [number, number];
  public lastPoint: [number, number];

  constructor(outlines: number[][], box: Float32Array, firstPoint: [number, number], lastPoint: [number, number]) {
    super();
    this._outlines = outlines;
    this._box = box;
    this.firstPoint = firstPoint;
    this.lastPoint = lastPoint;
  }

  toSVGPath(): string {
    const buffer: string[] = [];
    for (const polygon of this._outlines) {
      let [prevX, prevY] = polygon;
      buffer.push(`M${prevX} ${prevY}`);
      for (let i = 2; i < polygon.length; i += 2) {
        const x = polygon[i];
        const y = polygon[i + 1];
        if (x === prevX) {
          buffer.push(`V${y}`);
          prevY = y;
        } else if (y === prevY) {
          buffer.push(`H${x}`);
          prevX = x;
        }
      }
      buffer.push("Z");
    }
    return buffer.join(" ");
  }

  serialize([blX, blY, trX, trY]: [number, number, number, number], _rotation: number): number[][] {
    const outlines: number[][] = [];
    const width = trX - blX;
    const height = trY - blY;
    for (const outline of this._outlines) {
      const points = new Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        points[i] = blX + outline[i] * width;
        points[i + 1] = trY - outline[i + 1] * height;
      }
      outlines.push(points);
    }
    return outlines;
  }

  get box(): Float32Array {
    return this._box;
  }

  get outlines(): number[][] {
    return this._outlines;
  }

  getNewOutline(_thickness: number, _innerMargin: number = 0): HighlightOutline {
    return new HighlightOutline(
      this._outlines.map(o => [...o]),
      new Float32Array(this._box),
      [...this.firstPoint],
      [...this.lastPoint]
    );
  }
}

export class HighlightOutliner {
  private _box: Float32Array;
  private _firstPoint: [number, number];
  private _lastPoint: [number, number];
  private _verticalEdges: [number, number, number, boolean][] = [];
  private _intervals: [number, number][] = [];

  constructor(boxes: { x: number; y: number; width: number; height: number }[], borderWidth: number = 0, innerMargin: number = 0, isLTR: boolean = true) {
    const minMax: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];

    const NUMBER_OF_DIGITS = 4;
    const EPSILON = 10 ** -NUMBER_OF_DIGITS;

    for (const { x, y, width, height } of boxes) {
      const x1 = Math.floor((x - borderWidth) / EPSILON) * EPSILON;
      const x2 = Math.ceil((x + width + borderWidth) / EPSILON) * EPSILON;
      const y1 = Math.floor((y - borderWidth) / EPSILON) * EPSILON;
      const y2 = Math.ceil((y + height + borderWidth) / EPSILON) * EPSILON;
      const left: [number, number, number, boolean] = [x1, y1, y2, true];
      const right: [number, number, number, boolean] = [x2, y1, y2, false];
      this._verticalEdges.push(left, right);

      this._updateBoundingBox(x1, y1, x2, y2, minMax);
    }

    const bboxWidth = minMax[2] - minMax[0] + 2 * innerMargin;
    const bboxHeight = minMax[3] - minMax[1] + 2 * innerMargin;
    const shiftedMinX = minMax[0] - innerMargin;
    const shiftedMinY = minMax[1] - innerMargin;
    let firstPointX = isLTR ? -Infinity : Infinity;
    let firstPointY = Infinity;
    const lastEdge = this._verticalEdges.length > 0
      ? this._verticalEdges.at(isLTR ? -1 : -2)!
      : null;
    const lastPoint: [number, number] = lastEdge
      ? [lastEdge[0], lastEdge[2]]
      : [0, 0];

    for (const edge of this._verticalEdges) {
      const [x, y1, y2, left] = edge;
      if (!left && isLTR) {
        if (y1 < firstPointY) {
          firstPointY = y1;
          firstPointX = x;
        } else if (y1 === firstPointY) {
          firstPointX = Math.max(firstPointX, x);
        }
      } else if (left && !isLTR) {
        if (y1 < firstPointY) {
          firstPointY = y1;
          firstPointX = x;
        } else if (y1 === firstPointY) {
          firstPointX = Math.min(firstPointX, x);
        }
      }

      edge[0] = (x - shiftedMinX) / bboxWidth;
      edge[1] = (y1 - shiftedMinY) / bboxHeight;
      edge[2] = (y2 - shiftedMinY) / bboxHeight;
    }

    this._box = new Float32Array([shiftedMinX, shiftedMinY, bboxWidth, bboxHeight]);
    this._firstPoint = [firstPointX, firstPointY];
    this._lastPoint = lastPoint;
  }

  private _updateBoundingBox(x1: number, y1: number, x2: number, y2: number, minMax: number[]): void {
    if (x1 < minMax[0]) minMax[0] = x1;
    if (y1 < minMax[1]) minMax[1] = y1;
    if (x2 > minMax[2]) minMax[2] = x2;
    if (y2 > minMax[3]) minMax[3] = y2;
  }

  getOutlines(): HighlightOutline {
    this._verticalEdges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

    const outlineVerticalEdges: number[][] = [];
    for (const edge of this._verticalEdges) {
      if (edge[3]) {
        outlineVerticalEdges.push(...this._breakEdge(edge));
        this._insert(edge);
      } else {
        this._remove(edge);
        outlineVerticalEdges.push(...this._breakEdge(edge));
      }
    }
    return this._getOutlines(outlineVerticalEdges);
  }

  private _getOutlines(outlineVerticalEdges: number[][]): HighlightOutline {
    const edges: number[][] = [];
    const allEdges = new Set<number[]>();

    for (const edge of outlineVerticalEdges) {
      const [x, y1, y2] = edge;
      edges.push([x, y1, ...edge], [x, y2, ...edge]);
    }

    edges.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (let i = 0, ii = edges.length; i < ii; i += 2) {
      const edge1 = edges[i];
      const edge2 = edges[i + 1];
      edge1.push(...edge2);
      edge2.push(...edge1);
      allEdges.add(edge1);
      allEdges.add(edge2);
    }
    const outlines: number[][] = [];
    let outline: number[];

    while (allEdges.size > 0) {
      const edge = allEdges.values().next().value!;
      let [x, y1, y2, ...rest] = edge;
      const edge1 = rest.slice(0, 3) as number[];
      const edge2 = rest.slice(3, 6) as number[];
      allEdges.delete(edge);
      let lastPointX = x;
      let lastPointY = y1;

      outline = [x, y2];
      outlines.push(outline);

      while (true) {
        let e: number[] | null = null;
        if (allEdges.has(edge1)) {
          e = edge1;
        } else if (allEdges.has(edge2)) {
          e = edge2;
        } else {
          break;
        }

        allEdges.delete(e!);
        [x, y1, y2, ...rest] = e!;
        const newEdge1 = rest.slice(0, 3) as number[];
        const newEdge2 = rest.slice(3, 6) as number[];

        if (lastPointX !== x) {
          outline.push(lastPointX, lastPointY, x, lastPointY === y1 ? y1 : y2);
          lastPointX = x;
        }
        lastPointY = lastPointY === y1 ? y2 : y1;

        edge1.length = 0;
        edge2.length = 0;
        edge1.push(...newEdge1);
        edge2.push(...newEdge2);
      }
      outline.push(lastPointX, lastPointY);
    }
    return new HighlightOutline(
      outlines,
      this._box,
      this._firstPoint,
      this._lastPoint
    );
  }

  private _binarySearch(y: number): number {
    const array = this._intervals;
    let start = 0;
    let end = array.length - 1;

    while (start <= end) {
      const middle = (start + end) >> 1;
      const y1 = array[middle][0];
      if (y1 === y) {
        return middle;
      }
      if (y1 < y) {
        start = middle + 1;
      } else {
        end = middle - 1;
      }
    }
    return end + 1;
  }

  private _insert(edge: [number, number, number, boolean]): void {
    const [, y1, y2] = edge as number[];
    const index = this._binarySearch(y1);
    this._intervals.splice(index, 0, [y1, y2]);
  }

  private _remove(edge: [number, number, number, boolean]): void {
    const [, y1, y2] = edge as number[];
    const index = this._binarySearch(y1);
    for (let i = index; i < this._intervals.length; i++) {
      const [start, end] = this._intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this._intervals.splice(i, 1);
        return;
      }
    }
    for (let i = index - 1; i >= 0; i--) {
      const [start, end] = this._intervals[i];
      if (start !== y1) {
        break;
      }
      if (start === y1 && end === y2) {
        this._intervals.splice(i, 1);
        return;
      }
    }
  }

  private _breakEdge(edge: [number, number, number, boolean]): number[][] {
    const [x, y1, y2] = edge as number[];
    const results: number[][] = [[x, y1, y2]];
    const index = this._binarySearch(y2);
    for (let i = 0; i < index; i++) {
      const [start, end] = this._intervals[i];
      for (let j = 0, jj = results.length; j < jj; j++) {
        const [, y3, y4] = results[j];
        if (end <= y3 || y4 <= start) {
          continue;
        }
        if (y3 >= start) {
          if (y4 > end) {
            results[j][1] = end;
          } else {
            if (jj === 1) {
              return [];
            }
            results.splice(j, 1);
            j--;
            jj--;
          }
          continue;
        }
        results[j][2] = start;
        if (y4 > end) {
          results.push([x, end, y4]);
        }
      }
    }
    return results;
  }

  get box(): Float32Array {
    return this._box;
  }

  get firstPoint(): [number, number] {
    return this._firstPoint;
  }

  get lastPoint(): [number, number] {
    return this._lastPoint;
  }
}

export class FreeDrawOutline extends Outline {
  private _box: number[] | Float32Array;
  private _bbox: Float32Array = new Float32Array(4);
  private _innerMargin: number;
  private _isLTR: boolean;
  private _points: number[] | Float32Array;
  private _scaleFactor: number;
  private _outline: number[] | Float32Array;
  public firstPoint: [number, number];
  public lastPoint: [number, number];

  constructor(outline: number[] | Float32Array, points: number[] | Float32Array, box: number[] | Float32Array, scaleFactor: number, innerMargin: number, isLTR: boolean) {
    super();
    this._outline = outline;
    this._points = points;
    this._box = box;
    this._scaleFactor = scaleFactor;
    this._innerMargin = innerMargin;
    this._isLTR = isLTR;
    this.firstPoint = [NaN, NaN];
    this.lastPoint = [NaN, NaN];
    this._computeMinMax(isLTR);

    const [x, y, width, height] = this._bbox;
    for (let i = 0, ii = outline.length; i < ii; i += 2) {
      if (!isNaN(outline[i])) {
        outline[i] = (outline[i] - x) / width;
        outline[i + 1] = (outline[i + 1] - y) / height;
      }
    }
    for (let i = 0, ii = points.length; i < ii; i += 2) {
      points[i] = (points[i] - x) / width;
      points[i + 1] = (points[i + 1] - y) / height;
    }
  }

  toSVGPath(): string {
    const buffer = [`M${this._outline[4]} ${this._outline[5]}`];
    for (let i = 6, ii = this._outline.length; i < ii; i += 6) {
      if (isNaN(this._outline[i])) {
        buffer.push(`L${this._outline[i + 4]} ${this._outline[i + 5]}`);
        continue;
      }
      buffer.push(
        `C${this._outline[i]} ${this._outline[i + 1]} ${this._outline[i + 2]} ${
          this._outline[i + 3]
        } ${this._outline[i + 4]} ${this._outline[i + 5]}`
      );
    }
    buffer.push("Z");
    return buffer.join(" ");
  }

  serialize([blX, blY, trX, trY]: [number, number, number, number], rotation: number) {
    const width = trX - blX;
    const height = trY - blY;
    let outline: any;
    let points: any;
    switch (rotation) {
      case 0:
        outline = Outline._rescale(this._outline, blX, trY, width, -height);
        points = Outline._rescale(this._points, blX, trY, width, -height);
        break;
      case 90:
        outline = Outline._rescaleAndSwap(this._outline, blX, blY, width, height);
        points = Outline._rescaleAndSwap(this._points, blX, blY, width, height);
        break;
      case 180:
        outline = Outline._rescale(this._outline, trX, blY, -width, height);
        points = Outline._rescale(this._points, trX, blY, -width, height);
        break;
      case 270:
        outline = Outline._rescaleAndSwap(this._outline, trX, trY, -width, -height);
        points = Outline._rescaleAndSwap(this._points, trX, trY, -width, -height);
        break;
    }
    return { outline: Array.from(outline), points: [Array.from(points)] };
  }

  private _computeMinMax(isLTR: boolean) {
    const outline = this._outline;
    let lastX = outline[4];
    let lastY = outline[5];
    const minMax = [lastX, lastY, lastX, lastY];
    let firstPointX = lastX;
    let firstPointY = lastY;
    let lastPointX = lastX;
    let lastPointY = lastY;
    const ltrCallback = isLTR ? Math.max : Math.min;
    const bezierBbox = new Float32Array(4);

    for (let i = 6, ii = outline.length; i < ii; i += 6) {
      const x = outline[i + 4], y = outline[i + 5];

      if (isNaN(outline[i])) {
        Util.pointBoundingBox(x, y, minMax);

        if (firstPointY > y) {
          firstPointX = x;
          firstPointY = y;
        } else if (firstPointY === y) {
          firstPointX = ltrCallback(firstPointX, x);
        }
        if (lastPointY < y) {
          lastPointX = x;
          lastPointY = y;
        } else if (lastPointY === y) {
          lastPointX = ltrCallback(lastPointX, x);
        }
      } else {
        bezierBbox[0] = bezierBbox[1] = Infinity;
        bezierBbox[2] = bezierBbox[3] = -Infinity;
        Util.bezierBoundingBox(
          lastX, lastY,
          outline[i], outline[i + 1], outline[i + 2], outline[i + 3], outline[i + 4], outline[i + 5],
          bezierBbox
        );

        Util.rectBoundingBox(bezierBbox[0], bezierBbox[1], bezierBbox[2], bezierBbox[3], minMax);

        if (firstPointY > bezierBbox[1]) {
          firstPointX = bezierBbox[0];
          firstPointY = bezierBbox[1];
        } else if (firstPointY === bezierBbox[1]) {
          firstPointX = ltrCallback(firstPointX, bezierBbox[0]);
        }
        if (lastPointY < bezierBbox[3]) {
          lastPointX = bezierBbox[2];
          lastPointY = bezierBbox[3];
        } else if (lastPointY === bezierBbox[3]) {
          lastPointX = ltrCallback(lastPointX, bezierBbox[2]);
        }
      }
      lastX = x;
      lastY = y;
    }

    const bbox = this._bbox;
    bbox[0] = minMax[0] - this._innerMargin;
    bbox[1] = minMax[1] - this._innerMargin;
    bbox[2] = minMax[2] - minMax[0] + 2 * this._innerMargin;
    bbox[3] = minMax[3] - minMax[1] + 2 * this._innerMargin;
    this.firstPoint = [firstPointX, firstPointY];
    this.lastPoint = [lastPointX, lastPointY];
  }

  get box() {
    return this._bbox;
  }

  newOutliner(point: { x: number, y: number }, box: number[] | Float32Array, scaleFactor: number, thickness: number, isLTR: boolean, innerMargin: number = 0) {
    return new FreeDrawOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin);
  }

  getNewOutline(thickness: number, innerMargin?: number) {
    const [x, y, width, height] = this._bbox;
    const [layerX, layerY, layerWidth, layerHeight] = this._box;
    const sx = width * layerWidth;
    const sy = height * layerHeight;
    const tx = x * layerWidth + layerX;
    const ty = y * layerHeight + layerY;
    const outliner = this.newOutliner(
      {
        x: this._points[0] * sx + tx,
        y: this._points[1] * sy + ty,
      },
      this._box,
      this._scaleFactor,
      thickness,
      this._isLTR,
      innerMargin ?? this._innerMargin
    );
    for (let i = 2; i < this._points.length; i += 2) {
      outliner.add({
        x: this._points[i] * sx + tx,
        y: this._points[i + 1] * sy + ty,
      });
    }
    return outliner.getOutlines();
  }
}

export class FreeDrawOutliner {
  private _box: number[] | Float32Array;
  private _bottom: number[] = [];
  private _innerMargin: number;
  private _isLTR: boolean;
  private _top: number[] = [];
  private _last = new Float32Array(18);
  private _lastX: number = 0;
  private _lastY: number = 0;
  private _min: number;
  private _min_dist: number;
  private _scaleFactor: number;
  private _thickness: number;
  private _points: number[] = [];

  static MIN_DIST = 8;
  static MIN_DIFF = 2;
  static MIN = FreeDrawOutliner.MIN_DIST + FreeDrawOutliner.MIN_DIFF;

  constructor({ x, y }: { x: number, y: number }, box: number[] | Float32Array, scaleFactor: number, thickness: number, isLTR: boolean, innerMargin = 0) {
    this._box = box;
    this._thickness = thickness * scaleFactor;
    this._isLTR = isLTR;
    this._last.set([NaN, NaN, NaN, NaN, x, y], 6);
    this._innerMargin = innerMargin;
    this._min_dist = FreeDrawOutliner.MIN_DIST * scaleFactor;
    this._min = FreeDrawOutliner.MIN * scaleFactor;
    this._scaleFactor = scaleFactor;
    this._points.push(x, y);
    this._lastX = x;
    this._lastY = y;
  }

  isEmpty() {
    return isNaN(this._last[8]);
  }

  private _getLastCoords() {
    const lastTop = this._last.subarray(4, 6);
    const lastBottom = this._last.subarray(16, 18);
    const [x, y, width, height] = this._box;

    return [
      (this._lastX + (lastTop[0] - lastBottom[0]) / 2 - x) / width,
      (this._lastY + (lastTop[1] - lastBottom[1]) / 2 - y) / height,
      (this._lastX + (lastBottom[0] - lastTop[0]) / 2 - x) / width,
      (this._lastY + (lastBottom[1] - lastTop[1]) / 2 - y) / height,
    ];
  }

  add({ x, y }: { x: number, y: number }) {
    this._lastX = x;
    this._lastY = y;
    const [layerX, layerY, layerWidth, layerHeight] = this._box;
    let [x1, y1, x2, y2] = this._last.subarray(8, 12);
    const diffX = x - x2;
    const diffY = y - y2;
    const d = Math.hypot(diffX, diffY);
    if (d < this._min) {
      return false;
    }
    const diffD = d - this._min_dist;
    const K = diffD / d;
    const shiftX = K * diffX;
    const shiftY = K * diffY;

    let x0 = x1;
    let y0 = y1;
    x1 = x2;
    y1 = y2;
    x2 += shiftX;
    y2 += shiftY;

    this._points.push(x, y);

    const nX = -shiftY / diffD;
    const nY = shiftX / diffD;
    const thX = nX * this._thickness;
    const thY = nY * this._thickness;
    this._last.set(this._last.subarray(2, 8), 0);
    this._last.set([x2 + thX, y2 + thY], 4);
    this._last.set(this._last.subarray(14, 18), 12);
    this._last.set([x2 - thX, y2 - thY], 16);

    if (isNaN(this._last[6])) {
      if (this._top.length === 0) {
        this._last.set([x1 + thX, y1 + thY], 2);
        this._top.push(
          NaN, NaN, NaN, NaN,
          (x1 + thX - layerX) / layerWidth,
          (y1 + thY - layerY) / layerHeight
        );
        this._last.set([x1 - thX, y1 - thY], 14);
        this._bottom.push(
          NaN, NaN, NaN, NaN,
          (x1 - thX - layerX) / layerWidth,
          (y1 - thY - layerY) / layerHeight
        );
      }
      this._last.set([x0, y0, x1, y1, x2, y2], 6);
      return !this.isEmpty();
    }

    this._last.set([x0, y0, x1, y1, x2, y2], 6);

    const angle = Math.abs(Math.atan2(y0 - y1, x0 - x1) - Math.atan2(shiftY, shiftX));
    if (angle < Math.PI / 2) {
      let [tx1, ty1, tx2, ty2] = this._last.subarray(2, 6);
      this._top.push(
        NaN, NaN, NaN, NaN,
        ((tx1 + tx2) / 2 - layerX) / layerWidth,
        ((ty1 + ty2) / 2 - layerY) / layerHeight
      );
      [tx1, ty1, x0, y0] = this._last.subarray(14, 18);
      this._bottom.push(
        NaN, NaN, NaN, NaN,
        ((x0 + tx1) / 2 - layerX) / layerWidth,
        ((y0 + ty1) / 2 - layerY) / layerHeight
      );
      return true;
    }

    [x0, y0, x1, y1, x2, y2] = this._last.subarray(0, 6);
    this._top.push(
      ((x0 + 5 * x1) / 6 - layerX) / layerWidth,
      ((y0 + 5 * y1) / 6 - layerY) / layerHeight,
      ((5 * x1 + x2) / 6 - layerX) / layerWidth,
      ((5 * y1 + y2) / 6 - layerY) / layerHeight,
      ((x1 + x2) / 2 - layerX) / layerWidth,
      ((y1 + y2) / 2 - layerY) / layerHeight
    );
    [x2, y2, x1, y1, x0, y0] = this._last.subarray(12, 18);
    this._bottom.push(
      ((x0 + 5 * x1) / 6 - layerX) / layerWidth,
      ((y0 + 5 * y1) / 6 - layerY) / layerHeight,
      ((5 * x1 + x2) / 6 - layerX) / layerWidth,
      ((5 * y1 + y2) / 6 - layerY) / layerHeight,
      ((x1 + x2) / 2 - layerX) / layerWidth,
      ((y1 + y2) / 2 - layerY) / layerHeight
    );
    return true;
  }

  toSVGPath(): string {
    if (this.isEmpty()) return "";
    const top = this._top;
    const bottom = this._bottom;

    if (isNaN(this._last[6]) && !this.isEmpty()) {
      return this._toSVGPathTwoPoints();
    }

    const buffer: string[] = [];
    buffer.push(`M${top[4]} ${top[5]}`);
    for (let i = 6; i < top.length; i += 6) {
      if (isNaN(top[i])) {
        buffer.push(`L${top[i + 4]} ${top[i + 5]}`);
      } else {
        buffer.push(`C${top[i]} ${top[i + 1]} ${top[i + 2]} ${top[i + 3]} ${top[i + 4]} ${top[i + 5]}`);
      }
    }

    this._toSVGPathEnd(buffer);

    for (let i = bottom.length - 6; i >= 6; i -= 6) {
      if (isNaN(bottom[i])) {
        buffer.push(`L${bottom[i + 4]} ${bottom[i + 5]}`);
      } else {
        buffer.push(`C${bottom[i]} ${bottom[i + 1]} ${bottom[i + 2]} ${bottom[i + 3]} ${bottom[i + 4]} ${bottom[i + 5]}`);
      }
    }

    this._toSVGPathStart(buffer);

    return buffer.join(" ");
  }

  private _toSVGPathTwoPoints(): string {
    const [x, y, width, height] = this._box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this._getLastCoords();

    return `M${(this._last[2] - x) / width} ${(this._last[3] - y) / height} L${(this._last[4] - x) / width} ${(this._last[5] - y) / height} L${lastTopX} ${lastTopY} L${lastBottomX} ${lastBottomY} L${(this._last[16] - x) / width} ${(this._last[17] - y) / height} L${(this._last[14] - x) / width} ${(this._last[15] - y) / height} Z`;
  }

  private _toSVGPathStart(buffer: string[]) {
    const bottom = this._bottom;
    buffer.push(`L${bottom[4]} ${bottom[5]} Z`);
  }

  private _toSVGPathEnd(buffer: string[]) {
    const [x, y, width, height] = this._box;
    const lastTop = this._last.subarray(4, 6);
    const lastBottom = this._last.subarray(16, 18);
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this._getLastCoords();

    buffer.push(
      `L${(lastTop[0] - x) / width} ${(lastTop[1] - y) / height} L${lastTopX} ${lastTopY} L${lastBottomX} ${lastBottomY} L${(lastBottom[0] - x) / width} ${(lastBottom[1] - y) / height}`
    );
  }

  newFreeDrawOutline(outline: Float32Array, points: Float32Array, box: number[] | Float32Array, scaleFactor: number, innerMargin: number, isLTR: boolean) {
    return new FreeDrawOutline(outline, points, box, scaleFactor, innerMargin, isLTR);
  }

  getOutlines() {
    const top = this._top;
    const bottom = this._bottom;
    const last = this._last;
    const [layerX, layerY, layerWidth, layerHeight] = this._box;

    const points = new Float32Array(this._points.length + 2);
    for (let i = 0, ii = points.length - 2; i < ii; i += 2) {
      points[i] = (this._points[i] - layerX) / layerWidth;
      points[i + 1] = (this._points[i + 1] - layerY) / layerHeight;
    }
    points[points.length - 2] = (this._lastX - layerX) / layerWidth;
    points[points.length - 1] = (this._lastY - layerY) / layerHeight;

    if (isNaN(last[6]) && !this.isEmpty()) {
      return this._getOutlineTwoPoints(points);
    }

    const outline = new Float32Array(this._top.length + 24 + this._bottom.length);
    let N = top.length;
    for (let i = 0; i < N; i += 2) {
      if (isNaN(top[i])) {
        outline[i] = outline[i + 1] = NaN;
        continue;
      }
      outline[i] = top[i];
      outline[i + 1] = top[i + 1];
    }

    N = this._getOutlineEnd(outline, N);

    for (let i = bottom.length - 6; i >= 6; i -= 6) {
      for (let j = 0; j < 6; j += 2) {
        if (isNaN(bottom[i + j])) {
          outline[N] = outline[N + 1] = NaN;
          N += 2;
          continue;
        }
        outline[N] = bottom[i + j];
        outline[N + 1] = bottom[i + j + 1];
        N += 2;
      }
    }

    this._getOutlineStart(outline, N);

    return this.newFreeDrawOutline(
      outline,
      points,
      this._box,
      this._scaleFactor,
      this._innerMargin,
      this._isLTR
    );
  }

  private _getOutlineTwoPoints(points: Float32Array) {
    const last = this._last;
    const [layerX, layerY, layerWidth, layerHeight] = this._box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this._getLastCoords();
    const outline = new Float32Array(36);
    outline.set([
      NaN, NaN, NaN, NaN,
      (last[2] - layerX) / layerWidth, (last[3] - layerY) / layerHeight,
      NaN, NaN, NaN, NaN,
      (last[4] - layerX) / layerWidth, (last[5] - layerY) / layerHeight,
      NaN, NaN, NaN, NaN,
      lastTopX, lastTopY,
      NaN, NaN, NaN, NaN,
      lastBottomX, lastBottomY,
      NaN, NaN, NaN, NaN,
      (last[16] - layerX) / layerWidth, (last[17] - layerY) / layerHeight,
      NaN, NaN, NaN, NaN,
      (last[14] - layerX) / layerWidth, (last[15] - layerY) / layerHeight,
    ], 0);
    return this.newFreeDrawOutline(outline, points, this._box, this._scaleFactor, this._innerMargin, this._isLTR);
  }

  private _getOutlineStart(outline: Float32Array, pos: number) {
    const bottom = this._bottom;
    outline.set([NaN, NaN, NaN, NaN, bottom[4], bottom[5]], pos);
    return pos + 6;
  }

  private _getOutlineEnd(outline: Float32Array, pos: number) {
    const lastTop = this._last.subarray(4, 6);
    const lastBottom = this._last.subarray(16, 18);
    const [layerX, layerY, layerWidth, layerHeight] = this._box;
    const [lastTopX, lastTopY, lastBottomX, lastBottomY] = this._getLastCoords();
    outline.set([
      NaN, NaN, NaN, NaN,
      (lastTop[0] - layerX) / layerWidth, (lastTop[1] - layerY) / layerHeight,
      NaN, NaN, NaN, NaN,
      lastTopX, lastTopY,
      NaN, NaN, NaN, NaN,
      lastBottomX, lastBottomY,
      NaN, NaN, NaN, NaN,
      (lastBottom[0] - layerX) / layerWidth, (lastBottom[1] - layerY) / layerHeight,
    ], pos);
    return pos + 24;
  }
}

export class FreeHighlightOutline extends FreeDrawOutline {
  newOutliner(point: { x: number, y: number }, box: number[] | Float32Array, scaleFactor: number, thickness: number, isLTR: boolean, innerMargin: number = 0) {
    return new FreeHighlightOutliner(point, box, scaleFactor, thickness, isLTR, innerMargin);
  }
}

export class FreeHighlightOutliner extends FreeDrawOutliner {
  newFreeDrawOutline(outline: Float32Array, points: Float32Array, box: number[] | Float32Array, scaleFactor: number, innerMargin: number, isLTR: boolean) {
    return new FreeHighlightOutline(outline, points, box, scaleFactor, innerMargin, isLTR);
  }
}
