import { describe, expect, it } from 'vitest';
import { TextCoordinateUtils } from '../../../src/lib/utils/TextCoordinateUtils';

describe('TextCoordinateUtils', () => {
  it('normalize/denormalize round-trip', () => {
    const size = { width: 800, height: 600 };
    const px = { x: 200, y: 150 };
    const norm = TextCoordinateUtils.normalizeCoordinates(px, size);
    expect(norm.x).toBeCloseTo(0.25);
    expect(norm.y).toBeCloseTo(0.25);

    const back = TextCoordinateUtils.denormalizeCoordinates(norm, size);
    expect(back.x).toBeCloseTo(200);
    expect(back.y).toBeCloseTo(150);
  });

  it('normalize guards against zero-size viewport', () => {
    const norm = TextCoordinateUtils.normalizeCoordinates(
      { x: 10, y: 10 },
      { width: 0, height: 0 }
    );
    expect(norm).toEqual({ x: 0, y: 0 });
  });

  it('getUnionRect returns bounding box of multiple rects', () => {
    const union = TextCoordinateUtils.getUnionRect([
      { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { x: 0.5, y: 0.4, width: 0.1, height: 0.1 },
    ]);
    expect(union.x).toBeCloseTo(0.1);
    expect(union.y).toBeCloseTo(0.1);
    expect(union.width).toBeCloseTo(0.5); // 0.6 - 0.1
    expect(union.height).toBeCloseTo(0.4); // 0.5 - 0.1
  });

  it('getUnionRect returns zero rect for empty input', () => {
    expect(TextCoordinateUtils.getUnionRect([])).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
