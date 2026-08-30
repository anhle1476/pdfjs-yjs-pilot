import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnnotationStore } from '../../../src/lib/AnnotationStore';
import { InkTool } from '../../../src/lib/tools/InkTool';
import { InkObject } from '../../../src/lib/models/InkObject';

function makeTool() {
  const doc = new Y.Doc();
  const store = new AnnotationStore(doc.getArray('annotations'));
  const tool = new InkTool(store, { color: '#2563eb', strokeWidth: 2 });
  return { doc, store, tool };
}

describe('InkTool', () => {
  it('begin/extend/end creates an InkObject in the store', () => {
    const { store, tool } = makeTool();

    tool.beginStroke(2, 1000, 800, 100, 100);
    // Several extends so the outliner accumulates a line.
    tool.extendStroke(150, 150);
    tool.extendStroke(200, 200);
    tool.extendStroke(260, 240);
    const created = tool.endStroke(300, 280);

    expect(created).toBeInstanceOf(InkObject);
    expect(created!.pageNumber).toBe(2);
    expect(created!.color).toBe('#2563eb');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toBeInstanceOf(InkObject);
    expect(all[0].id).toBe(created!.id);
  });

  it('extendStroke returns null when no stroke is active', () => {
    const { tool } = makeTool();
    expect(tool.extendStroke(10, 10)).toBeNull();
  });

  it('cancelStroke aborts without persisting', () => {
    const { store, tool } = makeTool();
    tool.beginStroke(1, 1000, 800, 10, 10);
    tool.extendStroke(50, 50);
    tool.cancelStroke();
    expect(store.getAll()).toHaveLength(0);
    expect(tool.getState().drawing).toBe(false);
  });

  it('setColor / setStrokeWidth update tool state and notify', () => {
    const { tool } = makeTool();
    let lastState: any = null;
    tool.onStateChange((s) => {
      lastState = s;
    });
    tool.setColor('#ff0000');
    expect(tool.color).toBe('#ff0000');
    expect(lastState.color).toBe('#ff0000');
    tool.setStrokeWidth(5);
    expect(tool.strokeWidth).toBe(5);
    expect(lastState.strokeWidth).toBe(5);
  });
});
