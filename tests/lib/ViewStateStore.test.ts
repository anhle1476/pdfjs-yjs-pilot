import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ViewStateStore, DEFAULT_VIEW_STATE } from '../../src/lib/ViewStateStore';
import { createMockSyncRoom } from '../helpers/mockYWebsocket';

function makeStore() {
  const doc = new Y.Doc();
  return new ViewStateStore(doc.getMap<any>('viewState'));
}

describe('ViewStateStore', () => {
  it('returns defaults when the map is empty', () => {
    const store = makeStore();
    expect(store.getState()).toEqual(DEFAULT_VIEW_STATE);
    expect(store.isEmpty()).toBe(true);
  });

  it('persists each field via setState', () => {
    const store = makeStore();
    store.setState({ viewMode: 'single', zoom: 1.5, rotation: 90, page: 3 });
    expect(store.getState()).toEqual({
      viewMode: 'single',
      zoom: 1.5,
      rotation: 90,
      page: 3,
    });
    expect(store.isEmpty()).toBe(false);
  });

  it('partial update does not clobber other keys', () => {
    const store = makeStore();
    store.setState({ viewMode: 'single', zoom: 2, rotation: 180, page: 4 });
    store.setState({ zoom: 3 });
    expect(store.getState()).toEqual({
      viewMode: 'single',
      zoom: 3,
      rotation: 180,
      page: 4,
    });
  });

  it('is idempotent: re-writing the same value produces no new change events', () => {
    const store = makeStore();
    let events = 0;
    store.subscribe(() => {
      events++;
    });
    store.setState({ zoom: 2 });
    expect(events).toBe(1);
    // Same value → no write → no event.
    store.setState({ zoom: 2 });
    expect(events).toBe(1);
    // Different value → one event.
    store.setState({ zoom: 2.5 });
    expect(events).toBe(2);
  });

  it('subscriber receives the transaction origin', () => {
    const store = makeStore();
    const origins: unknown[] = [];
    store.subscribe((_state, origin) => {
      origins.push(origin);
    });
    store.setState({ zoom: 2 }, 'local-A');
    store.setState({ zoom: 3 }, 'remote-B');
    expect(origins).toEqual(['local-A', 'remote-B']);
  });

  it('subscribe returns an unsubscribe that stops further callbacks', () => {
    const store = makeStore();
    let count = 0;
    const unsub = store.subscribe(() => {
      count++;
    });
    store.setState({ page: 2 });
    expect(count).toBe(1);
    unsub();
    store.setState({ page: 3 });
    expect(count).toBe(1);
  });

  it('converges across two peers (A sets zoom → B observes zoom)', () => {
    const room = createMockSyncRoom();
    const a = room.createClient();
    const b = room.createClient();

    const storeA = new ViewStateStore(a.doc.getMap<any>('viewState'));
    const storeB = new ViewStateStore(b.doc.getMap<any>('viewState'));

    storeA.setState({ zoom: 2, viewMode: 'single', rotation: 90, page: 5 });
    expect(storeB.getState()).toEqual({
      viewMode: 'single',
      zoom: 2,
      rotation: 90,
      page: 5,
    });

    // Reverse direction.
    storeB.setState({ page: 7 });
    expect(storeA.getState().page).toBe(7);

    room.destroy();
  });

  it('late-joining peer adopts existing shared view state', () => {
    const room = createMockSyncRoom();
    const a = room.createClient();
    const storeA = new ViewStateStore(a.doc.getMap<any>('viewState'));
    storeA.setState({ viewMode: 'single', zoom: 1.25, rotation: 270, page: 2 });

    const b = room.createClient();
    const storeB = new ViewStateStore(b.doc.getMap<any>('viewState'));
    expect(storeB.getState()).toEqual({
      viewMode: 'single',
      zoom: 1.25,
      rotation: 270,
      page: 2,
    });

    room.destroy();
  });
});
