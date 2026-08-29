# Tài liệu Kiến trúc PDF.js Pilot - Architecture Documentation

## Tổng quan (Overview)

Tài liệu này mô tả kiến trúc đã được cập nhật của PDF.js Pilot, bao gồm hệ thống chú thích (annotation) mới dựa trên plugin với `IToolPlugin` / `AnnotationObject`, đồng bộ hóa thời gian thực qua Yjs, và cách dữ liệu luân chuyển trong ứng dụng.

## Kiến trúc Cấp cao (High-Level Architecture)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser Tab                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        Lớp Ứng dụng (Application Layer)                │  │
│  │                                                                        │  │
│  │   ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐      │  │
│  │   │   Sidebar   │     │   Tools     │     │      PdfPilot       │      │  │
│  │   │   (UI.ts)   │────▶│ (tools.ts)  │────▶│  (InkPlugin)        │      │  │
│  │   └─────────────┘     └─────────────┘     └─────────────────────┘      │  │
│  │          │                   │                       │                 │  │
│  │          │                   │                       │                 │  │
│  │          │                   │              ┌────────┴────────┐        │  │
│  │          │                   │              │                 │        │  │
│  │          │                   │              ▼                 ▼        │  │
│  │          │                   │    ┌──────────────────┐   ┌───────────┐ │  │
│  │          │                   │    │  InkPlugin       │   │ToolManager│ │  │
│  │          │                   │    │  (IToolPlugin)   │   │           │ │  │
│  │          │                   │    └────────┬─────────┘   └───────────┘ │  │
│  │          │                   │             │                           │  │
│  │          │                   │    ┌────────┴──────────┐                │  │
│  │          │                   │    │ sharedStore:      │                │  │
│  │          │                   │    │ AnnotationObject[]│                │  │
│  │          │                   │    └────────┬──────────┘                │  │
│  │          │                   │             │                           │  │
│  └──────────┼───────────────────┼─────────────┼─────────────────-─────────┘  │
│             │                   │             │                              │
│             ▼                   ▼             ▼                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                  Lớp Đồng bộ (Sync Layer - sync.ts)                    │  │
│  │                                                                        │  │
│  │   ┌─────────────────┐         ┌──────────────────┐                     │  │
│  │   │    immer-yjs    │         │ WebsocketProvider│                     │  │
│  │   │     (bind)      │         │   (y-websocket)  │                     │  │
│  │   └────────┬────────┘         └────────┬─────────┘                     │  │
│  │            │                           │                               │  │
│  │            │               ┌───────────┴──────────┐                    │  │
│  │            │               │                      │                    │  │
│  │            ▼               ▼                      ▼                    │  │
│  │   ┌─────────────────────────────────────────────────────┐              │  │
│  │   │                    Y.Doc                            │              │  │
│  │   │              (yannotations: Y.Array)                │              │  │
│  │   └─────────────────────────────────────────────────────┘              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                     │                                        │
└─────────────────────────────────────│────────────────────────────────────────┘
                                      │ WebSocket
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                    Máy chủ y-websocket (cổng 1234)                            │
└───────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Phát sóng tới tất cả các client đang kết nối
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Tab Trình duyệt Khác                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │   Cùng một Kiến trúc - Một Instance Khác                               │  │
│  │                                                                        │  │
│  │   Y.Doc ◀──WebsocketProvider──▶ Tự động đồng bộ chú thích              │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Kiến trúc Hệ thống Plugin (Plugin System Architecture)

### Interface IToolPlugin

Tất cả các công cụ chú thích đều triển khai interface `IToolPlugin`, cung cấp một vòng đời (lifecycle) và hợp đồng xử lý sự kiện thống nhất.

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

### Lớp Cơ sở AnnotationObject (AnnotationObject Base Class)

`AnnotationObject` là lớp trừu tượng cơ sở cho tất cả các đối tượng chú thích có thể vẽ. Nó khai báo hợp đồng cho các thao tác hình học và lưu trữ lâu dài (persistence).

```typescript
export abstract class AnnotationObject {
  abstract hitTest(x: number, y: number): boolean;
  abstract getBounds(): Rect;
  abstract move(dx: number, dy: number): void;
  abstract resize(anchor: string, dx: number, dy: number): void;
  abstract serialize(): any;
  abstract deserialize(data: any): void;
  abstract render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void;
}
```

### InkPlugin và InkObject

`InkPlugin` triển khai `IToolPlugin` cho công cụ vẽ mực tự do (freehand ink). Nó sử dụng `InkDrawOutliner` từ module drawers để xây dựng dữ liệu đường dẫn SVG và tạo ra các instance của `InkObject`.

**InkObject** lưu trữ:
- `id`: Định danh duy nhất
- `paths`: Mảng các `{ line: number[], points: number[] }` - dữ liệu đường dẫn đã được chuẩn hóa (normalized)
- `color`: Màu nét vẽ (hex)
- `strokeWidth`: Độ dày nét vẽ
- `bounds`: Hình chữ nhật bao quanh `{ x, y, width, height }`

```typescript
export class InkObject extends AnnotationObject {
  hitTest(x, y): boolean        // Kiểm tra khoảng cách điểm-trong-đường với lề
  getBounds(): Rect             // Trả về hộp bao quanh đã tính toán trước
  move(dx, dy): void            // Di chuyển tất cả các điểm đường dẫn và hộp bao
  resize(anchor, dx, dy): void  // Thay đổi kích thước đường dẫn tương ứng với điểm neo (n/s/e/w)
  serialize(): any              // Trả về đối tượng có thể JSON-serialize (NaN → null)
  deserialize(data): void        // Khôi phục đối tượng từ dữ liệu đã serialize (null → NaN)
  render(ctx, w, h): void      // Vẽ các đường cong bezier lên canvas bằng tọa độ đã chuẩn hóa
}

export class InkPlugin implements IToolPlugin {
  // Giữ kho lưu trữ chú thích dùng chung (shared store)
  private store: AnnotationObject[];

  // Các hàm xử lý sự kiện con trỏ ủy quyền cho InkDrawOutliner
  onPointerDown(evt): void;
  onPointerMove(evt): void;
  onPointerUp(evt): void;   // Đẩy InkObject đã hoàn thành vào sharedStore

  render(ctx): void;        // Xóa canvas, vẽ tất cả InkObjects + bản xem trước (preview)
  getObjects(): AnnotationObject[];
}
```

**Quyết định Thiết kế Quan trọng**: Các instance `InkObject` đã hoàn thành được đẩy vào một `sharedStore` (một mảng `AnnotationObject[]`). Kho lưu trữ này là nguồn chân lý duy nhất (single source of truth) được sử dụng để hiển thị và là cầu nối với lớp đồng bộ.

## Tích hợp PdfPilot (PdfPilot Integration)

`PdfPilot` sở hữu `annotationCanvas` và khởi tạo `InkPlugin` với một kho lưu trữ dùng chung:

```typescript
private sharedStore: AnnotationObject[] = [];
private inkPlugin: InkPlugin;

constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
  this.inkPlugin = new InkPlugin(this.sharedStore);
  // ...
}

private setupToolManager() {
  // ToolManager xử lý các công cụ không phải mực (văn bản, tô sáng)
  // Công cụ mực được xử lý trực tiếp bởi InkPlugin qua các sự kiện con trỏ
  this.annotationCanvas.addEventListener('pointerdown', (e) => {
    if (this.toolManager?.getTool() === 'ink') this.inkPlugin.onPointerDown(e);
  });
  // ... tương tự cho pointermove / pointerup
}
```

`renderAnnotations()` ủy quyền hoàn toàn cho plugin:

```typescript
private renderAnnotations(): void {
  const ctx = this.annotationCanvas.getContext('2d');
  if (!ctx) return;
  if (this.inkPlugin) {
    this.inkPlugin.render(ctx);
  }
}
```

## Lớp Đồng bộ (Sync Layer)

Lớp đồng bộ (`sync.ts`) liên kết `sharedStore` với một `Y.Array` của Yjs để tất cả các đối tượng chú thích (thông qua đầu ra `serialize()` của chúng) được phát sóng tới các máy ngang hàng (peers).

```typescript
export const sync = {
  subscribe: binder.subscribe,    // Lắng nghe các thay đổi từ xa
  update: binder.update,          // Áp dụng các thay đổi cục bộ (kiểu immer)
  get: () => binder.get(),        // Danh sách chú thích hiện tại
  provider,                       // WebsocketProvider cho vận chuyển thời gian thực
};
```

Khi một `InkObject` mới được `InkPlugin.onPointerUp()` đẩy vào `sharedStore`, lớp đồng bộ sẽ phân phối nó tới tất cả các peers. Khi một thay đổi từ xa đến qua WebSocket, `binder.update()` sẽ hợp nhất nó quay lại `sharedStore`.

## Luồng Dữ liệu: Vẽ Mực (Data Flow: Ink Drawing)

```
Người dùng kéo trên canvas
    │
    ▼
InkPlugin.onPointerDown()
    │ Tạo InkDrawOutliner với tọa độ đã chuẩn hóa
    ▼
InkPlugin.onPointerMove()
    │ outliner.add() tạo ra đoạn đường dẫn SVG
    │ previewPath được cập nhật → render() vẽ bản xem trước trực tiếp
    ▼
InkPlugin.onPointerUp()
    │ outliner.end() hoàn tất các đường dẫn
    │ new InkObject(id, paths, color, strokeWidth) được tạo ra
    │ sharedStore.push(inkObject)        ← được lưu trữ để đồng bộ & hiển thị
    ▼
render() được gọi qua onRenderNeeded
    │ Lặp qua sharedStore
    │ Gọi obj.render(ctx, w, h) cho mỗi InkObject
    │ Vẽ previewPath nếu đang hoạt động
    ▼
Lớp Đồng bộ (Sync Layer)
    │ inkObject.serialize() → Cập nhật Yjs → Phát sóng WebSocket
    ▼
Các Máy ngang hàng Khác (Other Peers)
    │ Nhận cập nhật Yjs
    │ sharedStore được cập nhật qua sync.update()
    │ render() vẽ lại với InkObject mới
```

## Mô hình Dữ liệu (Data Model)

### Định dạng Tuần tự hóa AnnotationObject (AnnotationObject Serialization Format)

InkObjects tuần tự hóa thành một biểu diễn tương thích JSON cho lớp đồng bộ:

```json
{
  "type": "ink",
  "id": "ink_1711234567890_abc123",
  "paths": [
    {
      "line": [null, null, null, null, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2],
      "points": [0.1, 0.1, 0.2, 0.2]
    }
  ],
  "color": "#2563eb",
  "strokeWidth": 2,
  "bounds": { "x": 0.1, "y": 0.1, "width": 0.1, "height": 0.1 }
}
```

**Lưu ý**: Các giá trị `NaN` trong mảng `line` của đường dẫn được tuần tự hóa thành `null` (JSON không hỗ trợ `NaN`). Khi `deserialize()`, các giá trị `null` được khôi phục lại thành `NaN` để duy trì hợp đồng với InkDrawOutliner.

### Interface Rect

```typescript
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## Cấu trúc Tệp (File Structure)

```
pdfjs-pilot/
├── src/
│   ├── main.ts                  # Điểm vào (Entry point)
│   ├── PdfPilot.ts              # Trình xem PDF chính + điều phối chú thích
│   ├── tools.ts                 # ToolManager (văn bản/tô sáng)
│   ├── sync.ts                  # Liên kết Yjs + immer-yjs + WebsocketProvider
│   ├── ui.ts                    # UI Sidebar
│   ├── types.ts                 # Các kiểu TypeScript dùng chung (Annotation, InkData, v.v.)
│   ├── drawers/
│   │   ├── InkDrawOutliner.ts   # Bộ xây dựng đường dẫn Bezier (InkDrawOutliner)
│   │   └── Outline.ts          # Các tiện ích tĩnh cho chuẩn hóa & toán học bezier
│   └── plugins/
│       ├── IToolPlugin.ts       # Interface IToolPlugin + lớp cơ sở AnnotationObject
│       ├── InkPlugin.ts        # Triển khai InkPlugin + InkObject
│       └── HighlightPlugin.ts  # Triển khai HighlightPlugin + HighlightObject
├── tests/
│   ├── InkPlugin.test.ts        # Kiểm thử đơn vị cho InkObject và InkPlugin
│   └── HighlightPlugin.test.ts   # Kiểm thử đơn vị cho HighlightObject và HighlightPlugin
├── vitest.config.ts             # Cấu hình kiểm thử
└── ARCHITECTURE.md              # Tài liệu này
```

## Ánh xạ Công cụ sang Dữ liệu (Tool to Data Mapping)

### Công cụ Vẽ Mực (Ink / Draw Tool)

**Hành động của Người dùng**: Nhấp và kéo trên canvas chú thích

**Plugin**: `InkPlugin`

**Dữ liệu được Tạo**: `InkObject` với:
- `paths`: Các điểm kiểm soát đường cong Bezier từ `InkDrawOutliner` (chuẩn hóa 0–1)
- `strokeWidth`: Độ dày có thể cấu hình
- `color`: Màu nét vẽ đã chọn

**Đồng bộ**: Đầu ra `InkObject.serialize()` được đẩy vào mảng Yjs

### Công cụ Văn bản (Text Tool)

**Plugin**: Được xử lý trực tiếp bởi `ToolManager` trong `tools.ts`

**Dữ liệu được Tạo**: `Annotation` với `type: 'text'`

### Công cụ Tô sáng (Highlight Tool)

**Plugin**: `HighlightPlugin`

**Dữ liệu được Tạo**: `HighlightObject` với:
- `paths`: Dữ liệu đường bao đa giác từ `HighlightOutliner` (chuẩn hóa 0–1)
- `color`: Màu tô sáng đã chọn
- `opacity`: Độ trong suốt của phần tô sáng (0-1)
- `quadPoints`: Các điểm tứ giác PDF tùy chọn để tuần tự hóa

**Đồng bộ**: Đầu ra `HighlightObject.serialize()` được đẩy vào mảng Yjs

**Những khác biệt chính so với Ink**:
- Tô sáng sử dụng lựa chọn hình chữ nhật (kéo để tạo) thay vì vẽ tự do
- `HighlightOutliner` thực hiện thuật toán sweep-line để tính toán hợp (union) đa giác
- `HighlightObject` hiển thị với màu tô bán trong suốt (không phải nét vẽ)

## Cơ chế Đồng bộ (Sync Mechanism)

### y-websocket Provider

```typescript
import { WebsocketProvider } from 'y-websocket';

const provider = new WebsocketProvider('ws://localhost:1234', 'pdfjs-pilot-annotations', doc);
```

### Cách thức Hoạt động của Đồng bộ

1. Client kết nối tới máy chủ WebSocket tại `ws://localhost:1234`
2. Máy chủ phân phối các cập nhật tài liệu tới tất cả các client trong cùng một phòng (room)
3. Chia sẻ dựa trên phòng: cùng tên phòng = cùng trạng thái tài liệu được chia sẻ

### Luồng Đồng bộ (Sync Flow)

```
Tab A                                Máy chủ (Server)               Tab B
  │                                     │                               │
  │  InkPlugin.onPointerUp()            │                               │
  │  sharedStore.push(inkObject)        │                               │
  │                                     │                               │
  ▼                                     │                               │
Cập nhật Y.Doc                          │                               │
  │                                     │                               │
  ├─────────────────────────────────────┼───────────────────────────────┤
  │                                     │                               │
  ▼                                     ▼                               ▼
WebSocket gửi                      Máy chủ                    WebSocket nhận
tới máy chủ                     (chuyển tiếp tới phòng)         từ máy chủ
  │                                     │                               │
  └─────────────────────────────────────┼───────────────────────────────┘
                                        │
                                        ▼
                              Tất cả client trong phòng
                              nhận được cập nhật
                              sharedStore được cập nhật
                              render() vẽ lại
```

## Chạy Máy chủ WebSocket (Running the WebSocket Server)

```bash
# Bắt đầu máy chủ trên cổng 1234
HOST=localhost PORT=1234 npx y-websocket
```

## Phụ thuộc (Dependencies)

```json
{
  "yjs": "^13.6.21",         // Triển khai CRDT
  "y-websocket": "^3.0.0",   // Provider đồng bộ WebSocket
  "immer-yjs": "^1.2.0",     // Liên kết Yjs kiểu immer
  "pdfjs-dist": "^5.5.207",  // Kết xuất PDF
  "vitest": "^4.1.1",        // Kiểm thử đơn vị
  "jsdom":                  // Môi trường DOM cho kiểm thử
}
```

## Cấu hình (Configuration)

### Phía Client (sync.ts)

```typescript
const ROOM_NAME = 'pdfjs-pilot-annotations';
const WS_SERVER_URL = 'ws://localhost:1234';
```

### Phía Máy chủ (Biến Môi trường)

```bash
HOST=localhost
PORT=1234
YPERSISTENCE=./dbDir  # Tùy chọn: Bật lưu trữ LevelDB lâu dài
```
