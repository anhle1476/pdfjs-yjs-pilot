# Hướng dẫn Di chuyển FreeTextPlugin - FreeTextPlugin Migration Guide

## Tổng quan (Overview)

Tài liệu này mô tả quá trình di chuyển từ triển khai `FreeTextEditor` cũ trong `display/editor/freetext.js` sang kiến trúc `FreeTextPlugin` mới trong `src/plugins/FreeTextPlugin.ts`.

## So sánh Kiến trúc (Architecture Comparison)

### Kiến trúc Cũ (freetext.js)

```
FreeTextEditor (AnnotationEditor subclass)
├── Sử dụng div contentEditable để chỉnh sửa văn bản
├── Tích hợp với AnnotationEditorLayer
├── Sử dụng các phương thức tĩnh cho các giá trị mặc định (initialize, updateDefaultParams)
└── Xử lý sự kiện bàn phím phức tạp qua KeyboardManager
```

### Kiến trúc Plugin Mới (FreeTextPlugin)

```
FreeTextPlugin (triển khai IToolPlugin)
├── Sử dụng contentEditable dựa trên DOM để nhập văn bản
├── Tích hợp với PdfPilot qua sharedStore
├── Triển khai đầy đủ interface IToolPlugin
└── Sẵn sàng đồng bộ qua tích hợp Yjs
```

## Những Khác biệt Chính (Key Differences)

### 1. Tuân thủ Plugin Interface

`FreeTextPlugin` mới triển khai interface `IToolPlugin`:

```typescript
export interface IToolPlugin {
  activate(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void;
  deactivate(): void;
  onPointerDown(evt: PointerEvent): void;
  onPointerMove(evt: PointerEvent): void;
  onPointerUp(evt: PointerEvent): void;
  render(ctx: CanvasRenderingContext2D): void;
  getObjects(): AnnotationObject[];
}
```

### 2. Mô hình Dữ liệu (Data Model)

Lớp `FreeTextObject` cung cấp khả năng hỗ trợ tuần tự hóa (serialization):

```typescript
export interface FreeTextObjectData {
  type: 'freetext';
  id: string;
  content: string;
  fontSize: number;
  color: string;
  bounds: Rect;
  page: number;
}
```

### 3. Hiển thị DOM so với Canvas (DOM vs Canvas Rendering)

- **Cũ**: Hiển thị trực tiếp qua phương thức `render()` của editor, trả về một div DOM
- **Mới**: Sử dụng một lớp phủ `_editorContainer` riêng biệt để chỉnh sửa văn bản dựa trên DOM, trong khi canvas được sử dụng cho lớp chú thích

## Các Bước Di chuyển (Migration Steps)

### Bước 1: Nhập Plugin (Import the Plugin)

```typescript
import { FreeTextPlugin } from './plugins/FreeTextPlugin';
import { FreeTextObject } from './models/FreeTextObject';
```

### Bước 2: Khởi tạo Plugin (Initialize the Plugin)

```typescript
// Thêm vào sharedStore (cùng kho lưu trữ được sử dụng bởi InkPlugin và HighlightPlugin)
private sharedStore: AnnotationObject[] = [];
private freeTextPlugin: FreeTextPlugin;

constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
  this.freeTextPlugin = new FreeTextPlugin(this.sharedStore, {
    defaultFontSize: 10,
    defaultColor: '#000000',
  });
}
```

### Bước 3: Kích hoạt trên Trang Hiện tại (Activate on Current Page)

```typescript
private setupAnnotationPlugins(): void {
  const currentPageView = this.pageController?.getCurrentPageView();
  if (!currentPageView) return;

  const ctx = currentPageView.annotationCanvas.getContext('2d');
  if (!ctx) return;

  this.freeTextPlugin.setPageNumber(this.currentPageNumber);
  this.freeTextPlugin.activate(currentPageView.annotationCanvas, ctx);
  this.freeTextPlugin.onRenderNeeded = () => this.renderAnnotationsForCurrentPage();
  this.freeTextPlugin.onObjectCreated = (obj) => {
    sync.update((draft: unknown) => {
      (draft as Annotation[]).push(obj.serialize());
    });
  };
}
```

### Bước 4: Thêm các Trình lắng nghe Sự kiện (Add Event Listeners)

```typescript
private setupAnnotationEventListeners(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('pointerdown', (e) => {
    if (this.currentToolManager?.getTool() === 'freetext') {
      this.freeTextPlugin.onPointerDown(e);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (this.currentToolManager?.getTool() === 'freetext') {
      this.freeTextPlugin.onPointerMove(e);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (this.currentToolManager?.getTool() === 'freetext') {
      this.freeTextPlugin.onPointerUp(e);
    }
  });
}
```

### Bước 5: Xử lý Thay đổi Trang (Handle Page Changes)

```typescript
private setupAnnotationPluginsForCurrentPage(): void {
  this.freeTextPlugin.setPageNumber(this.currentPageNumber);
  this.freeTextPlugin.deactivate();
  this.freeTextPlugin.activate(currentPageView.annotationCanvas, ctx);
  this.setupAnnotationEventListeners(currentPageView.annotationCanvas);
  this.renderAnnotationsForCurrentPage();
}
```

## Tham chiếu API (API Reference)

### Các Phương thức của FreeTextPlugin (FreeTextPlugin Methods)

| Phương thức | Mô tả |
|-------------|-------|
| `activate(canvas, context)` | Khởi tạo plugin với một canvas |
| `deactivate()` | Dọn dẹp tài nguyên |
| `setPageNumber(page)` | Chuyển sang một trang khác |
| `getPageNumber()` | Lấy số trang hiện tại |
| `onPointerDown(evt)` | Xử lý sự kiện nhấn con trỏ |
| `onPointerMove(evt)` | Xử lý sự kiện di chuyển con trỏ |
| `onPointerUp(evt)` | Xử lý sự kiện thả con trỏ |
| `getObjects()` | Lấy các chú thích cho trang hiện tại |
| `getAllObjects()` | Lấy tất cả các chú thích |
| `getData()` | Tuần tự hóa tất cả các đối tượng |
| `setData(data)` | Khôi phục các đối tượng từ dữ liệu đã tuần tự hóa |
| `validate()` | Xác thực tất cả các đối tượng |
| `initialize(container)` | Thiết lập container cho editor |
| `destroy()` | Dọn dẹp và hủy kích hoạt |
| `commitAll()` | Lưu (commit) tất cả các editor đang hoạt động |

### Các Tùy chọn của FreeTextPlugin (FreeTextPlugin Options)

```typescript
interface FreeTextPluginOptions {
  defaultFontSize?: number;  // Mặc định: 10
  defaultColor?: string;     // Mặc định: '#000000'
  container?: HTMLElement;    // Container tùy chỉnh (tùy chọn)
}
```

### Các Callback của FreeTextPlugin (FreeTextPlugin Callbacks)

```typescript
onRenderNeeded?: () => void;          // Được gọi khi cần vẽ lại
onObjectCreated?: (obj: FreeTextObject) => void;   // Được gọi khi đối tượng được tạo
onObjectUpdated?: (obj: FreeTextObject) => void;   // Được gọi khi đối tượng được cập nhật
onObjectDeleted?: (obj: FreeTextObject) => void;   // Được gọi khi đối tượng bị xóa
```

### Các Thuộc tính của FreeTextObject (FreeTextObject Properties)

| Thuộc tính | Kiểu | Mô tả |
|------------|------|-------|
| `id` | `string` | Định danh duy nhất |
| `content` | `string` | Nội dung văn bản |
| `fontSize` | `number` | Kích thước phông chữ tính bằng pixel |
| `color` | `string` | Màu văn bản (hex) |
| `bounds` | `Rect` | Vị trí và kích thước (chuẩn hóa 0-1) |
| `pageNumber` | `number` | Chỉ số trang |

### Các Phương thức của FreeTextObject (FreeTextObject Methods)

| Phương thức | Mô tả |
|-------------|-------|
| `hitTest(x, y)` | Kiểm tra xem điểm có nằm trong phạm vi không |
| `getBounds()` | Lấy phạm vi (bản sao) |
| `move(dx, dy)` | Di chuyển chú thích |
| `resize(anchor, dx, dy)` | Thay đổi kích thước từ điểm neo (n/s/e/w/nw/ne/se/sw) |
| `serialize()` | Chuyển đổi thành đối tượng có thể JSON-serialize |
| `deserialize(data)` | Khôi phục từ dữ liệu đã tuần tự hóa |
| `setContent(content)` | Thiết lập nội dung văn bản |
| `getContent()` | Lấy nội dung văn bản |
| `isEmpty()` | Kiểm tra xem nội dung có trống hoặc chỉ có khoảng trắng không |

## Định dạng Tuần tự hóa (Serialization Format)

```json
{
  "type": "freetext",
  "id": "freetext_1711234567890_abc123",
  "content": "Hello World",
  "fontSize": 12,
  "color": "#ff0000",
  "bounds": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1 },
  "page": 1
}
```

## Tích hợp với Lớp Đồng bộ (Integration with Sync Layer)

`FreeTextPlugin` tích hợp với lớp đồng bộ Yjs thông qua kho lưu trữ dùng chung:

```typescript
this.freeTextPlugin.onObjectCreated = (obj) => {
  sync.update((draft: unknown) => {
    (draft as Annotation[]).push(obj.serialize());
  });
};
```

Khi nhận các cập nhật từ xa:

```typescript
sync.subscribe((annotations) => {
  const freetextData = annotations.filter(a => a.type === 'freetext');
  this.freeTextPlugin.setData(freetextData);
});
```

## Các Thay đổi Phá vỡ (Breaking Changes)

1. **Không truy cập DOM trực tiếp**: Plugin tự quản lý container editor của nó bên trong
2. **Sự kiện dựa trên Callback**: Sử dụng các callback `onObjectCreated`, `onObjectUpdated`, `onObjectDeleted` thay vì các sự kiện
3. **Tọa độ đã chuẩn hóa**: Các phạm vi (bounds) được chuẩn hóa (0-1) thay vì giá trị pixel
4. **Tổ chức theo trang**: Các đối tượng được lọc theo `pageNumber`

## Kiểm thử (Testing)

Chạy kiểm thử với:

```bash
npx vitest run tests/FreeTextPlugin.test.ts
```

Chạy với báo cáo độ bao phủ (coverage):

```bash
npx vitest run --coverage
```

## Cấu trúc Tệp (File Structure)

```
src/
├── models/
│   └── FreeTextObject.ts      # Mô hình dữ liệu
├── plugins/
│   └── FreeTextPlugin.ts      # Triển khai plugin chính
└── types.ts                   # Được cập nhật với interface FreeTextData
```

## So sánh với các Plugin khác (Comparison with Other Plugins)

| Tính năng | InkPlugin | HighlightPlugin | FreeTextPlugin |
|-----------|-----------|-----------------|----------------|
| Chế độ vẽ | Vẽ tự do | Hộp/Vẽ tự do | Nhấp/Kéo |
| Hiển thị | Canvas Path2D | Canvas fill | Lớp phủ DOM |
| Xem trước | Có | Có | Có (chỉ khung bao) |
| Sẵn sàng đồng bộ | Có | Có | Có |
| Định dạng dữ liệu | paths[] | paths[] | content string |