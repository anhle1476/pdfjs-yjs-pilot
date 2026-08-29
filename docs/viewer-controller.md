# Thiết kế Bộ điều khiển Trình xem PDF.js (PDF.js Viewer Controller Design)

## 1. Phân tích Triển khai Hiện tại (Current Implementation Analysis)

### 1.1 Hạn chế một trang của PdfPilot.ts (PdfPilot.ts Single-Page Limitation)

Phương thức `PdfPilot.loadDocument()` hiện tại chỉ kết xuất (render) **trang 1** của tệp PDF:

```typescript
public async loadDocument(url: string, pageNumber: number = 1): Promise<void> {
  const pdfDoc = await loadingTask.promise;
  this.currentPage = await pdfDoc.getPage(pageNumber); // Luôn là trang 1 trong main.ts
  // ...
}
```

**Các vấn đề**:
- Tham số `pageNumber = 1` bị ghi cứng (không bao giờ thay đổi)
- Cặp canvas đơn lẻ (viewer + annotation) không thể hiển thị nhiều trang
- Không có quản lý container cuộn ngoài việc thiết lập `overflow: auto` cơ bản
- Không có đồng bộ hóa viewport giữa các trang

### 1.2 Các API PDF.js quan trọng cho kết xuất nhiều trang (Key PDF.js APIs for Multi-Page Rendering)

Từ `display/api.js` và `display/display_utils.js`:

| API | Mục đích |
|-----|----------|
| `PDFDocumentProxy.numPages` | Tổng số trang |
| `PDFDocumentProxy.getPage(n)` | Lấy proxy trang theo số thứ tự (bắt đầu từ 1) |
| `PDFPageProxy.getViewport({ scale, rotation })` | Tạo viewport cho một trang |
| `PageViewport.clone({ scale, rotation })` | Tạo viewport đã được sửa đổi |
| `PageViewport.convertToViewportPoint(x, y)` | Tọa độ PDF → tọa độ canvas |
| `PDFPageProxy.render(renderContext)` | Kết xuất trang lên canvas |
| `TextLayer` | Kết xuất lớp phủ văn bản cho từng trang |
| `PagesMapper` | Sắp xếp lại/thao tác trang |

---

## 2. Các Mô hình Kết xuất Nhiều Trang (Multi-Page Rendering Patterns)

### 2.1 Mô hình A: Cuộn dọc (Tất cả các trang) (Pattern A: Vertical Scroll - All Pages)

Kết xuất tất cả các trang tuần tự theo một chồng dọc. Người dùng cuộn để điều hướng.

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

**Ưu điểm**: Đơn giản, thân thiện với SEO, cuộn tự nhiên
**Nhược điểm**: Tệp PDF lớn = nhiều canvas, tiêu tốn bộ nhớ

### 2.2 Mô hình B: Một trang với điều hướng (Từng trang một) (Pattern B: Single Page with Navigation - One at a Time)

Chỉ kết xuất trang hiện tại. Cung cấp các nút điều khiển trước/sau.

```
┌─────────────────────────────┐
│  ┌───────────────────────┐  │
│  │                       │  │
│  │    Trang Hiện tại     │  │
│  │                       │  │
│  └───────────────────────┘  │
│  [Trước] Trang 3 / 10 [Sau]  │
└─────────────────────────────┘
```

**Ưu điểm**: Tiết kiệm bộ nhớ, tải ban đầu nhanh
**Nhược điểm**: Không có cái nhìn tổng quan, yêu cầu người dùng thao tác để điều hướng

### 2.3 Mô hình C: Cuộn liên tục (Cuộn ảo) (Pattern C: Continuous - Virtualized Scroll)

Kết xuất các trang đang hiển thị + vùng đệm (buffer). Cuộn ảo với các canvas được tái sử dụng.

**Ưu điểm**: Trải nghiệm người dùng tốt nhất cho các tài liệu lớn
**Nhược điểm**: Triển khai phức tạp

---

## 3. Thiết kế Kiến trúc Bộ điều khiển (Controller Architecture Design)

### 3.1 Tổng quan (Overview)

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

### 3.2 PageView (Thành phần cho mỗi trang)

Đại diện cho một trang với các canvas của nó:

```typescript
interface PageView {
  pageNumber: number;
  pageProxy: PDFPageProxy;
  viewport: PageViewport;
  container: HTMLElement;      // Div bao ngoài
  viewerCanvas: HTMLCanvasElement;
  annotationCanvas: HTMLCanvasElement;
  textLayer?: TextLayer;
  scale: number;
  rotation: number;
}
```

### 3.3 PageController

Quản lý việc kết xuất từng trang:

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

Xử lý các thao tác thu phóng (zoom):

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

**Các mức thu phóng (Zoom Levels)**:
- `setScale(1.0)` = 100%
- `zoomIn()` → `1.0 + 0.25 = 1.25` (125%)
- `zoomOut()` → `1.0 - 0.25 = 0.75` (75%)

**Tính toán độ vừa vặn (Fit Calculations)**:
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

Quản lý việc cuộn/di chuyển (panning):

```typescript
class PanController {
  private container: HTMLElement;
  private scrollLeft: number = 0;
  private scrollTop: number = 0;

  constructor(container: HTMLElement);

  scrollTo(x: number, y: number): void;
  scrollBy(deltaX: number, deltaY: number): void;
  scrollToPage(pageNumber: number, pageTop: number): void;

  pan(dx: number, dy: number): void;  // Cho chế độ kéo để di chuyển

  getScrollPosition(): { x: number; y: number };

  ensurePageVisible(pageNumber: number): void;
}
```

### 3.6 RotateController

Quản lý việc xoay trang/tài liệu:

```typescript
class RotateController {
  private currentRotation: number = 0;  // 0, 90, 180, 270

  rotateClockwise(): number;   // 0 → 90 → 180 → 270 → 0
  rotateCounterClockwise(): number;
  setRotation(degrees: number): number;
  getRotation(): number;

  normalizeRotation(degrees: number): number;  // Giới hạn trong khoảng 0-359
}
```

### 3.7 NavigationController

API cấp cao điều phối tất cả các bộ điều khiển:

```typescript
class NavigationController {
  private pageCtrl: PageController;
  private zoomCtrl: ZoomController;
  private panCtrl: PanController;
  private rotateCtrl: RotateController;

  constructor(container: HTMLElement, pdfDoc: PDFDocumentProxy);

  // Điều hướng (Navigation)
  goToPage(pageNumber: number): Promise<void>;
  nextPage(): Promise<void>;
  previousPage(): Promise<void>;
  firstPage(): Promise<void>;
  lastPage(): Promise<void>;

  // Thu phóng (Zoom)
  zoomIn(): void;
  zoomOut(): void;
  setZoom(scale: number): void;
  fitToWidth(): void;
  fitToPage(): void;
  zoomTo(percent: number): void;

  // Di chuyển (Pan)
  scrollTo(x: number, y: number): void;
  pan(dx: number, dy: number): void;

  // Xoay (Rotate)
  rotateClockwise(): void;
  rotateCounterClockwise(): void;

  // Các hàm lấy trạng thái (State getters)
  getCurrentPage(): number;
  getTotalPages(): number;
  getZoom(): number;
  getRotation(): number;

  // Sự kiện (Events)
  onPageChange(callback: (pageNumber: number) => void): void;
  onZoomChange(callback: (scale: number) => void): void;
}
```

---

## 4. Tích hợp với PdfPilot.ts (Integration with PdfPilot.ts)

### 4.1 Kiến trúc PdfPilot đã sửa đổi (Modified PdfPilot Architecture)

```typescript
class PdfPilot {
  private container: HTMLElement;
  private pdfDoc: PDFDocumentProxy | null = null;

  // Lớp điều khiển (Controller layer)
  private pageController: PageController | null = null;
  private navigationController: NavigationController | null = null;

  // Hệ thống chú thích hiện có (không đổi)
  private inkPlugin: InkPlugin;
  private highlightPlugin: HighlightPlugin;

  public async loadDocument(url: string): Promise<void> {
    const loadingTask = pdfjsLib.getDocument(url);
    this.pdfDoc = await loadingTask.promise;

    // Khởi tạo các bộ điều khiển
    this.pageController = new PageController(this.pdfDoc, this.container);
    this.navigationController = new NavigationController(
      this.container,
      this.pdfDoc
    );

    // Thiết lập lớp chú thích trên trang hiện tại
    this.setupAnnotationLayer();

    // Đăng ký đồng bộ
    sync.subscribe(() => {
      const annotations = sync.get() as Annotation[];
      const currentPage = this.navigationController?.getCurrentPage() ?? 1;
      this.pageController?.renderAnnotations(currentPage, annotations);
    });
  }

  // Ủy quyền điều hướng cho bộ điều khiển
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

  // ... các phương thức ủy quyền khác
}
```

### 4.2 Luồng kết xuất trang (Page Rendering Flow)

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
Cho từng trang (hoặc chỉ trang hiện tại):
    │
    ├── pdfDoc.getPage(n) → PDFPageProxy
    ├── page.getViewport({ scale: 1 }) → PageViewport
    ├── Tạo div container cho trang
    ├── Tạo viewerCanvas + annotationCanvas
    ├── page.render({ canvasContext, viewport })
    │
    ▼
navigationController.setupEventListeners()
```

### 4.3 Lớp chú thích cho mỗi trang (Annotation Layer Per Page)

Mỗi `PageView` duy trì canvas chú thích riêng của nó:

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
        // Sử dụng InkPlugin để kết xuất
      }
      // ...
    }
  }
}
```

**Liên kết Chú thích-Trang (Annotation-Page Association)**: Các chú thích phải lưu trữ `pageNumber`:

```typescript
interface Annotation {
  id: string;
  type: 'ink' | 'highlight' | 'text';
  pageNumber: number;  // Bắt buộc cho nhiều trang
  // ... các thuộc tính khác
}
```

---

## 5. Lộ trình Triển khai (Implementation Roadmap)

### Giai đoạn 1: PageController (Cốt lõi)

1. Tạo lớp `PageController`
2. Triển khai `renderPage(n)` để tạo các canvas cho trang
3. Lưu trữ các page view trong `Map<number, PageView>`
4. Hỗ trợ bố cục cuộn dọc

### Giai đoạn 2: NavigationController (Tương tác Người dùng)

1. Tạo lớp `NavigationController`
2. Triển khai `goToPage()`, `nextPage()`, `prevPage()`
3. Thêm các phím tắt bàn phím (Phím mũi tên, Page Up/Down)
4. Thêm tính năng cuộn đến trang khi vùng hiển thị thay đổi

### Giai đoạn 3: ZoomController (Tỉ lệ)

1. Tạo lớp `ZoomController`
2. Triển khai `zoomIn()`, `zoomOut()`, `setScale()`
3. Triển khai `fitToWidth()`, `fitToPage()`
4. Kết xuất lại tất cả các trang đang hiển thị khi tỉ lệ thay đổi

### Giai đoạn 4: RotateController (Xoay)

1. Tạo lớp `RotateController`
2. Triển khai `rotateClockwise()`, `rotateCounterClockwise()`
3. Cập nhật các viewport với góc xoay mới

### Giai đoạn 5: Tích hợp Chú thích (Annotation Integration)

1. Cập nhật interface `Annotation` để bao gồm `pageNumber`
2. Sửa đổi `InkPlugin`/`HighlightPlugin` để nhận biết trang
3. Chỉ kết xuất chú thích cho các trang đang hiển thị
4. Đồng bộ hóa chú thích theo từng trang

---

## 6. Tham chiếu: Kết xuất Trang PDF.js (Reference: PDF.js Page Rendering)

```typescript
// Mẫu kết xuất trang hoàn chỉnh từ PDF.js
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

## 7. Sự kiện và Phản hồi (Events and Callbacks)

```typescript
interface PdfPilotEvents {
  'pagechange': (pageNumber: number) => void;
  'zoomchange': (scale: number) => void;
  'rotationchange': (rotation: number) => void;
  'annotationadded': (annotation: Annotation) => void;
  'annotationremoved': (annotationId: string) => void;
}

// Cách sử dụng
pdfPilot.on('pagechange', (pageNum) => {
  console.log(`Đã điều hướng tới trang ${pageNum}`);
  updatePageIndicator(pageNum);
});
```
