import { describe, expect, it, vi } from 'vitest';
import { InkObject } from '../../../src/lib/models/InkObject';

// Ported from tests/InkPlugin.test.ts (the InkObject describe block). The
// model logic is unchanged by the lib refactor — only the import path moved
// from src/models/InkObject to src/lib/models/InkObject.
describe('InkObject', () => {
  const mockPaths = [
    {
      points: [0.1, 0.1, 0.2, 0.2],
      line: [NaN, NaN, NaN, NaN, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2],
    },
  ];

  it('calculates bounds correctly', () => {
    const ink = new InkObject('test-1', mockPaths, '#000', 1);
    const bounds = ink.getBounds();
    expect(bounds.x).toBeCloseTo(0.1);
    expect(bounds.y).toBeCloseTo(0.1);
    expect(bounds.width).toBeCloseTo(0.1);
    expect(bounds.height).toBeCloseTo(0.1);
  });

  it('handles empty paths when calculating bounds', () => {
    const ink = new InkObject('test-empty', [], '#000', 1);
    const bounds = ink.getBounds();
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('handles resize with different anchors', () => {
    const ink = new InkObject('test-resize', JSON.parse(JSON.stringify(mockPaths)), '#000', 1);
    ink.resize('nw', 0.1, 0.1);
    const bounds = ink.getBounds();
    expect(bounds.width).toBeCloseTo(0);
    expect(bounds.height).toBeCloseTo(0);
  });

  it('hitTest correctly identifies pointer intersection', () => {
    const ink = new InkObject('test-2', mockPaths, '#000', 1);

    expect(ink.hitTest(0.1, 0.1)).toBe(true);
    expect(ink.hitTest(0.2, 0.2)).toBe(true);

    expect(ink.hitTest(0.5, 0.5)).toBe(false);
    expect(ink.hitTest(0, 0)).toBe(false);

    expect(ink.hitTest(0.1, 0.2)).toBe(false);
  });

  it('move updates bounds and paths', () => {
    const ink = new InkObject('test-3', JSON.parse(JSON.stringify(mockPaths)), '#000', 1);
    ink.move(0.1, 0.1);

    const bounds = ink.getBounds();
    expect(bounds.x).toBeCloseTo(0.2);
    expect(bounds.y).toBeCloseTo(0.2);

    expect(ink.paths[0].line[4]).toBeCloseTo(0.2);
    expect(ink.paths[0].line[5]).toBeCloseTo(0.2);
  });

  it('resize updates bounds and scales paths', () => {
    const ink = new InkObject('test-4', JSON.parse(JSON.stringify(mockPaths)), '#000', 1);

    ink.resize('se', 0.1, 0.1);

    const bounds = ink.getBounds();
    expect(bounds.width).toBeCloseTo(0.2);
    expect(bounds.height).toBeCloseTo(0.2);

    expect(ink.paths[0].line[10]).toBeCloseTo(0.3);
    expect(ink.paths[0].line[11]).toBeCloseTo(0.3);
  });

  it('serialize and deserialize reproduce identical objects', () => {
    const ink = new InkObject('test-5', mockPaths, '#ff0000', 2);
    const data = ink.serialize();

    expect(data.id).toBe('test-5');
    expect(data.color).toBe('#ff0000');
    expect(data.strokeWidth).toBe(2);

    const newInk = new InkObject();
    newInk.deserialize(data);

    expect(newInk.id).toBe('test-5');
    expect(newInk.color).toBe('#ff0000');
    expect(newInk.strokeWidth).toBe(2);
    expect(newInk.getBounds()).toEqual(ink.getBounds());
    expect(newInk.paths).toEqual(ink.paths);
  });

  it('renders paths correctly', () => {
    const paths = [
      { points: [], line: [NaN, NaN, NaN, NaN, 0.1, 0.1] }, // length 6
      {
        points: [],
        line: [NaN, NaN, NaN, NaN, 0.1, 0.1, NaN, NaN, NaN, NaN, 0.2, 0.2],
      }, // length 12 with NaN
      {
        points: [],
        line: [NaN, NaN, NaN, NaN, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2],
      }, // standard curve
    ];
    const ink = new InkObject('test-render', paths, '#000', 1);

    const mockCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    ink.render(mockCtx, 800, 600);
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.moveTo).toHaveBeenCalledTimes(3);
    expect(mockCtx.lineTo).toHaveBeenCalledTimes(2);
    expect(mockCtx.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(mockCtx.stroke).toHaveBeenCalled();
  });
});
