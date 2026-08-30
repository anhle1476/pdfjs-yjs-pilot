import * as Y from 'yjs';

/**
 * ViewStateStore — a thin layer over an externally-owned Y.Map that replicates
 * the viewer's shared view state (view mode, zoom, rotation, current page)
 * across peers.
 *
 * Mirrors AnnotationStore's ownership model: the store NEVER creates its own
 * Y.Doc and NEVER touches any network provider. The host app owns the Y.Doc /
 * provider and hands the shared Y.Map to this store. Mutations are wrapped in a
 * transaction on the owning doc so remote peers receive a single atomic update.
 *
 * The transaction `origin` is threaded through so the host can distinguish its
 * own writes from remote ones — this is the primary loop-prevention hook used
 * by the ViewSync coordinator.
 */

export type ViewModeState = 'scroll' | 'single';

export interface ViewState {
  viewMode: ViewModeState;
  zoom: number;
  rotation: number;
  page: number;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  viewMode: 'scroll',
  zoom: 1,
  rotation: 0,
  page: 1,
};

export class ViewStateStore {
  private yViewState: Y.Map<any>;

  constructor(yViewState: Y.Map<any>) {
    this.yViewState = yViewState;
  }

  /**
   * Read the current shared view state, falling back to defaults for any key
   * that has not been written yet.
   */
  public getState(): ViewState {
    const vm = this.yViewState.get('viewMode');
    const zoom = this.yViewState.get('zoom');
    const rotation = this.yViewState.get('rotation');
    const page = this.yViewState.get('page');
    return {
      viewMode: vm === 'single' || vm === 'scroll' ? vm : DEFAULT_VIEW_STATE.viewMode,
      zoom: typeof zoom === 'number' ? zoom : DEFAULT_VIEW_STATE.zoom,
      rotation: typeof rotation === 'number' ? rotation : DEFAULT_VIEW_STATE.rotation,
      page: typeof page === 'number' ? page : DEFAULT_VIEW_STATE.page,
    };
  }

  /**
   * True when nothing has been written to the shared map yet (used to decide
   * seed-vs-adopt on join).
   */
  public isEmpty(): boolean {
    return this.yViewState.size === 0;
  }

  private transact(fn: () => void, origin?: unknown): void {
    const doc = this.yViewState.doc;
    if (doc) {
      doc.transact(fn, origin);
    } else {
      fn();
    }
  }

  /**
   * Write a partial view state. Only keys whose value actually changed are
   * written, keeping the update idempotent and avoiding float oscillation.
   * The optional `origin` is passed through to `doc.transact` so observers can
   * ignore their own writes.
   */
  public setState(partial: Partial<ViewState>, origin?: unknown): void {
    this.transact(() => {
      for (const key of Object.keys(partial) as (keyof ViewState)[]) {
        const value = partial[key];
        if (value === undefined) continue;
        const existing = this.yViewState.get(key as string);
        if (existing !== value) {
          this.yViewState.set(key as string, value as any);
        }
      }
    }, origin);
  }

  /**
   * Subscribe to shared view-state changes. The callback receives the full
   * (defaulted) state plus the originating transaction's `origin`, which the
   * host uses to skip echoing its own writes.
   */
  public subscribe(
    callback: (state: ViewState, origin: unknown) => void
  ): () => void {
    const handler = (event: Y.YMapEvent<any>) => {
      callback(this.getState(), event.transaction.origin);
    };
    this.yViewState.observe(handler);
    return () => {
      this.yViewState.unobserve(handler);
    };
  }

  /**
   * Expose the raw Y.Map for advanced host-side use.
   */
  public getYMap(): Y.Map<any> {
    return this.yViewState;
  }
}
