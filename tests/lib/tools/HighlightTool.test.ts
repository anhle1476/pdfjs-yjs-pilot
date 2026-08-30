import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnnotationStore } from '../../../src/lib/AnnotationStore';
import { HighlightTool } from '../../../src/lib/tools/HighlightTool';
import { HighlightObject } from '../../../src/lib/models/HighlightObject';

function makeTool(mode: 'free' | 'box' | 'text' = 'free') {
  const doc = new Y.Doc();
  const store = new AnnotationStore(doc.getArray('annotations'));
  const tool = new HighlightTool(store, { color: '#fff066', opacity: 0.4, mode });
  return { doc, store, tool };
}

describe('HighlightTool', () => {
  it('createFromTextRange adds a highlight with bounds from the range', () => {
    const { store, tool } = makeTool('text');
    const obj = tool.createFromTextRange(3, {
      startX: 0.1,
      startY: 0.2,
      endX: 0.5,
      endY: 0.25,
    });

    expect(obj).toBeInstanceOf(HighlightObject);
    expect(obj.pageNumber).toBe(3);
    expect(obj.bounds.x).toBeCloseTo(0.1);
    expect(obj.bounds.y).toBeCloseTo(0.2);
    expect(obj.bounds.width).toBeCloseTo(0.4);
    expect(obj.bounds.height).toBeCloseTo(0.05);

    expect(store.getForPage(3)).toHaveLength(1);
  });

  it('createFromBoxes stores normalized union bounds and persists it', () => {
    const { store, tool } = makeTool('box');
    const obj = tool.createFromBoxes(
      2,
      [{ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }],
      1000,
      800
    );

    expect(obj).toBeInstanceOf(HighlightObject);
    expect(obj!.pageNumber).toBe(2);
    // Bounds equal the normalized input rect (no pixel-space outliner).
    expect(obj!.bounds.x).toBeCloseTo(0.1);
    expect(obj!.bounds.y).toBeCloseTo(0.1);
    expect(obj!.bounds.width).toBeCloseTo(0.3);
    expect(obj!.bounds.height).toBeCloseTo(0.1);
    // No svgPath/paths → render uses the normalized fillRect fallback.
    expect(obj!.svgPath).toBe('');
    expect(obj!.paths).toHaveLength(0);
    expect(store.getForPage(2)).toHaveLength(1);
  });

  it('createFromBoxes unions multiple rects into one bounds', () => {
    const { tool } = makeTool('box');
    const obj = tool.createFromBoxes(
      1,
      [
        { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
        { x: 0.5, y: 0.4, width: 0.2, height: 0.1 },
      ],
      1000,
      800
    );
    expect(obj!.bounds.x).toBeCloseTo(0.1);
    expect(obj!.bounds.y).toBeCloseTo(0.1);
    expect(obj!.bounds.width).toBeCloseTo(0.6); // 0.7 - 0.1
    expect(obj!.bounds.height).toBeCloseTo(0.4); // 0.5 - 0.1
  });

  it('createFromBoxes result paints a non-zero area on a canvas ctx', () => {
    const { tool } = makeTool('box');
    const obj = tool.createFromBoxes(
      2,
      [{ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }],
      1000,
      800
    );

    // Record fillRect calls on a mock 2D context.
    const calls: Array<[number, number, number, number]> = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push([x, y, w, h]);
      },
      set fillStyle(_v: string) {},
      set globalAlpha(_v: number) {},
    } as unknown as CanvasRenderingContext2D;

    obj!.render(ctx, 1000, 800);
    expect(calls).toHaveLength(1);
    const [x, y, w, h] = calls[0];
    // Pixel-space fill = normalized bounds * canvas dims.
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(80);
    expect(w).toBeCloseTo(300);
    expect(h).toBeCloseTo(80);
    expect(w * h).toBeGreaterThan(0);
  });

  it('createFromBoxes returns null for empty box list', () => {
    const { store, tool } = makeTool('box');
    expect(tool.createFromBoxes(1, [], 1000, 800)).toBeNull();
    expect(store.getAll()).toHaveLength(0);
  });

  it('begin/extend/end freeform creates a highlight from points', () => {
    const { store, tool } = makeTool('free');
    tool.beginFreeform(1, 1000, 800, 100, 100);
    tool.extendFreeform(150, 110);
    tool.extendFreeform(220, 120);
    tool.extendFreeform(300, 130);
    const created = tool.endFreeform();

    expect(created).toBeInstanceOf(HighlightObject);
    expect(created!.pageNumber).toBe(1);
    expect(created!.freeDraw).toBe(true);
    expect(store.getForPage(1)).toHaveLength(1);
  });

  it('endFreeform with no stroke returns null', () => {
    const { store, tool } = makeTool('free');
    expect(tool.endFreeform()).toBeNull();
    expect(store.getAll()).toHaveLength(0);
  });

  it('setMode / setColor update state', () => {
    const { tool } = makeTool('free');
    tool.setMode('text');
    expect(tool.mode).toBe('text');
    tool.setColor('#00ff00');
    expect(tool.color).toBe('#00ff00');
  });
});
