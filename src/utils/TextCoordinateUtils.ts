export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Utility class for coordinate conversions between different layers.
 */
export class TextCoordinateUtils {
  /**
   * Converts viewport coordinates (pixels) to normalized page coordinates (0-1).
   */
  public static normalizeCoordinates(point: Point, viewportSize: { width: number, height: number }): Point {
    return {
      x: point.x / viewportSize.width,
      y: point.y / viewportSize.height
    };
  }

  /**
   * Converts normalized page coordinates (0-1) back to viewport coordinates (pixels).
   */
  public static denormalizeCoordinates(point: Point, viewportSize: { width: number, height: number }): Point {
    return {
      x: point.x * viewportSize.width,
      y: point.y * viewportSize.height
    };
  }

  /**
   * Calculates the union of multiple rectangles.
   */
  public static getUnionRect(rects: Rect[]): Rect {
    if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const rect of rects) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }
}
