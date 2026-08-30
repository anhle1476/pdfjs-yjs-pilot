import { DemoApp, type DemoTool } from './DemoApp';
import {
  createSidebar,
  setActiveTool,
  updatePageInfo,
  updateZoomInfo,
  updateViewModeInfo,
} from './ui';
import { provider } from './sync';

async function main(): Promise<void> {
  const viewerContainer = document.getElementById('viewer-container');
  if (!viewerContainer) {
    throw new Error('Viewer container not found');
  }

  // The demo app owns the renderer, store, tools and all input wiring.
  const app = new DemoApp(viewerContainer, {
    onPageChange: () => updatePageInfo(),
    onZoomChange: () => updateZoomInfo(),
    onViewModeChange: () => updateViewModeInfo(),
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
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

main().catch(console.error);
