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
import { provider, yViewState, clientId } from './sync';
import { ViewStateStore } from '../lib';
import { ViewSync } from './viewSync';

async function main(): Promise<void> {
  const viewerContainer = document.getElementById('viewer-container');
  if (!viewerContainer) {
    throw new Error('Viewer container not found');
  }

  // Shared view-state store + coordinator (view mode, zoom, rotation, page).
  const viewStateStore = new ViewStateStore(yViewState);
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

  viewSync = new ViewSync(app, viewStateStore, clientId, {
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

  // Test hook: read/write the shared view state directly. `get` returns the
  // defaulted shared state; `set` writes as a *remote* origin so the local
  // apply path (and its loop guards) run exactly as they would for a peer.
  (window as any).__pdfViewState = {
    get: () => viewStateStore.getState(),
    set: (partial: any) => viewStateStore.setState(partial, 'e2e-remote'),
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
