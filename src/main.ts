import { PdfPilot } from './PdfPilot';
import { createSidebar, setActiveTool } from './ui';
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
    }
  });

  createSidebar({
    onDraw: () => {
      pdfPilot.setTool('ink');
      setActiveTool('draw'); // Note: UI uses 'draw' internally for the button class
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

// Add global error handler for uncaught promises
window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

main().catch(console.error);
