export class Outline {
  static PRECISION = 1e-4;

  toSVGPath(): string {
    throw new Error('Abstract method `toSVGPath` must be implemented.');
  }

  get box(): Float32Array | null {
    throw new Error('Abstract getter `box` must be implemented.');
  }

  serialize(_bbox: any, _rotation: number) {
    throw new Error('Abstract method `serialize` must be implemented.');
  }

  static _rescale(src: number[] | Float32Array | Float64Array, tx: number, ty: number, sx: number, sy: number, dest?: number[] | Float32Array | Float64Array) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i] * sx;
      dest[i + 1] = ty + src[i + 1] * sy;
    }
    return dest;
  }

  static _rescaleAndSwap(src: number[] | Float32Array | Float64Array, tx: number, ty: number, sx: number, sy: number, dest?: number[] | Float32Array | Float64Array) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i + 1] * sx;
      dest[i + 1] = ty + src[i] * sy;
    }
    return dest;
  }

  static _translate(src: number[] | Float32Array | Float64Array, tx: number, ty: number, dest?: number[] | Float32Array | Float64Array) {
    dest ||= new Float32Array(src.length);
    for (let i = 0, ii = src.length; i < ii; i += 2) {
      dest[i] = tx + src[i];
      dest[i + 1] = ty + src[i + 1];
    }
    return dest;
  }

  static svgRound(x: number): number {
    return Math.round(x * 10000);
  }

  static _normalizePoint(x: number, y: number, parentWidth: number, parentHeight: number, rotation: number): [number, number] {
    switch (rotation) {
      case 90:
        return [1 - y / parentWidth, x / parentHeight];
      case 180:
        return [1 - x / parentWidth, 1 - y / parentHeight];
      case 270:
        return [y / parentWidth, 1 - x / parentHeight];
      default:
        return [x / parentWidth, y / parentHeight];
    }
  }

  static _normalizePagePoint(x: number, y: number, rotation: number): [number, number] {
    switch (rotation) {
      case 90:
        return [1 - y, x];
      case 180:
        return [1 - x, 1 - y];
      case 270:
        return [y, 1 - x];
      default:
        return [x, y];
    }
  }

  static createBezierPoints(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number, number, number, number, number] {
    return [
      (x1 + 5 * x2) / 6,
      (y1 + 5 * y2) / 6,
      (5 * x2 + x3) / 6,
      (5 * y2 + y3) / 6,
      (x2 + x3) / 2,
      (y2 + y3) / 2,
    ];
  }
}
