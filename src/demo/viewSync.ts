// ViewSync — the demo-app coordinator that replicates view state across peers.
//
// It bridges two directions:
//   - Local -> shared: the DemoApp fires on{Page,Zoom,ViewMode,Rotation}Change
//     callbacks; ViewSync writes the changed field into the shared Y.Map
//     (tagged with LOCAL_ORIGIN).
//   - Shared -> local: ViewStateStore.subscribe fires on remote updates;
//     ViewSync applies only the differing fields via the DemoApp's *absolute*
//     setters (setViewMode / setRotation / setZoom / goToPage).
//
// Three complementary loop guards keep this from ping-ponging:
//   1. isApplyingRemote flag — write-path handlers early-return while a remote
//      apply is in flight (held across setViewMode's await, cleared in finally).
//   2. Origin tagging — writes use LOCAL_ORIGIN; the observer skips events whose
//      transaction origin is LOCAL_ORIGIN (Yjs fires observers synchronously on
//      the local commit too, so this backstops the flag).
//   3. Value diffing — a key is written only if changed, and a field is applied
//      only if it differs from the current local value (zoom compared with an
//      epsilon) so float noise cannot oscillate.

import type { ViewState, ViewStateStore, ViewModeState } from '../lib';

/**
 * Minimal surface of DemoApp that ViewSync needs. Declared structurally so the
 * coordinator can be unit-tested against a stub.
 */
export interface ViewSyncApp {
  getViewMode(): ViewModeState;
  getZoom(): number;
  getRotation(): number;
  getCurrentPage(): number;
  setViewMode(mode: ViewModeState): Promise<void>;
  setZoom(scale: number): void;
  setRotation(degrees: number): void;
  goToPage(pageNumber: number): void;
}

export const ZOOM_EPSILON = 1e-4;

// How long (ms) to keep suppressing local write-path callbacks after a remote
// apply finishes. Applying a remote page (goToPage) sets container.scrollTop,
// which fires the NavigationController's scroll listener; that listener is
// debounced (~100ms) and then emits a page-change callback AFTER
// isApplyingRemote has already been cleared. Without a settle window that
// delayed, scroll-derived page change would be written back to the shared map
// as a *local* edit — and because the scroll heuristic (middle-of-viewport)
// can resolve to a neighbouring page, two peers could ping-pong the page. The
// window must comfortably exceed the scroll debounce.
export const APPLY_SETTLE_MS = 250;

export interface ViewSyncOptions {
  /** Called after a remote apply so the host can refresh its UI info panels. */
  onAfterApply?: () => void;
  /** Predicate: return true to defer applying a remote update (e.g. mid-typing). */
  shouldDeferApply?: () => boolean;
  /**
   * Post-apply suppression window in ms. Local write-path callbacks that fire
   * within this window after a remote apply are ignored (see APPLY_SETTLE_MS).
   * Set to 0 to disable (primarily for unit tests). Defaults to
   * APPLY_SETTLE_MS.
   */
  settleMs?: number;
  /** Injectable timer (for tests). Defaults to setTimeout/clearTimeout. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class ViewSync {
  private app: ViewSyncApp;
  private store: ViewStateStore;
  private readonly localOrigin: unknown;
  private options: ViewSyncOptions;

  private isApplyingRemote = false;
  private unsubscribe: (() => void) | null = null;
  private pendingRemote: ViewState | null = null;

  // Post-apply settle window: while active, local write-path callbacks are
  // suppressed so a delayed (debounced) scroll-driven page change produced by
  // our own goToPage does not get written back as a local edit.
  private readonly settleMs: number;
  private settleHandle: unknown = null;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  constructor(
    app: ViewSyncApp,
    store: ViewStateStore,
    localOrigin: unknown,
    options: ViewSyncOptions = {}
  ) {
    this.app = app;
    this.store = store;
    this.localOrigin = localOrigin;
    this.options = options;
    this.settleMs = options.settleMs ?? APPLY_SETTLE_MS;
    this.setTimeoutFn =
      options.setTimeoutFn ??
      ((cb, ms) =>
        (typeof setTimeout !== 'undefined'
          ? setTimeout(cb, ms)
          : (cb(), null)));
    this.clearTimeoutFn =
      options.clearTimeoutFn ??
      ((h) => {
        if (typeof clearTimeout !== 'undefined' && h != null) {
          clearTimeout(h as ReturnType<typeof setTimeout>);
        }
      });
  }

  /** Begin relaying: subscribe to the shared map for remote updates. */
  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.store.subscribe((state, origin) => {
      if (origin === this.localOrigin) return;
      void this.applyRemote(state);
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.settleHandle !== null) {
      this.clearTimeoutFn(this.settleHandle);
      this.settleHandle = null;
    }
  }

  // ----- Local -> shared (write path) -----

  /**
   * True while a local view-state change must NOT be written to the shared
   * map: either a remote apply is actively running, or we are within the
   * post-apply settle window (see APPLY_SETTLE_MS) during which our own
   * goToPage-triggered debounced scroll callback may still fire.
   */
  private isSuppressed(): boolean {
    return this.isApplyingRemote || this.settleHandle !== null;
  }

  public handleLocalPageChange(page: number): void {
    if (this.isSuppressed()) return;
    this.store.setState({ page }, this.localOrigin);
  }

  public handleLocalZoomChange(zoom: number): void {
    if (this.isSuppressed()) return;
    this.store.setState({ zoom }, this.localOrigin);
  }

  public handleLocalViewModeChange(viewMode: ViewModeState): void {
    if (this.isSuppressed()) return;
    this.store.setState({ viewMode }, this.localOrigin);
  }

  public handleLocalRotationChange(rotation: number): void {
    if (this.isSuppressed()) return;
    this.store.setState({ rotation }, this.localOrigin);
  }

  // ----- Shared -> local (apply path) -----

  /**
   * Adopt the current shared state on join. If the shared map is empty, the
   * first peer seeds it from the app's current local state instead.
   */
  public syncInitial(): void {
    if (this.store.isEmpty()) {
      this.store.setState(
        {
          viewMode: this.app.getViewMode(),
          zoom: this.app.getZoom(),
          rotation: this.app.getRotation(),
          page: this.app.getCurrentPage(),
        },
        this.localOrigin
      );
      return;
    }
    void this.applyRemote(this.store.getState());
  }

  /**
   * Apply a remote view state to the local app, touching only differing
   * fields. Order matters: viewMode first (rebuilds page DOM), then
   * rotation/zoom (rebuild page canvases), then page last (scroll/goto into the
   * freshly-built DOM).
   */
  public async applyRemote(state: ViewState): Promise<void> {
    // If a previous apply is still running, remember the latest desired state
    // and let the in-flight apply pick it up when it finishes.
    if (this.isApplyingRemote) {
      this.pendingRemote = state;
      return;
    }

    if (this.options.shouldDeferApply?.()) {
      this.pendingRemote = state;
      return;
    }

    this.isApplyingRemote = true;
    try {
      if (state.viewMode !== this.app.getViewMode()) {
        await this.app.setViewMode(state.viewMode);
      }
      if (state.rotation !== this.app.getRotation()) {
        this.app.setRotation(state.rotation);
      }
      if (Math.abs(state.zoom - this.app.getZoom()) >= ZOOM_EPSILON) {
        this.app.setZoom(state.zoom);
      }
      if (state.page !== this.app.getCurrentPage()) {
        this.app.goToPage(state.page);
      }
    } finally {
      this.isApplyingRemote = false;
      this.options.onAfterApply?.();
    }

    // Coalesce any state that arrived while we were applying.
    if (this.pendingRemote) {
      const next = this.pendingRemote;
      this.pendingRemote = null;
      await this.applyRemote(next);
      return;
    }

    // The apply (including any coalesced re-applies) is fully done. Open a
    // short settle window so the debounced scroll callback that goToPage just
    // scheduled is treated as remote-induced, not a fresh local edit.
    this.armSettleWindow();
  }

  private armSettleWindow(): void {
    if (this.settleMs <= 0) return;
    if (this.settleHandle !== null) {
      this.clearTimeoutFn(this.settleHandle);
    }
    this.settleHandle = this.setTimeoutFn(() => {
      this.settleHandle = null;
    }, this.settleMs);
  }

  /** Test/debug helper. */
  public getIsApplyingRemote(): boolean {
    return this.isApplyingRemote;
  }
}
