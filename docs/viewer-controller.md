# PDF.js Viewer Controller Design

## 1. Current Implementation Analysis

### 1.1 PdfPilot.ts Single-Page Limitation

The current `PdfPilot.loadDocument()` method only renders **page 1** of the PDF:

```typescript
public async loadDocument(url: string, pageNumber: number = 1): Promise<void> {
  const pdfDoc = await loadingTask.promise;
  this.currentPage = await pdfDoc.getPage(pageNumber); // Always page 1 in main.ts
  // ...
}
```

**Problems**:
- Hardcoded `pageNumber = 1` parameter (never changed)
- Single canvas pair (viewer + annotation) cannot display multiple pages
- No scroll container management beyond basic `overflow: auto`
- No viewport synchronization across pages

### 1.2 Key PDF.js APIs for Multi-Page Rendering

From `display/api.js` and `display/display_utils.js`:

| API | Purpose |
|-----|---------|
| `PDFDocumentProxy.numPages` | Total page count |
| `PDFDocumentProxy.getPage(n)` | Get page proxy by 1-indexed number |
| `PDFPageProxy.getViewport({ scale, rotation })` | Create viewport for a page |
| `PageViewport.clone({ scale, rotation })` | Create modified viewport |
| `PageViewport.convertToViewportPoint(x, y)` | PDF coord → canvas coord |
| `PDFPageProxy.render(renderContext)` | Render page to canvas |
| `TextLayer` | Render text overlay per page |
| `PagesMapper` | Page reordering/manipulation |

---

## 2. Multi-Page Rendering Patterns

### 2.1 Pattern A: Vertical Scroll (All Pages)

Render all pages sequentially in a vertical stack. User scrolls to navigate.

```
┌─────────────────────────────┐
│  Page 1 Canvas              │
│  ┌───────────────────────┐  │
│  │                       │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  Page 2 Canvas             │
│  ┌───────────────────────┐  │
│  │                       │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  Page 3 Canvas             │
│  ┌───────────────────────┐  │
│  │                       │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Pros**: Simple, SEO-friendly, native scroll
**Cons**: Large PDFs = many canvases, memory heavy

### 2.2 Pattern B: Single Page with Navigation (One at a Time)

Only render the current page. Provide prev/next controls.

```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │    Current Page       │  │
│  │                       │  │
│  └───────────────────────┘  │
│  [Prev] Page 3 of 10 [Next]  │
└─────────────────────────────┘
```

**Pros**: Memory efficient, fast initial load
**Cons**: No overview, requires user action to navigate

### 2.3 Pattern C: Continuous (Virtualized Scroll)

Render visible pages + buffer. Virtual scrolling with recycled canvases.

**Pros**: Best UX for large documents
**Cons**: Complex implementation

---

## 3. Controller Architecture Design

### 3.1 Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         PdfPilot                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐     │
│  │  PageCtrl   │  │ ZoomCtrl   │  │  NavigationCtrl    │     │
│  │            │  │            │  │                    │     │
│  │ - pages[]  │  │ - scale    │  │ - goToPage(n)      │     │
│  │ - current  │  │ - zoom()   │  │ - nextPage()       │     │
│  │ - render() │  │ - fit()    │  │ - prevPage()       │     │
│  └─────┬──────┘  └─────┬──────┘  └─────────┬──────────┘     │
│        │               │                    │                 │
│        └───────────────┼────────────────────┘                 │
│                        ▼                                      │
│              ┌──────────────────┐                              │
│              │   PageManager    │                              │
│              │                  │                              │
│              │ - pageViews[]    │                              │
│              │ - createPage()  │                              │
│              │ - getPageView() │                              │
│              └──────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 PageView (Per-Page Component)

Represents one page with its canvases:

```typescript
interface PageView {
  pageNumber: number;
  pageProxy: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLElement;      // Wrapper div
  viewerCanvas: HTMLCanvasElement;
  annotationCanvas: HTMLCanvasElement;
  textLayer?: TextLayer;
  scale: number;
  rotation: number;
}
```

### 3.3 PageController

Manages individual page rendering:

```typescript
class PageController {
  private pdfDoc: PDFDocumentProxy;
  private pageViews: Map<number, PageView> = new Map();
  private currentPageNumber: number = 1;
  private scale: number = 1;
  private rotation: number = 0;

  async initialize(pdfDoc: PDFDocumentProxy): Promise<void>;
  async renderPage(pageNumber: number): Promise<PageView>;
  removePage(pageNumber: number): void;

  getPageCount(): number;
  getCurrentPage(): number;
  setCurrentPage(pageNumber: number): void;

  updateScale(newScale: number): void;
  updateRotation(degrees: number): void;

  getViewport(pageNumber: number): PageViewport;
  renderAnnotations(pageNumber: number, annotations: Annotation[]): void;
}
```

### 3.4 ZoomController

Handles zoom operations:

```typescript
class ZoomController {
  private currentScale: number = 1;
  private minScale: number = 0.1;
  private maxScale: number = 10;
  private scaleStep: number = 0.25;

  constructor(options?: {
    minScale?: number;
    maxScale?: number;
    defaultScale?: number;
  });

  zoomIn(): number;
  zoomOut(): number;
  setScale(scale: number): number;
  fitToWidth(containerWidth: number, pageWidth: number): number;
  fitToHeight(containerHeight: number, pageHeight: number): number;
  fitToPage(containerWidth: number, containerHeight: number, pageWidth: number, pageHeight: number): number;

  getScale(): number;
  getZoomPercent(): number;
}
```

**Zoom Levels**:
- `setScale(1.0)` = 100%
- `zoomIn()` → `1.0 + 0.25 = 1.25` (125%)
- `zoomOut()` → `1.0 - 0.25 = 0.75` (75%)

**Fit Calculations**:
```typescript
fitToWidth(containerWidth, pageWidth) {
  return containerWidth / pageWidth;
}

fitToPage(containerWidth, containerHeight, pageWidth, pageHeight) {
  const scaleW = containerWidth / pageWidth;
  const scaleH = containerHeight / pageHeight;
  return Math.min(scaleW, scaleH);
}
```

### 3.5 PanController

Manages scrolling/panning:

```typescript
class PanController {
  private container: HTMLElement;
  private scrollLeft: number = 0;
  private scrollTop: number = 0;

  constructor(container: HTMLElement);

  scrollTo(x: number, y: number): void;
  scrollBy(deltaX: number, deltaY: number): void;
  scrollToPage(pageNumber: number, pageTop: number): void;

  pan(dx: number, dy: number): void;  // For mode where drag pans

  getScrollPosition(): { x: number; y: number };

  ensurePageVisible(pageNumber: number): void;
}
```

### 3.6 RotateController

Handles page/document rotation:

```typescript
class RotateController {
  private currentRotation: number = 0;  // 0, 90, 180, 270

  rotateClockwise(): number;   // 0 → 90 → 180 → 270 → 0
  rotateCounterClockwise(): number;
  setRotation(degrees: number): number;
  getRotation(): number;

  normalizeRotation(degrees: number): number;  // Clamp to 0-359
}
```

### 3.7 NavigationController

High-level API coordinating all controllers:

```typescript
class NavigationController {
  private pageCtrl: PageController;
  private zoomCtrl: ZoomController;
  private panCtrl: PanController;
  private rotateCtrl: RotateController;

  constructor(container: HTMLElement, pdfDoc: PDFDocumentProxy);

  // Navigation
  goToPage(pageNumber: number): Promise<void>;
  nextPage(): Promise<void>;
  previousPage(): Promise<void>;
  firstPage(): Promise<void>;
  lastPage(): Promise<void>;

  // Zoom
  zoomIn(): void;
  zoomOut(): void;
  setZoom(scale: number): void;
  fitToWidth(): void;
  fitToPage(): void;
  zoomTo(percent: number): void;

  // Pan
  scrollTo(x: number, y: number): void;
  pan(dx: number, dy: number): void;

  // Rotate
  rotateClockwise(): void;
  rotateCounterClockwise(): void;

  // State getters
  getCurrentPage(): number;
  getTotalPages(): number;
  getZoom(): number;
  getRotation(): number;

  // Events
  onPageChange(callback: (pageNumber: number) => void): void;
  onZoomChange(callback: (scale: number) => void): void;
}
```

---

## 4. Integration with PdfPilot.ts

### 4.1 Modified PdfPilot Architecture

```typescript
class PdfPilot {
  private container: HTMLElement;
  private pdfDoc: PDFDocumentProxy | null = null;

  // Controller layer
  private pageController: PageController | null = null;
  private navigationController: NavigationController | null = null;

  // Existing annotation system (unchanged)
  private inkPlugin: InkPlugin;
  private highlightPlugin: HighlightPlugin;

  public async loadDocument(url: string): Promise<void> {
    const loadingTask = pdfjsLib.getDocument(url);
    this.pdfDoc = await loadingTask.promise;

    // Initialize controllers
    this.pageController = new PageController(this.pdfDoc, this.container);
    this.navigationController = new NavigationController(
      this.container,
      this.pdfDoc
    );

    // Setup annotation layer on current page
    this.setupAnnotationLayer();

    // Subscribe to sync
    sync.subscribe(() => {
      const annotations = sync.get() as Annotation[];
      const currentPage = this.navigationController?.getCurrentPage() ?? 1;
      this.pageController?.renderAnnotations(currentPage, annotations);
    });
  }

  // Delegate navigation to controller
  public goToPage(pageNumber: number): Promise<void> {
    return this.navigationController?.goToPage(pageNumber) ?? Promise.resolve();
  }

  public setZoom(scale: number): void {
    this.navigationController?.setZoom(scale);
  }

  public zoomIn(): void {
    this.navigationController?.zoomIn();
  }

  public rotateClockwise(): void {
    this.navigationController?.rotateClockwise();
  }

  // ... other delegating methods
}
```

### 4.2 Page Rendering Flow

```
loadDocument(url)
    │
    ▼
PDFDocumentProxy.getDocument(url)
    │
    ▼
pageController.initialize(pdfDoc)
    │
    ▼
For each page (or current page only):
    │
    ├── pdfDoc.getPage(n) → PDFPageProxy
    ├── page.getViewport({ scale: 1 }) → PageViewport
    ├── Create page container div
    ├── Create viewerCanvas + annotationCanvas
    ├── page.render({ canvasContext, viewport })
    │
    ▼
navigationController.setupEventListeners()
```

### 4.3 Annotation Layer Per Page

Each `PageView` maintains its own annotation canvas:

```typescript
class PageView {
  // ...
  annotationCanvas: HTMLCanvasElement;
  private annotations: Annotation[] = [];

  renderAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations.filter(a => a.pageNumber === this.pageNumber);
    const ctx = this.annotationCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);
    for (const ann of this.annotations) {
      if (ann.type === 'ink') {
        // Use InkPlugin to render
      }
      // ...
    }
  }
}
```

**Annotation-Page Association**: Annotations must store `pageNumber`:

```typescript
interface Annotation {
  id: string;
  type: 'ink' | 'highlight' | 'text';
  pageNumber: number;  // Required for multi-page
  // ... other properties
}
```

---

## 5. Implementation Roadmap

### Phase 1: PageController (Core)

1. Create `PageController` class
2. Implement `renderPage(n)` to create page canvases
3. Store page views in `Map<number, PageView>`
4. Support vertical scroll layout

### Phase 2: NavigationController (User Interaction)

1. Create `NavigationController` class
2. Implement `goToPage()`, `nextPage()`, `prevPage()`
3. Add keyboard shortcuts (Arrow keys, Page Up/Down)
4. Add scroll-to-page on visible change

### Phase 3: ZoomController (Scaling)

1. Create `ZoomController` class
2. Implement `zoomIn()`, `zoomOut()`, `setScale()`
3. Implement `fitToWidth()`, `fitToPage()`
4. Re-render all visible pages on scale change

### Phase 4: RotateController (Rotation)

1. Create `RotateController` class
2. Implement `rotateClockwise()`, `rotateCounterClockwise()`
3. Update viewports with new rotation

### Phase 5: Annotation Integration

1. Update `Annotation` interface to include `pageNumber`
2. Modify `InkPlugin`/`HighlightPlugin` to be page-aware
3. Render annotations only for visible pages
4. Sync annotations per page

---

## 6. Reference: PDF.js Page Rendering

```typescript
// Complete page rendering pattern from PDF.js
async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number
): Promise<void> {
  const viewport = page.getViewport({ scale, rotation });

  const canvasWrapper = canvas.parentElement;
  canvas.width = viewport.width * devicePixelRatio;
  canvas.height = viewport.height * devicePixelRatio;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
  };

  await page.render(renderContext).promise;
}
```

---

## 7. Events and Callbacks

```typescript
interface PdfPilotEvents {
  'pagechange': (pageNumber: number) => void;
  'zoomchange': (scale: number) => void;
  'rotationchange': (rotation: number) => void;
  'annotationadded': (annotation: Annotation) => void;
  'annotationremoved': (annotationId: string) => void;
}

// Usage
pdfPilot.on('pagechange', (pageNum) => {
  console.log(`Navigated to page ${pageNum}`);
  updatePageIndicator(pageNum);
});
```
