import { describe, expect, it, vi } from 'vitest';
import { ViewStateAwareness } from '../../src/lib/ViewStateAwareness';
import { ViewSync, type ViewSyncApp } from '../../src/demo/viewSync';
import { FakeAwareness } from './ViewStateAwareness.test';

const LOCAL = 'local-origin';

/**
 * A synchronous stub of the DemoApp surface ViewSync needs. Records how many
 * times each absolute setter was called so tests can assert loop-safety.
 */
class StubApp implements ViewSyncApp {
  viewMode: 'scroll' | 'single' = 'scroll';
  zoom = 1;
  rotation = 0;
  page = 1;

  calls = { setViewMode: 0, setZoom: 0, setRotation: 0, goToPage: 0 };

  getViewMode() {
    return this.viewMode;
  }
  getZoom() {
    return this.zoom;
  }
  getRotation() {
    return this.rotation;
  }
  getCurrentPage() {
    return this.page;
  }
  async setViewMode(mode: 'scroll' | 'single') {
    this.calls.setViewMode++;
    this.viewMode = mode;
  }
  setZoom(scale: number) {
    this.calls.setZoom++;
    this.zoom = scale;
  }
  setRotation(deg: number) {
    this.calls.setRotation++;
    this.rotation = deg;
  }
  goToPage(n: number) {
    this.calls.goToPage++;
    this.page = n;
  }
}

// The backing source for ViewSync is now a ViewStateAwareness over a fake
// Awareness. `aw` is exposed so tests can simulate a REMOTE peer publishing a
// view (injectRemote) exactly like a real peer would.
function makeStore(localClientId = 1) {
  const aw = new FakeAwareness(localClientId);
  const store = new ViewStateAwareness(aw);
  return { store, aw };
}

describe('ViewSync', () => {
  it('applying a remote update calls each changed setter exactly once', async () => {
    const app = new StubApp();
    const { store } = makeStore();
    const sync = new ViewSync(app, store, LOCAL);

    await sync.applyRemote({
      viewMode: 'single',
      zoom: 2,
      rotation: 90,
      page: 3,
    });

    expect(app.calls).toEqual({
      setViewMode: 1,
      setZoom: 1,
      setRotation: 1,
      goToPage: 1,
    });
    expect(app.viewMode).toBe('single');
    expect(app.zoom).toBe(2);
    expect(app.rotation).toBe(90);
    expect(app.page).toBe(3);
  });

  it('skips setters for fields that already match', async () => {
    const app = new StubApp();
    app.viewMode = 'single';
    app.rotation = 90;
    const { store } = makeStore();
    const sync = new ViewSync(app, store, LOCAL);

    await sync.applyRemote({
      viewMode: 'single', // unchanged
      zoom: 2, // changed
      rotation: 90, // unchanged
      page: 1, // unchanged
    });

    expect(app.calls).toEqual({
      setViewMode: 0,
      setZoom: 1,
      setRotation: 0,
      goToPage: 0,
    });
  });

  it('treats a sub-epsilon zoom difference as a no-op', async () => {
    const app = new StubApp();
    app.zoom = 1.0;
    const { store } = makeStore();
    const sync = new ViewSync(app, store, LOCAL);

    await sync.applyRemote({
      viewMode: 'scroll',
      zoom: 1.0 + 1e-6, // below ZOOM_EPSILON
      rotation: 0,
      page: 1,
    });

    expect(app.calls.setZoom).toBe(0);
  });

  it('local change handlers do not write while a remote apply is in flight', async () => {
    const app = new StubApp();
    const { store } = makeStore();
    const setSpy = vi.spyOn(store, 'setState');
    // setViewMode is async; during its await isApplyingRemote must stay true.
    let sawGuardDuringApply = false;
    app.setViewMode = async (mode) => {
      app.calls.setViewMode++;
      app.viewMode = mode;
      // Simulate a local callback firing mid-apply (as notify* would).
      sync.handleLocalZoomChange(9);
      sawGuardDuringApply = sync.getIsApplyingRemote();
    };

    const sync = new ViewSync(app, store, LOCAL);
    setSpy.mockClear();

    await sync.applyRemote({
      viewMode: 'single',
      zoom: 2,
      rotation: 0,
      page: 1,
    });

    expect(sawGuardDuringApply).toBe(true);
    // No setState call from the re-entrant local zoom handler (must early-return
    // while a remote apply is in flight). applyRemote itself never writes.
    const zoomWrites = setSpy.mock.calls.filter(
      (c) => (c[0] as any)?.zoom === 9
    );
    expect(zoomWrites).toHaveLength(0);
  });

  it('write-path handlers publish to local awareness (own writes do not echo back)', () => {
    const app = new StubApp();
    const { store } = makeStore();
    // Subscribe should NEVER fire for our own local writes (self-filter by
    // clientID) — that is the awareness-model "no echo" guarantee.
    const remoteApplies: unknown[] = [];
    store.subscribe((state) => remoteApplies.push(state));
    const sync = new ViewSync(app, store, LOCAL);

    sync.handleLocalZoomChange(2);
    sync.handleLocalPageChange(4);

    // Local publish is reflected in our own published (local) state...
    expect(store.getState().zoom).toBe(2);
    expect(store.getState().page).toBe(4);
    // ...but never echoed to the remote-apply subscriber.
    expect(remoteApplies).toHaveLength(0);
  });

  it('start() applies remote peer changes but never echoes our own writes (no echo)', () => {
    const app = new StubApp();
    const { store, aw } = makeStore(1);
    const sync = new ViewSync(app, store, LOCAL);
    sync.start();

    // A local write must not drive any absolute setter.
    sync.handleLocalZoomChange(5);
    expect(app.calls.setZoom).toBe(0);

    // A remote peer publishing a distinct value must be applied.
    aw.injectRemote(2, { view: { viewMode: 'scroll', zoom: 6, rotation: 0, page: 1 } });
    expect(app.calls.setZoom).toBe(1);
    expect(app.zoom).toBe(6);

    sync.stop();
  });

  it('syncInitial seeds the local published state when no remote peer exists', () => {
    const app = new StubApp();
    app.viewMode = 'single';
    app.zoom = 1.5;
    app.rotation = 180;
    app.page = 2;
    const { store } = makeStore();
    const sync = new ViewSync(app, store, LOCAL);

    sync.syncInitial();

    expect(store.getState()).toEqual({
      viewMode: 'single',
      zoom: 1.5,
      rotation: 180,
      page: 2,
    });
    // Seeding is a publish, not an apply.
    expect(app.calls.setZoom).toBe(0);
  });

  it('syncInitial adopts an existing remote peer view when one is present', async () => {
    const app = new StubApp();
    const { store, aw } = makeStore(10);
    // A remote peer is already publishing a view before we join.
    aw.injectRemote(2, {
      view: { viewMode: 'single', zoom: 2, rotation: 90, page: 3 },
    });
    const sync = new ViewSync(app, store, LOCAL);

    sync.syncInitial();
    // applyRemote is async; allow the microtask to settle.
    await Promise.resolve();

    expect(app.viewMode).toBe('single');
    expect(app.zoom).toBe(2);
    expect(app.rotation).toBe(90);
    expect(app.page).toBe(3);
  });

  it('defers applying while shouldDeferApply is true', async () => {
    const app = new StubApp();
    const { store } = makeStore();
    let editing = true;
    const sync = new ViewSync(app, store, LOCAL, {
      shouldDeferApply: () => editing,
    });

    await sync.applyRemote({
      viewMode: 'single',
      zoom: 2,
      rotation: 0,
      page: 1,
    });
    // Deferred: nothing applied yet.
    expect(app.calls.setViewMode).toBe(0);

    // Once editing ends, a subsequent apply lands.
    editing = false;
    await sync.applyRemote({
      viewMode: 'single',
      zoom: 2,
      rotation: 0,
      page: 1,
    });
    expect(app.calls.setViewMode).toBe(1);
  });

  it('suppresses a delayed local page callback within the post-apply settle window', async () => {
    // Reproduces the scroll-driven write-back race: applyRemote(goToPage)
    // scrolls the container, whose debounced scroll listener later emits a
    // local page-change AFTER isApplyingRemote has cleared. That delayed
    // callback must NOT publish back to the shared view.
    const app = new StubApp();
    const { store } = makeStore();
    const setSpy = vi.spyOn(store, 'setState');

    // Controllable fake timer so we can decide when the settle window closes.
    let settleCb: (() => void) | null = null;
    const sync = new ViewSync(app, store, LOCAL, {
      settleMs: 250,
      setTimeoutFn: (cb) => {
        settleCb = cb;
        return 1;
      },
      clearTimeoutFn: () => {
        settleCb = null;
      },
    });

    await sync.applyRemote({
      viewMode: 'scroll',
      zoom: 1,
      rotation: 0,
      page: 3,
    });
    setSpy.mockClear();

    // Simulate the debounced scroll listener firing a (slightly-off) page
    // change while the settle window is still open.
    sync.handleLocalPageChange(4);
    expect(setSpy).not.toHaveBeenCalled();

    // Close the settle window; a genuine subsequent local change writes again.
    settleCb?.();
    sync.handleLocalPageChange(5);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][0]).toEqual({ page: 5 });
  });

  it('settleMs=0 disables the post-apply window (local write allowed immediately)', async () => {
    const app = new StubApp();
    const { store } = makeStore();
    const setSpy = vi.spyOn(store, 'setState');
    const sync = new ViewSync(app, store, LOCAL, { settleMs: 0 });

    await sync.applyRemote({
      viewMode: 'scroll',
      zoom: 1,
      rotation: 0,
      page: 2,
    });
    setSpy.mockClear();

    sync.handleLocalPageChange(3);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });
});
