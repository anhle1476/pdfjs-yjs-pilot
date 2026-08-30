import { DemoApp, type DemoTool } from './DemoApp';
import './style.css';
import {
  createSidebar,
  setActiveTool,
  updatePageInfo,
  updateZoomInfo,
  updateViewModeInfo,
} from './ui';
import { createSearchUi, updateSearchUi } from './searchUI';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { provider, awareness, clientId } from './sync';
import { ViewStateAwareness } from '../lib';
import { ViewSync } from './viewSync';

async function main(): Promise<void> {
  const viewerContainer = document.getElementById('viewer-container');
  if (!viewerContainer) {
    throw new Error('Viewer container not found');
  }

  // Shared view-state coordinator (view mode, zoom, rotation, page). Backed by
  // the provider's Yjs *Awareness* (ephemeral presence) — NOT the Y.Doc — so
  // frequent scroll/zoom/rotate actions never grow the CRDT history.
  const viewStateSource = new ViewStateAwareness(awareness);
  // Forward-declared so the DemoApp change callbacks can reach it; assigned
  // right after the app is constructed.
  let viewSync: ViewSync;

  // Defer applying remote view changes while the local user is actively typing
  // in a freetext editor, so a remote rebuild doesn't tear down the editor DOM
  // mid-keystroke. The deferred state is re-applied on the editor's blur.
  const isEditingFreeText = (): boolean =>
    document.querySelector('.freetext-editor.editing') !== null;

  // The demo app owns the renderer, store, tools and all input wiring.
  const app = new DemoApp(viewerContainer, {
    onPageChange: () => {
      updatePageInfo();
      viewSync?.handleLocalPageChange(app.getCurrentPage());
    },
    onZoomChange: () => {
      updateZoomInfo();
      viewSync?.handleLocalZoomChange(app.getZoom());
    },
    onViewModeChange: () => {
      updateViewModeInfo();
      viewSync?.handleLocalViewModeChange(app.getViewMode());
    },
    onRotationChange: () => {
      viewSync?.handleLocalRotationChange(app.getRotation());
    },
  });

  viewSync = new ViewSync(app, viewStateSource, clientId, {
    onAfterApply: () => {
      updatePageInfo();
      updateZoomInfo();
      updateViewModeInfo();
    },
    shouldDeferApply: isEditingFreeText,
  });

  let currentActiveTool: string | null = null;

  // Maps a sidebar tool id to a DemoApp tool. 'draw' drives the ink tool.
  const toggleTool = (uiId: string, tool: DemoTool) => {
    if (currentActiveTool === uiId) {
      app.setTool(null);
      setActiveTool(null);
      currentActiveTool = null;
    } else {
      app.setTool(tool);
      setActiveTool(uiId);
      currentActiveTool = uiId;
    }
  };

  createSidebar({
    onDraw: () => toggleTool('draw', 'ink'),
    onText: () => toggleTool('freetext', 'freetext'),
    onHighlight: () => toggleTool('highlight', 'highlight'),
    onSelect: () => toggleTool('select', 'select'),
    onDelete: () => {
      app.deleteSelected();
    },
    onHighlightModeChange: (mode) => {
      app.setHighlightMode(mode);
      // Selecting a highlight mode implies activating the highlight tool.
      if (currentActiveTool !== 'highlight') {
        app.setTool('highlight');
        setActiveTool('highlight');
        currentActiveTool = 'highlight';
      }
    },
    onClear: () => {
      app.clearAnnotations();
    },
    onPrevPage: () => app.previousPage(),
    onNextPage: () => app.nextPage(),
    onZoomIn: () => app.zoomIn(),
    onZoomOut: () => app.zoomOut(),
    onFitPage: () => app.fitToPage(),
    onRotateCW: () => app.rotateClockwise(),
    onViewModeChange: async (mode) => {
      await app.setViewMode(mode);
      updateViewModeInfo();
    },
    getPageInfo: () => ({
      current: app.getCurrentPage(),
      total: app.getTotalPages(),
    }),
    getZoomPercent: () => app.getZoomPercent(),
    getViewMode: () => app.getViewMode(),
    getHighlightMode: () => app.getHighlightMode(),
  });

  // Search + Table-of-Contents UI. Wired to the DemoApp's lib controllers.
  createSearchUi({
    onQueryChange: (query) => app.search.setQuery(query),
    onFindNext: () => app.search.findNext(),
    onFindPrevious: () => app.search.findPrevious(),
    onClear: () => app.search.clear(),
    getSearchState: () => app.search.getState(),
    loadOutline: () => app.outline.load(),
    hasOutline: () => app.outline.hasOutline(),
    onOutlineItemClick: (item) => {
      void app.outline.goTo(item);
    },
  });

  // Keep the search counter / prev-next buttons in sync with the controller.
  app.search.subscribe(() => updateSearchUi());

  // Keyboard: Delete/Backspace removes the selected annotation when the
  // 'select' tool is active and focus is not inside an editable element.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA')
    ) {
      return;
    }
    if (app.getTool() === 'select' && app.getSelectedId()) {
      e.preventDefault();
      app.deleteSelected();
    }
  });

  const loadingText = document.getElementById('loading-text');
  if (loadingText) loadingText.style.display = 'block';

  try {
    console.log('Loading PDF from URL...');
    const url =
      'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf';
    console.log('URL:', url);
    await app.loadDocument(url);
    console.log('PDF loaded successfully');
    if (loadingText) loadingText.style.display = 'none';

    updatePageInfo();
    updateZoomInfo();
    updateViewModeInfo();

    // Begin relaying view state and adopt the room's current view (or seed it
    // if we are the first peer). Do this after the document is loaded so the
    // absolute setters operate on a fully-rendered viewer.
    viewSync.start();
    viewSync.syncInitial();
  } catch (error: any) {
    console.error('Error loading PDF in main:', error);
    if (loadingText) {
      loadingText.style.display = 'block';
      loadingText.textContent = 'Error loading PDF: ' + (error.message || error);
    }
  }

  // Default to the ink (draw) tool, matching the previous app behaviour.
  app.setTool('ink');
  setActiveTool('draw');
  currentActiveTool = 'draw';

  // Test hook: expose app + provider so e2e tests can inspect state.
  (window as any).__demoApp = app;
  (window as any).__pdfProvider = provider;

  // Backwards-compatible hook for the existing e2e smoke test, which reads
  // window.__pdfSync.get() and expects an array of annotation records.
  (window as any).__pdfSync = {
    get: () => app.store.getYArray().toArray(),
  };

  // Test hook: read the LOCAL published view state, and simulate a REMOTE
  // peer's view change.
  //
  // View state now lives in Yjs *Awareness* (not the Y.Doc). To make `set()`
  // exercise the exact same apply path + loop guards a real peer would trigger,
  // we stand up a SECOND Awareness bound to its OWN Y.Doc (so it has a distinct
  // clientID) and relay its awareness updates into the real provider awareness.
  // Publishing a `view` field on that fake peer therefore appears to the local
  // ViewStateAwareness as a genuine remote peer, driving ViewSync.applyRemote.
  const remotePeerDoc = new Y.Doc();
  const remotePeerAwareness = new Awareness(remotePeerDoc);
  remotePeerAwareness.on('update', (changes: any) => {
    const changed = [
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ];
    const update = encodeAwarenessUpdate(remotePeerAwareness, changed);
    applyAwarenessUpdate(awareness, update, 'e2e-remote-peer');
  });

  (window as any).__pdfViewState = {
    // `get` returns the LOCAL published view state — what a peer would receive
    // from this client (used to assert local UI changes propagate outward).
    get: () => viewStateSource.getState(),
    // `getRemote` returns the fake remote peer's currently published view — used
    // to assert that applying a remote change did NOT cause a write-back that
    // mutated the remote/authoritative value (the "no echo" guarantee).
    getRemote: () => {
      const v = (remotePeerAwareness.getLocalState()?.view as any) ?? {};
      return {
        viewMode: v.viewMode ?? 'scroll',
        zoom: typeof v.zoom === 'number' ? v.zoom : 1,
        rotation: typeof v.rotation === 'number' ? v.rotation : 0,
        page: typeof v.page === 'number' ? v.page : 1,
      };
    },
    // `set` publishes the merged view state as the fake REMOTE peer, so the
    // local apply path (and its loop guards) run exactly as for a real peer.
    set: (partial: any) => {
      const prev = (remotePeerAwareness.getLocalState()?.view as any) ?? {};
      remotePeerAwareness.setLocalState({ view: { ...prev, ...partial } });
    },
  };

  // Test hook: drive the search controller and read its state.
  (window as any).__pdfSearch = {
    setQuery: (q: string, opts?: any) => app.search.setQuery(q, opts),
    findNext: () => app.search.findNext(),
    findPrevious: () => app.search.findPrevious(),
    clear: () => app.search.clear(),
    getState: () => app.search.getState(),
  };

  // Test hook: drive the outline (table of contents) controller.
  (window as any).__pdfOutline = {
    load: () => app.outline.load(),
    goTo: (item: any) => app.outline.goTo(item),
    hasOutline: () => app.outline.hasOutline(),
    getItems: () => app.outline.getItems(),
  };
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

main().catch(console.error);
