/**
 * ViewStateAwareness — a framework-free wrapper over a Yjs *Awareness* instance
 * that replicates the viewer's shared view state (view mode, zoom, rotation,
 * current page) across peers.
 *
 * WHY AWARENESS (not the Y.Doc):
 * View state changes on *frequent* user actions — scroll, zoom, rotate, page
 * flips. Writing those into the Y.Doc (a CRDT with permanent, append-only
 * history) makes the document grow without bound and never shrinks, even though
 * only the *latest* value ever matters. Awareness is ephemeral presence state:
 * it is NOT persisted into the doc's history, and a peer's state auto-clears
 * when that peer disconnects. That is exactly the right home for "where is this
 * peer currently looking".
 *
 * Ownership model mirrors AnnotationStore/ViewStateStore: this wrapper NEVER
 * creates its own Awareness/Doc/provider. The host app owns the provider and
 * hands us its `provider.awareness`. To stay unit-testable without y-websocket
 * we depend only on a MINIMAL structural interface (`AwarenessLike`).
 *
 * Surface intentionally matches what ViewSync needs so the coordinator barely
 * changes: getState / setState(partial, origin?) / subscribe(cb) / isEmpty.
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

/** The awareness field under which we publish our view state. */
export const VIEW_FIELD = 'view';

/**
 * Minimal structural interface of a Yjs Awareness instance. Declared here so
 * ViewStateAwareness can be unit-tested against a fake without pulling in
 * y-protocols / y-websocket.
 */
export interface AwarenessLike {
  /** This peer's stable client id (from doc.clientID). */
  clientID: number;
  getLocalState(): Record<string, any> | null;
  setLocalState(state: Record<string, any> | null): void;
  getStates(): Map<number, Record<string, any>>;
  on(event: 'change' | 'update', cb: (...args: any[]) => void): void;
  off(event: 'change' | 'update', cb: (...args: any[]) => void): void;
}

/**
 * The abstract source ViewSync depends on. Both ViewStateAwareness (awareness-
 * backed) and any test stub implement this, so the coordinator does not hard-
 * depend on a concrete backing.
 */
export interface ViewStateSource {
  getState(): ViewState;
  setState(partial: Partial<ViewState>, origin?: unknown): void;
  subscribe(callback: (state: ViewState, origin: unknown) => void): () => void;
  isEmpty(): boolean;
  /**
   * The authoritative REMOTE view to adopt on join, or null if no remote peer
   * currently publishes one. Deterministic across peers (see implementation).
   */
  getRemoteState(): ViewState | null;
}

/** Origin passed to subscribers for remote-originated awareness changes. */
export const REMOTE_ORIGIN = 'awareness-remote';

function coerceViewState(raw: any): ViewState {
  const vm = raw?.viewMode;
  const zoom = raw?.zoom;
  const rotation = raw?.rotation;
  const page = raw?.page;
  return {
    viewMode: vm === 'single' || vm === 'scroll' ? vm : DEFAULT_VIEW_STATE.viewMode,
    zoom: typeof zoom === 'number' ? zoom : DEFAULT_VIEW_STATE.zoom,
    rotation: typeof rotation === 'number' ? rotation : DEFAULT_VIEW_STATE.rotation,
    page: typeof page === 'number' ? page : DEFAULT_VIEW_STATE.page,
  };
}

export class ViewStateAwareness implements ViewStateSource {
  private awareness: AwarenessLike;

  constructor(awareness: AwarenessLike) {
    this.awareness = awareness;
  }

  /**
   * Read the LOCAL published view state (defaulted). This is what *this* peer
   * has broadcast, mirroring ViewStateStore.getState()'s "current shared value"
   * semantics for the local side.
   */
  public getState(): ViewState {
    const local = this.awareness.getLocalState();
    return coerceViewState(local?.[VIEW_FIELD]);
  }

  /**
   * True when NO remote peer currently publishes a view state. Used to decide
   * seed-vs-adopt on join. Our own client id is ignored — only remote presence
   * counts.
   */
  public isEmpty(): boolean {
    return this.pickRemoteView() === null;
  }

  /**
   * The authoritative REMOTE view to adopt on join: the view published by the
   * lowest remote clientID, or null if no remote peer publishes one.
   */
  public getRemoteState(): ViewState | null {
    return this.pickRemoteView();
  }

  /**
   * Merge a partial view state into our local awareness `view` field and
   * publish it. Other local awareness fields (e.g. a cursor) are preserved.
   *
   * `origin` is accepted only for signature-compatibility with ViewStateStore;
   * awareness has no doc history and self-filtering is done purely by clientID
   * in `subscribe`, so origin is intentionally ignored here.
   */
  public setState(partial: Partial<ViewState>, _origin?: unknown): void {
    const local = this.awareness.getLocalState() ?? {};
    const current = coerceViewState(local[VIEW_FIELD]);
    const next: ViewState = { ...current };
    for (const key of Object.keys(partial) as (keyof ViewState)[]) {
      const value = partial[key];
      if (value === undefined) continue;
      (next as any)[key] = value;
    }
    // Preserve any other local awareness fields; only replace `view`.
    this.awareness.setLocalState({ ...local, [VIEW_FIELD]: next });
  }

  /**
   * Subscribe to REMOTE peers' view-state changes. When any remote peer's
   * awareness state changes (added/updated/removed), we recompute the
   * deterministic "authoritative" remote view (lowest clientID that publishes a
   * view) and, if a remote view exists, invoke the callback with it and a
   * non-local origin so ViewSync applies it. Our own clientID changes are
   * ignored (self-filtering).
   */
  public subscribe(
    callback: (state: ViewState, origin: unknown) => void
  ): () => void {
    const handler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      _origin: unknown
    ) => {
      const touched = [
        ...(changes.added ?? []),
        ...(changes.updated ?? []),
        ...(changes.removed ?? []),
      ];
      // Ignore changes that ONLY concern our own client id (our own publish).
      const remoteTouched = touched.some((id) => id !== this.awareness.clientID);
      if (!remoteTouched) return;

      const remote = this.pickRemoteView();
      if (remote === null) return;
      callback(remote, REMOTE_ORIGIN);
    };

    this.awareness.on('change', handler);
    return () => {
      this.awareness.off('change', handler);
    };
  }

  /**
   * Deterministically pick the authoritative remote view: the view published by
   * the lowest remote clientID that has a `view` field. Returns null if no
   * remote peer publishes a view. Excludes our own clientID.
   */
  private pickRemoteView(): ViewState | null {
    const states = this.awareness.getStates();
    let bestId: number | null = null;
    let bestRaw: any = null;
    for (const [id, state] of states) {
      if (id === this.awareness.clientID) continue;
      if (!state || state[VIEW_FIELD] == null) continue;
      if (bestId === null || id < bestId) {
        bestId = id;
        bestRaw = state[VIEW_FIELD];
      }
    }
    return bestId === null ? null : coerceViewState(bestRaw);
  }
}
