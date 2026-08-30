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

  it('createFromBoxes builds an outlined highlight and persists it', () => {
    const { store, tool } = makeTool('box');
    const obj = tool.createFromBoxes(
      2,
      [{ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }],
      1000,
      800
    );

    expect(obj).toBeInstanceOf(HighlightObject);
    expect(obj!.pageNumber).toBe(2);
    expect(obj!.svgPath).toBeTruthy();
    expect(store.getForPage(2)).toHaveLength(1);
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
