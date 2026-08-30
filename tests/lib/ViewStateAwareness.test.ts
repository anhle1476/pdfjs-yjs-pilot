import { describe, expect, it } from 'vitest';
import {
  ViewStateAwareness,
  DEFAULT_VIEW_STATE,
  REMOTE_ORIGIN,
  VIEW_FIELD,
  type AwarenessLike,
} from '../../src/lib/ViewStateAwareness';

/**
 * FakeAwareness — a minimal in-memory implementation of the structural
 * AwarenessLike interface, sufficient to unit-test ViewStateAwareness without
 * y-protocols / y-websocket. It emits 'change'/'update' the way the real
 * Awareness does: (changes, origin).
 *
 * `setLocalState` mutates this peer's own state (keyed by its clientID) and
 * emits a change. `injectRemote` simulates ANOTHER peer's state arriving over
 * the wire (a distinct clientID) and emits a change so subscribers react.
 */
export class FakeAwareness implements AwarenessLike {
  clientID: number;
  states = new Map<number, Record<string, any>>();
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(clientID = 1) {
    this.clientID = clientID;
  }

  getLocalState(): Record<string, any> | null {
    return this.states.get(this.clientID) ?? null;
  }

  setLocalState(state: Record<string, any> | null): void {
    const existed = this.states.has(this.clientID);
    if (state === null) {
      this.states.delete(this.clientID);
      this.emit('change', { added: [], updated: [], removed: [this.clientID] }, 'local');
      this.emit('update', { added: [], updated: [], removed: [this.clientID] }, 'local');
      return;
    }
    this.states.set(this.clientID, state);
    const changes = existed
      ? { added: [], updated: [this.clientID], removed: [] }
      : { added: [this.clientID], updated: [], removed: [] };
    this.emit('change', changes, 'local');
    this.emit('update', changes, 'local');
  }

  getStates(): Map<number, Record<string, any>> {
    return this.states;
  }

  on(event: string, cb: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  /** Simulate a remote peer (distinct clientID) publishing/removing state. */
  injectRemote(clientID: number, state: Record<string, any> | null): void {
    if (clientID === this.clientID) {
      throw new Error('injectRemote must use a clientID distinct from local');
    }
    const existed = this.states.has(clientID);
    if (state === null) {
      this.states.delete(clientID);
      this.emit('change', { added: [], updated: [], removed: [clientID] }, 'remote');
      this.emit('update', { added: [], updated: [], removed: [clientID] }, 'remote');
      return;
    }
    this.states.set(clientID, state);
    const changes = existed
      ? { added: [], updated: [clientID], removed: [] }
      : { added: [clientID], updated: [], removed: [] };
    this.emit('change', changes, 'remote');
    this.emit('update', changes, 'remote');
  }

  private emit(event: string, changes: any, origin: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(changes, origin);
  }
}

describe('ViewStateAwareness', () => {
  it('local publish + read: setState publishes to local awareness and getState reads it back', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);

    expect(src.getState()).toEqual(DEFAULT_VIEW_STATE);

    src.setState({ viewMode: 'single', zoom: 1.5, rotation: 90, page: 3 });
    expect(src.getState()).toEqual({
      viewMode: 'single',
      zoom: 1.5,
      rotation: 90,
      page: 3,
    });

    // The state is stored under the single `view` field.
    expect(aw.getLocalState()?.[VIEW_FIELD]).toEqual({
      viewMode: 'single',
      zoom: 1.5,
      rotation: 90,
      page: 3,
    });
  });

  it('setState merges partials without clobbering other fields', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    src.setState({ viewMode: 'single', zoom: 2, rotation: 180, page: 4 });
    src.setState({ zoom: 3 });
    expect(src.getState()).toEqual({
      viewMode: 'single',
      zoom: 3,
      rotation: 180,
      page: 4,
    });
  });

  it('setState preserves other local awareness fields (e.g. cursor)', () => {
    const aw = new FakeAwareness(1);
    aw.setLocalState({ cursor: { x: 1, y: 2 } });
    const src = new ViewStateAwareness(aw);
    src.setState({ zoom: 2 });
    expect(aw.getLocalState()?.cursor).toEqual({ x: 1, y: 2 });
    expect(aw.getLocalState()?.[VIEW_FIELD].zoom).toBe(2);
  });

  it('remote peer change triggers subscribe with the remote view + a non-local origin', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    const received: Array<{ state: any; origin: unknown }> = [];
    src.subscribe((state, origin) => received.push({ state, origin }));

    aw.injectRemote(2, {
      view: { viewMode: 'single', zoom: 2, rotation: 90, page: 5 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].state).toEqual({
      viewMode: 'single',
      zoom: 2,
      rotation: 90,
      page: 5,
    });
    expect(received[0].origin).toBe(REMOTE_ORIGIN);
    expect(received[0].origin).not.toBe('local');
  });

  it('own (local) change is ignored by subscribe (self-filter by clientID)', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    let calls = 0;
    src.subscribe(() => calls++);

    // Our own publish must NOT trigger the remote callback.
    src.setState({ zoom: 5 });
    expect(calls).toBe(0);
  });

  it('isEmpty reflects REMOTE presence only (local publish does not make it non-empty)', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    expect(src.isEmpty()).toBe(true);

    // A local publish does not count as remote presence.
    src.setState({ zoom: 2 });
    expect(src.isEmpty()).toBe(true);

    // A remote peer publishing a view makes it non-empty.
    aw.injectRemote(2, { view: { zoom: 3 } });
    expect(src.isEmpty()).toBe(false);

    // Remote peer disconnecting (state removed) makes it empty again.
    aw.injectRemote(2, null);
    expect(src.isEmpty()).toBe(true);
  });

  it('adopt-on-join picks the lowest remote clientID that has a view (deterministic)', () => {
    const aw = new FakeAwareness(10);
    const src = new ViewStateAwareness(aw);
    const received: any[] = [];
    src.subscribe((state) => received.push(state));

    // Peers 5 and 3 both publish; the lowest clientID (3) is authoritative.
    aw.injectRemote(5, { view: { viewMode: 'single', zoom: 5, rotation: 0, page: 5 } });
    aw.injectRemote(3, { view: { viewMode: 'scroll', zoom: 3, rotation: 90, page: 3 } });

    // The last callback reflects the deterministic pick (clientID 3).
    expect(received[received.length - 1]).toEqual({
      viewMode: 'scroll',
      zoom: 3,
      rotation: 90,
      page: 3,
    });

    // Peers without a `view` field are skipped.
    aw.injectRemote(2, { cursor: { x: 0, y: 0 } });
    // clientID 2 has no view → authoritative pick stays clientID 3.
    // (getState still deterministic on re-read.)
    const finalPick = received[received.length - 1];
    expect(finalPick).toEqual({
      viewMode: 'scroll',
      zoom: 3,
      rotation: 90,
      page: 3,
    });
  });

  it('a peer publishing a non-view field only does not trigger a view apply', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    let calls = 0;
    src.subscribe(() => calls++);

    aw.injectRemote(2, { cursor: { x: 1, y: 1 } });
    expect(calls).toBe(0);
  });

  it('unsubscribe stops further callbacks', () => {
    const aw = new FakeAwareness(1);
    const src = new ViewStateAwareness(aw);
    let calls = 0;
    const unsub = src.subscribe(() => calls++);

    aw.injectRemote(2, { view: { zoom: 2 } });
    expect(calls).toBe(1);

    unsub();
    aw.injectRemote(2, { view: { zoom: 3 } });
    expect(calls).toBe(1);
  });
});
