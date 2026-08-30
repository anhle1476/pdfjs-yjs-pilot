import { describe, expect, it, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { AnnotationStore } from '../../../src/lib/AnnotationStore';
import { FreeTextTool } from '../../../src/lib/tools/FreeTextTool';
import { FreeTextObject } from '../../../src/lib/models/FreeTextObject';

function makeTool() {
  const doc = new Y.Doc();
  const store = new AnnotationStore(doc.getArray('annotations'));
  const tool = new FreeTextTool(store, { defaultFontSize: 12, defaultColor: '#000' });
  const pageContainer = document.createElement('div');
  pageContainer.className = 'page-view';
  document.body.appendChild(pageContainer);
  return { doc, store, tool, pageContainer };
}

describe('FreeTextTool', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('createAt adds a FreeTextObject to the store and an editor to the DOM', () => {
    const { store, tool, pageContainer } = makeTool();
    tool.activate(pageContainer, 1);

    const id = tool.createAt(0.25, 0.4);
    expect(id).toBeTruthy();

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toBeInstanceOf(FreeTextObject);
    expect(all[0].id).toBe(id);
    expect((all[0] as FreeTextObject).bounds.x).toBeCloseTo(0.25);
    expect((all[0] as FreeTextObject).bounds.y).toBeCloseTo(0.4);

    const editor = pageContainer.querySelector(`[data-editor-id="${id}"]`);
    expect(editor).not.toBeNull();
    expect(tool.getActiveEditorId()).toBe(id);
  });

  it('empty editor is removed on commit (deactivate)', () => {
    const { store, tool, pageContainer } = makeTool();
    tool.activate(pageContainer, 1);
    tool.createAt(0.1, 0.1);
    // Editor content is empty → deactivate commits & removes it.
    tool.deactivate();
    expect(store.getAll()).toHaveLength(0);
  });

  it('rebuilds editors for the current page from existing store objects', () => {
    const { store, tool, pageContainer } = makeTool();

    const obj = new FreeTextObject('ft-existing', 'hello world', 12, '#000', {
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.05,
    });
    obj.pageNumber = 1;
    store.add(obj);

    tool.activate(pageContainer, 1);
    const editor = pageContainer.querySelector('[data-editor-id="ft-existing"]');
    expect(editor).not.toBeNull();
    expect(editor!.querySelector('.editor-content')!.textContent).toBe('hello world');
  });

  it('does not rebuild editors for a different page', () => {
    const { store, tool, pageContainer } = makeTool();
    const obj = new FreeTextObject('ft-p2', 'page two', 12, '#000', {
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.05,
    });
    obj.pageNumber = 2;
    store.add(obj);

    tool.activate(pageContainer, 1);
    expect(pageContainer.querySelector('[data-editor-id="ft-p2"]')).toBeNull();
  });
});
