import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HighlightOutliner, HighlightOutline } from '../src/drawers/HighlightOutliner';
import { HighlightObject } from '../src/models/HighlightObject';
import { HighlightPlugin } from '../src/plugins/HighlightPlugin';

describe('HighlightOutliner', () => {
  it('creates outlines from a single box', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
    expect(outlines.box).toBeDefined();
    expect(outlines.box.length).toBe(4);
  });

  it('creates outlines from multiple boxes', () => {
    const boxes = [
      { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      { x: 0.4, y: 0.1, width: 0.2, height: 0.1 }
    ];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines.outlines.length).toBeGreaterThan(0);
  });

  it('handles RTL direction correctly', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }];
    const outlinerLTR = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlinerRTL = new HighlightOutliner(boxes, 0.001, 0.001, false);

    const outlinesLTR = outlinerLTR.getOutlines();
    const outlinesRTL = outlinerRTL.getOutlines();

    expect(outlinesLTR).toBeInstanceOf(HighlightOutline);
    expect(outlinesRTL).toBeInstanceOf(HighlightOutline);
  });

  it('handles empty boxes array', () => {
    const outliner = new HighlightOutliner([], 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
    expect(outlines.outlines.length).toBe(0);
  });

  it('handles box with zero dimensions', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0, height: 0 }];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });

  it('respects borderWidth parameter', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }];
    const outliner1 = new HighlightOutliner(boxes, 0, 0, true);
    const outliner2 = new HighlightOutliner(boxes, 0.01, 0, true);

    const outlines1 = outliner1.getOutlines();
    const outlines2 = outliner2.getOutlines();

    expect(outlines1.box[2]).toBeLessThan(outlines2.box[2]);
    expect(outlines1.box[3]).toBeLessThan(outlines2.box[3]);
  });

  it('respects innerMargin parameter', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }];
    const outliner1 = new HighlightOutliner(boxes, 0, 0, true);
    const outliner2 = new HighlightOutliner(boxes, 0, 0.01, true);

    const outlines1 = outliner1.getOutlines();
    const outlines2 = outliner2.getOutlines();

    expect(outlines1.box[2]).toBeLessThan(outlines2.box[2]);
    expect(outlines1.box[3]).toBeLessThan(outlines2.box[3]);
  });

  it('returns correct firstPoint and lastPoint', () => {
    const boxes = [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines.firstPoint).toBeDefined();
    expect(outlines.lastPoint).toBeDefined();
    expect(outlines.firstPoint.length).toBe(2);
    expect(outlines.lastPoint.length).toBe(2);
  });

  it('handles overlapping boxes', () => {
    const boxes = [
      { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { x: 0.15, y: 0.15, width: 0.2, height: 0.2 }
    ];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });

  it('handles adjacent boxes', () => {
    const boxes = [
      { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      { x: 0.2, y: 0.1, width: 0.1, height: 0.1 }
    ];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });

  it('handles nested boxes', () => {
    const boxes = [
      { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      { x: 0.15, y: 0.15, width: 0.2, height: 0.2 }
    ];
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });
});

describe('HighlightOutline', () => {
  it('generates valid SVG path', () => {
    const outlines = new HighlightOutline(
      [[0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const svgPath = outlines.toSVGPath();
    expect(svgPath).toContain('M');
    expect(svgPath).toContain('Z');
  });

  it('generates SVG path with horizontal and vertical lines', () => {
    const outlines = new HighlightOutline(
      [[0, 0, 0.5, 0, 1, 0, 1, 0.5, 0.5, 0.5, 0.5, 1, 0, 1, 0, 0]],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const svgPath = outlines.toSVGPath();
    expect(svgPath).toContain('H');
    expect(svgPath).toContain('V');
  });

  it('serializes outlines correctly', () => {
    const outlines = new HighlightOutline(
      [[0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const serialized = outlines.serialize([0, 0, 100, 100], 0);
    expect(serialized.length).toBe(1);
    expect(serialized[0].length).toBe(10);
  });

  it('serializes with rotation 90', () => {
    const outlines = new HighlightOutline(
      [[0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const serialized = outlines.serialize([0, 0, 100, 100], 90);
    expect(serialized.length).toBe(1);
  });

  it('handles empty outlines', () => {
    const outlines = new HighlightOutline(
      [],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const svgPath = outlines.toSVGPath();
    expect(svgPath).toBe('');
  });

  it('returns correct box', () => {
    const box = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const outlines = new HighlightOutline([], box, [0, 0], [1, 1]);

    expect(outlines.box).toBe(box);
    expect(outlines.box[0]).toBeCloseTo(0.1);
    expect(outlines.box[1]).toBeCloseTo(0.2);
    expect(outlines.box[2]).toBeCloseTo(0.3);
    expect(outlines.box[3]).toBeCloseTo(0.4);
  });

  it('handles complex polygon with many points', () => {
    const polygon: number[] = [];
    const n = 20;
    for (let i = 0; i < n; i++) {
      polygon.push(i / n, (n - i) / n);
    }
    polygon.push(0, 0);

    const outlines = new HighlightOutline(
      [polygon],
      new Float32Array([0, 0, 1, 1]),
      [0, 1],
      [1, 0]
    );

    const svgPath = outlines.toSVGPath();
    expect(svgPath.length).toBeGreaterThan(0);
  });
});

describe('HighlightObject', () => {
  beforeEach(() => {
    // Mock Path2D for Node.js environment
    if (typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = class Path2D {
        constructor(path?: string) {}
      } as any;
    }
  });

  it('creates a highlight object with default values', () => {
    const highlight = new HighlightObject();

    expect(highlight.id).toBe('');
    expect(highlight.paths).toEqual([]);
    expect(highlight.color).toBe('#fff066');
    expect(highlight.opacity).toBe(1);
    expect(highlight.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('calculates bounds from polygon data', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-1', paths, '#ff0000', 0.5);

    const bounds = highlight.getBounds();
    expect(bounds.x).toBeCloseTo(0.1);
    expect(bounds.y).toBeCloseTo(0.1);
    expect(bounds.width).toBeCloseTo(0.2);
    expect(bounds.height).toBeCloseTo(0.2);
  });

  it('handles empty paths in bounds calculation', () => {
    const highlight = new HighlightObject('test-empty', [], '#ff0000', 1);

    const bounds = highlight.getBounds();
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('hitTest returns true for point inside polygon', () => {
    const paths = [{ polygon: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0] }];
    const highlight = new HighlightObject('test-hit', paths, '#ff0000', 1);

    expect(highlight.hitTest(0.5, 0.5)).toBe(true);
    expect(highlight.hitTest(0.1, 0.1)).toBe(true);
  });

  it('hitTest returns false for point outside polygon', () => {
    const paths = [{ polygon: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0] }];
    const highlight = new HighlightObject('test-miss', paths, '#ff0000', 1);

    expect(highlight.hitTest(1.5, 1.5)).toBe(false);
    expect(highlight.hitTest(-0.1, -0.1)).toBe(false);
    expect(highlight.hitTest(0.5, 1.5)).toBe(false);
  });

  it('hitTest respects margin', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-margin', paths, '#ff0000', 1);

    expect(highlight.hitTest(0.09, 0.15)).toBe(false);
  });

  it('move updates bounds and paths', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-move', paths, '#ff0000', 1);

    highlight.move(0.1, 0.1);

    const bounds = highlight.getBounds();
    expect(bounds.x).toBeCloseTo(0.2);
    expect(bounds.y).toBeCloseTo(0.2);

    expect(highlight.paths[0].polygon[0]).toBeCloseTo(0.2);
    expect(highlight.paths[0].polygon[1]).toBeCloseTo(0.2);
  });

  it('move with quadPoints updates quadPoints', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const quadPoints = new Float32Array([0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]);
    const highlight = new HighlightObject('test-move-qp', paths, '#ff0000', 1, undefined, quadPoints);

    highlight.move(0.05, 0.05);

    expect(highlight.quadPoints![0]).toBeCloseTo(0.15);
    expect(highlight.quadPoints![1]).toBeCloseTo(0.15);
  });

  it('resize updates bounds and paths with anchor nw', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-resize-nw', paths, '#ff0000', 1);

    highlight.resize('nw', 0.05, 0.05);

    const bounds = highlight.getBounds();
    expect(bounds.x).toBeCloseTo(0.15);
    expect(bounds.y).toBeCloseTo(0.15);
    expect(bounds.width).toBeCloseTo(0.15);
    expect(bounds.height).toBeCloseTo(0.15);
  });

  it('resize updates bounds and paths with anchor se', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-resize-se', paths, '#ff0000', 1);

    highlight.resize('se', 0.1, 0.1);

    const bounds = highlight.getBounds();
    expect(bounds.width).toBeCloseTo(0.3);
    expect(bounds.height).toBeCloseTo(0.3);
  });

  it('resize handles zero dimensions gracefully', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-resize-zero', paths, '#ff0000', 1);

    highlight.resize('se', 0, 0);

    const bounds = highlight.getBounds();
    expect(bounds.width).toBeCloseTo(0.1);
    expect(bounds.height).toBeCloseTo(0.1);
  });

  it('serialize produces valid JSON-compatible output', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const quadPoints = new Float32Array([0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]);
    const highlight = new HighlightObject('test-ser', paths, '#ff0000', 0.8, undefined, quadPoints);

    const data = highlight.serialize();

    expect(data.type).toBe('highlight');
    expect(data.id).toBe('test-ser');
    expect(data.color).toBe('#ff0000');
    expect(data.opacity).toBe(0.8);
    expect(data.bounds).toBeDefined();
    expect(data.quadPoints).toBeDefined();
    expect(data.quadPoints.length).toBe(8);
  });

  it('deserialize restores object correctly', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const quadPoints = new Float32Array([0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]);
    const original = new HighlightObject('test-deser', paths, '#00ff00', 0.5, undefined, quadPoints);
    const data = original.serialize();

    const restored = new HighlightObject();
    restored.deserialize(data);

    expect(restored.id).toBe('test-deser');
    expect(restored.color).toBe('#00ff00');
    expect(restored.opacity).toBe(0.5);
    expect(restored.bounds).toEqual(original.bounds);
    expect(restored.quadPoints).toBeInstanceOf(Float32Array);
    expect(restored.quadPoints!.length).toBe(8);
  });

  it('deserialize handles missing quadPoints', () => {
    const data = {
      type: 'highlight',
      id: 'test-no-qp',
      paths: [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }],
      color: '#ff0000',
      opacity: 1,
      bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }
    };

    const restored = new HighlightObject();
    restored.deserialize(data);

    expect(restored.quadPoints).toBeUndefined();
  });

  it('render draws to canvas context', () => {
    const paths = [{ polygon: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0] }];
    const highlight = new HighlightObject('test-render', paths, '#ff0000', 0.5);

    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillStyle: '',
      globalAlpha: 0
    } as unknown as CanvasRenderingContext2D;

    highlight.render(mockCtx, 100, 100);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.fillStyle).toBe('#ff0000');
    expect(mockCtx.globalAlpha).toBe(0.5);
    expect(mockCtx.fill).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('render handles empty paths', () => {
    const highlight = new HighlightObject('test-render-empty', [], '#ff0000', 1);

    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    highlight.render(mockCtx, 100, 100);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.beginPath).not.toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('setOutline updates bounds from outline box', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-outline', paths, '#ff0000', 1);

    const outline = new HighlightOutline(
      paths.map(p => p.polygon),
      new Float32Array([0.05, 0.05, 0.2, 0.2]),
      [0.1, 0.1],
      [0.2, 0.2]
    );

    highlight.setOutline(outline);

    expect(highlight.bounds.x).toBeCloseTo(0.05);
    expect(highlight.bounds.y).toBeCloseTo(0.05);
    expect(highlight.bounds.width).toBeCloseTo(0.2);
    expect(highlight.bounds.height).toBeCloseTo(0.2);
  });

  it('outlineData returns null when no outline set', () => {
    const highlight = new HighlightObject('test-no-outline', [], '#ff0000', 1);

    expect(highlight.outlineData).toBeNull();
  });

  it('outlineData returns correct data when outline is set', () => {
    const paths = [{ polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1] }];
    const highlight = new HighlightObject('test-outline-data', paths, '#ff0000', 1);

    const outline = new HighlightOutline(
      paths.map(p => p.polygon),
      new Float32Array([0.05, 0.05, 0.2, 0.2]),
      [0.1, 0.1],
      [0.2, 0.2]
    );

    highlight.setOutline(outline);

    const data = highlight.outlineData;
    expect(data).not.toBeNull();
    expect(data!.svgPath).toBeDefined();
    expect(data!.box).toBeDefined();
    expect(data!.firstPoint).toEqual([0.1, 0.1]);
    expect(data!.lastPoint).toEqual([0.2, 0.2]);
  });

  it('handles point inside polygon', () => {
    const paths = [{ polygon: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0] }];
    const highlight = new HighlightObject('test-edge', paths, '#ff0000', 1);

    expect(highlight.hitTest(0.5, 0.5)).toBe(true);
    expect(highlight.hitTest(0.25, 0.25)).toBe(true);
  });
});

describe('HighlightPlugin', () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let store: any[];

  beforeEach(() => {
    // Mock Path2D for Node.js environment
    if (typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = class Path2D {
        constructor(path?: string) {}
      } as any;
    }

    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    ctx = {
      canvas,
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      strokeStyle: '',
      globalAlpha: 0,
      lineWidth: 0,
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      clearRect: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
    });

    store = [];
  });

  it('creates plugin with empty store', () => {
    const plugin = new HighlightPlugin(store);

    expect(plugin).toBeDefined();
    expect(plugin.getObjects()).toEqual([]);
  });

  it('activate sets canvas and context', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    expect(plugin.getObjects()).toEqual([]);
  });

  it('deactivate clears state', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);
    plugin.deactivate();

    expect(plugin.getObjects()).toEqual([]);
  });

  it('onPointerDown starts drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));

    expect(store.length).toBe(0);
  });

  it('onPointerMove updates current boxes during drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));

    expect(store.length).toBe(0);
  });

  it('onPointerUp creates highlight object on valid selection', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect(store.length).toBe(1);
    expect(store[0]).toBeInstanceOf(HighlightObject);
  });

  it('onPointerUp does not create object for tiny selection', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 100.5, clientY: 100.5 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 100.5, clientY: 100.5 }));

    expect(store.length).toBe(0);
  });

  it('onPointerUp handles reverse drag direction', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 200, clientY: 200 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 300, clientY: 300 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 300, clientY: 300 }));

    expect(store.length).toBe(1);
    expect(store[0]).toBeInstanceOf(HighlightObject);
  });

  it('handles events when not active', () => {
    const plugin = new HighlightPlugin(store);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect(store.length).toBe(0);
  });

  it('handles events when not drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect(store.length).toBe(0);
  });

  it('handles deactivate while drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.deactivate();

    expect(plugin.getObjects()).toEqual([]);
  });

  it('render draws all objects in store', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    plugin.render(ctx);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('render draws preview box during drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.mode = 'box';
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));

    plugin.render(ctx);

    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('render draws freeform preview during drawing', () => {
    const plugin = new HighlightPlugin(store);
    plugin.mode = 'free';
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));

    plugin.render(ctx);

    expect(ctx.fill).toHaveBeenCalled();
  });

  it('render handles not active state', () => {
    const plugin = new HighlightPlugin(store);
    plugin.render(ctx);

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('setColor updates plugin color', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.setColor('#ff0000');
    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect((store[0] as HighlightObject).color).toBe('#ff0000');
  });

  it('setOpacity updates plugin opacity', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.setOpacity(0.5);
    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect((store[0] as HighlightObject).opacity).toBe(0.5);
  });

  it('setOpacity clamps values to valid range', () => {
    const plugin = new HighlightPlugin(store);

    plugin.setOpacity(-0.5);
    expect(plugin['opacity']).toBe(0);

    plugin.setOpacity(1.5);
    expect(plugin['opacity']).toBe(1);
  });

  it('getObjects returns the store', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    expect(plugin.getObjects()).toBe(store);
    expect(plugin.getObjects().length).toBe(1);
  });

  it('creates multiple highlight objects', () => {
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 300, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 400, clientY: 200 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 400, clientY: 200 }));

    expect(store.length).toBe(2);
    expect(plugin.getObjects().length).toBe(2);
  });
});

describe('Performance Benchmarks', () => {
  it('HighlightOutliner handles many boxes efficiently', () => {
    const boxes = [];
    for (let i = 0; i < 100; i++) {
      boxes.push({
        x: i * 0.01,
        y: i * 0.01,
        width: 0.01,
        height: 0.01
      });
    }

    const start = performance.now();
    const outliner = new HighlightOutliner(boxes, 0.001, 0.001, true);
    const outlines = outliner.getOutlines();
    const end = performance.now();

    expect(outlines).toBeInstanceOf(HighlightOutline);
    expect(end - start).toBeLessThan(100);
  });

  it('HighlightObject hitTest is efficient', () => {
    const paths = [{ polygon: [] as number[] }];
    for (let i = 0; i < 1000; i++) {
      paths[0].polygon.push(i * 0.001, i * 0.001);
    }
    paths[0].polygon.push(0, 0);

    const highlight = new HighlightObject('perf-test', paths, '#ff0000', 1);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      highlight.hitTest(0.5, 0.5);
    }
    const end = performance.now();

    expect(end - start).toBeLessThan(50);
  });

  it('HighlightObject move is efficient', () => {
    const paths = [{ polygon: [] as number[] }];
    for (let i = 0; i < 1000; i++) {
      paths[0].polygon.push(i * 0.001, i * 0.001);
    }
    paths[0].polygon.push(0, 0);

    const highlight = new HighlightObject('perf-test', paths, '#ff0000', 1);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      highlight.move(0.001, 0.001);
    }
    const end = performance.now();

    expect(end - start).toBeLessThan(100);
  });

  it('HighlightOutline toSVGPath is efficient', () => {
    const polygon: number[] = [];
    for (let i = 0; i < 1000; i++) {
      polygon.push(i * 0.001, (1000 - i) * 0.001);
    }
    polygon.push(0, 0);

    const outlines = new HighlightOutline(
      [polygon],
      new Float32Array([0, 0, 1, 1]),
      [0, 0],
      [1, 1]
    );

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      outlines.toSVGPath();
    }
    const end = performance.now();

    expect(end - start).toBeLessThan(100);
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    // Mock Path2D for Node.js environment
    if (typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = class Path2D {
        constructor(path?: string) {}
      } as any;
    }
  });

  it('handles very small highlight (1 pixel)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    const ctx = {
      canvas,
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fill: vi.fn(),
      strokeStyle: '',
      globalAlpha: 0,
      lineWidth: 0,
      strokeRect: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
    });

    const store: any[] = [];
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 100.1, clientY: 100.1 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 100.1, clientY: 100.1 }));

    expect(store.length).toBe(0);
  });

  it('handles diagonal drag', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    const ctx = {
      canvas,
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
    });

    const store: any[] = [];
    const plugin = new HighlightPlugin(store);
    plugin.activate(canvas, ctx);

    plugin.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    plugin.onPointerMove(new PointerEvent('pointermove', { clientX: 300, clientY: 300 }));
    plugin.onPointerUp(new PointerEvent('pointerup', { clientX: 300, clientY: 300 }));

    expect(store.length).toBe(1);
    expect(store[0]).toBeInstanceOf(HighlightObject);
  });

  it('handles extremely large coordinates', () => {
    const outliner = new HighlightOutliner(
      [{ x: 1e10, y: 1e10, width: 1e10, height: 1e10 }],
      0.001,
      0.001,
      true
    );
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });

  it('handles negative coordinates', () => {
    const outliner = new HighlightOutliner(
      [{ x: -0.5, y: -0.5, width: 0.3, height: 0.3 }],
      0.001,
      0.001,
      true
    );
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });

  it('handles coordinates near zero', () => {
    const outliner = new HighlightOutliner(
      [{ x: 1e-10, y: 1e-10, width: 1e-10, height: 1e-10 }],
      0,
      0,
      true
    );
    const outlines = outliner.getOutlines();

    expect(outlines).toBeInstanceOf(HighlightOutline);
  });
});
