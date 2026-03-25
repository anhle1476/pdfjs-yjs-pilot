import { PdfPilot } from './PdfPilot';
import { createSidebar, setActiveTool, updatePageInfo, updateZoomInfo } from './ui';
import { sync } from './sync';
import type { Annotation } from './types';

async function main(): Promise<void> {
  const viewerContainer = document.getElementById('viewer-container');
  if (!viewerContainer) {
    throw new Error('Viewer container not found');
  }

  const pdfPilot = new PdfPilot(viewerContainer, {
    onAnnotationCreated: (annotation: Annotation) => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).push(annotation);
      });
    },
    onAnnotationsCleared: () => {
      sync.update((draft: unknown) => {
        (draft as Annotation[]).splice(0);
      });
    },
    onPageChange: (_pageNumber: number) => {
      updatePageInfo();
    },
    onZoomChange: (_scale: number) => {
      updateZoomInfo();
    },
  });

  createSidebar({
    onDraw: () => {
      pdfPilot.setTool('ink');
      setActiveTool('draw');
    },
    onText: () => {
      pdfPilot.setTool('text');
      setActiveTool('text');
    },
    onHighlight: () => {
      pdfPilot.setTool('highlight');
      setActiveTool('highlight');
    },
    onClear: () => {
      pdfPilot.clearAnnotations();
    },
    onPrevPage: () => {
      pdfPilot.previousPage();
    },
    onNextPage: () => {
      pdfPilot.nextPage();
    },
    onZoomIn: () => {
      pdfPilot.zoomIn();
    },
    onZoomOut: () => {
      pdfPilot.zoomOut();
    },
    onFitPage: () => {
      pdfPilot.fitToPage();
    },
    onRotateCW: () => {
      pdfPilot.rotateClockwise();
    },
    getPageInfo: () => {
      return {
        current: pdfPilot.getCurrentPage(),
        total: pdfPilot.getTotalPages(),
      };
    },
    getZoomPercent: () => {
      return pdfPilot.getZoomPercent();
    },
  });

  const loadingText = document.getElementById('loading-text');
  if (loadingText) loadingText.style.display = 'block';

  try {
    console.log('Loading PDF from URL...');
    const url = 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf';
    console.log('URL:', url);
    await pdfPilot.loadDocument(url);
    console.log('PDF loaded successfully');
    if (loadingText) loadingText.style.display = 'none';

    updatePageInfo();
    updateZoomInfo();
  } catch (error: any) {
    console.error('Error loading PDF in main:', error);
    if (loadingText) {
      loadingText.style.display = 'block';
      loadingText.textContent = 'Error loading PDF: ' + (error.message || error);
    }
  }

  pdfPilot.setTool('ink');
  setActiveTool('draw');

  sync.subscribe(() => {
    const annotations = sync.get() as Annotation[];
    pdfPilot.loadAnnotations(annotations);
  });

  const initialAnnotations = sync.get() as Annotation[];
  pdfPilot.loadAnnotations(initialAnnotations);
}

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

main().catch(console.error);
