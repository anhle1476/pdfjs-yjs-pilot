import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AnnotationStore } from '../../src/lib/AnnotationStore';
import { InkObject } from '../../src/lib/models/InkObject';
import { HighlightObject } from '../../src/lib/models/HighlightObject';
import { FreeTextObject } from '../../src/lib/models/FreeTextObject';
import { createMockSyncRoom } from '../helpers/mockYWebsocket';

function makeInk(id: string, page = 1): InkObject {
  const ink = new InkObject(
    id,
    [{ points: [0.1, 0.1, 0.2, 0.2], line: [NaN, NaN, NaN, NaN, 0.1, 0.1, 0.2, 0.2] }],
    '#123456',
    3
  );
  ink.pageNumber = page;
  return ink;
}

describe('AnnotationStore', () => {
  it('adds and reads back annotations as model instances', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    store.add(makeInk('ink-1'));
    const all = store.getAll();

    expect(all).toHaveLength(1);
    expect(all[0]).toBeInstanceOf(InkObject);
    expect(all[0].id).toBe('ink-1');
    expect(all[0].color).toBe('#123456');
  });

  it('deserializes each annotation type to the correct model', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    store.add(makeInk('ink-1'));

    const hl = new HighlightObject('hl-1', [], '#ff0', 0.4, {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.05,
    });
    hl.pageNumber = 1;
    store.add(hl);

    const ft = new FreeTextObject('ft-1', 'hello', 12, '#000', {
      x: 0.3,
      y: 0.3,
      width: 0.2,
      height: 0.05,
    });
    ft.pageNumber = 2;
    store.add(ft);

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all.find((o) => o.id === 'ink-1')).toBeInstanceOf(InkObject);
    expect(all.find((o) => o.id === 'hl-1')).toBeInstanceOf(HighlightObject);
    expect(all.find((o) => o.id === 'ft-1')).toBeInstanceOf(FreeTextObject);
  });

  it('filters annotations by page with getForPage', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    store.add(makeInk('a', 1));
    store.add(makeInk('b', 2));
    store.add(makeInk('c', 2));

    expect(store.getForPage(1).map((o) => o.id)).toEqual(['a']);
    expect(store.getForPage(2).map((o) => o.id).sort()).toEqual(['b', 'c']);
    expect(store.getForPage(3)).toHaveLength(0);
  });

  it('updates an existing annotation by id', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    store.add(makeInk('ink-1'));

    const updated = makeInk('ink-1');
    updated.color = '#abcdef';
    store.update('ink-1', updated);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('#abcdef');
  });

  it('removes an annotation by id', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    store.add(makeInk('ink-1'));
    store.add(makeInk('ink-2'));
    store.remove('ink-1');

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('ink-2');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const doc = new Y.Doc();
    const store = new AnnotationStore(doc.getArray('annotations'));

    let count = 0;
    const unsub = store.subscribe(() => {
      count++;
    });

    store.add(makeInk('ink-1'));
    expect(count).toBe(1);

    store.add(makeInk('ink-2'));
    expect(count).toBe(2);

    unsub();
    store.add(makeInk('ink-3'));
    expect(count).toBe(2);
  });

  it('syncs annotations across two docs (multi-peer)', () => {
    const room = createMockSyncRoom();
    const a = room.createClient();
    const b = room.createClient();

    const storeA = new AnnotationStore(a.annotationsArray);
    const storeB = new AnnotationStore(b.annotationsArray);

    // Add on A → visible on B.
    storeA.add(makeInk('ink-1', 1));
    expect(storeB.getAll().map((o) => o.id)).toEqual(['ink-1']);

    // Add on B → visible on A.
    storeB.add(makeInk('ink-2', 2));
    expect(storeA.getAll().map((o) => o.id).sort()).toEqual(['ink-1', 'ink-2']);

    // Remove on A → removed on B.
    storeA.remove('ink-1');
    expect(storeB.getAll().map((o) => o.id)).toEqual(['ink-2']);

    room.destroy();
  });

  it('late-joining peer receives existing state', () => {
    const room = createMockSyncRoom();
    const a = room.createClient();
    const storeA = new AnnotationStore(a.annotationsArray);

    storeA.add(makeInk('ink-1'));
    storeA.add(makeInk('ink-2'));

    // B joins after A already has state.
    const b = room.createClient();
    const storeB = new AnnotationStore(b.annotationsArray);

    expect(storeB.getAll().map((o) => o.id).sort()).toEqual(['ink-1', 'ink-2']);

    room.destroy();
  });
});
