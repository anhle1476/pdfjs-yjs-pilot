# Kiến trúc PDF.js + Yjs Pilot

Tài liệu này mô tả kiến trúc **hiện tại** của pilot: một thư viện chú thích PDF
framework-free (`src/lib`) và một host app demo (`src/demo`) minh hoạ cách dùng
thư viện đó cùng đồng bộ real-time qua Yjs.

Nguyên tắc cốt lõi: **thư viện thuần API, host sở hữu I/O**. `src/lib` không tạo
`Y.Doc`, không đụng network, không gắn global input listener (ngoại lệ duy nhất là
`FreeTextTool` tự sở hữu DOM `contentEditable` của nó). Host (`src/demo`) sở hữu
`Y.Doc` + `WebsocketProvider`, gắn pointer listener, và quyết định gọi tool nào.

---

## Sơ đồ tầng (Layers)

```
┌──────────────────────────────── Browser Tab ─────────────────────────────────┐
│                                                                               │
│  Host app (src/demo)                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  main.ts        khởi tạo, nối UI ↔ DemoApp ↔ ViewSync, test hooks         ││
│  │  ui.ts          sidebar / info panel                                      ││
│  │  DemoApp.ts     orchestrator: gắn pointer listener, chọn tool, render     ││
│  │  TouchGestureManager.ts   chặn pan 1 ngón khi đang vẽ                     ││
│  │  viewSync.ts    đồng bộ view state 2 chiều qua Awareness (chống echo)     ││
│  │  sync.ts        SỞ HỮU Y.Doc + WebsocketProvider + Y.Array + Awareness     ││
│  └───────────────┬───────────────────────────────────┬─────────────────────┘│
│                  │ dùng                                │ trao Y.Array/Awareness│
│                  ▼                                     ▼                       │
│  Lib (src/lib) — thuần API, framework-free                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  PdfRenderer            render/view + navigation (KHÔNG annotation)       ││
│  │   └ controllers/        Page / Navigation / Zoom / Rotate / ViewMode      ││
│  │  AnnotationStore        CRUD trên Y.Array (host cấp)                       ││
│  │  ViewStateAwareness     view state trên Yjs Awareness (host cấp) — KHÔNG   ││
│  │                          ghi vào Y.Doc (presence, phù du)                  ││
│  │  HitTester              hit-test annotation                               ││
│  │  tools/                 InkTool / HighlightTool / FreeTextTool            ││
│  │  models/                InkObject / HighlightObject / FreeTextObject      ││
│  │  drawers/               InkDrawOutliner / HighlightOutliner / Outline     ││
│  │  services/              TextLayerService / TextSelectionManager           ││
│  │                          SearchController / OutlineController              ││
│  │  utils/                 TextCoordinateUtils                               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │ WebSocket                               │
└─────────────────────────────────────┼─────────────────────────────────────────┘
                                      ▼
                    Máy chủ y-websocket (ws://localhost:1234)
                                      │ phát tới mọi peer cùng room
                                      ▼
                            Các tab / peer khác (cùng kiến trúc)
```

---

## Thư viện (`src/lib`) — bề mặt public

Xuất qua `src/lib/index.ts`. Các khối chính:

### PdfRenderer (`PdfRenderer.ts`)
Wrapper render/view-only quanh PDF.js. **Không** chứa logic annotation, **không**
gắn pointer listener (chỉ có listener điều hướng bàn phím/scroll của
`NavigationController`). Uỷ quyền cho 5 controller trong `controllers/`:
- `PageController` — dựng DOM mỗi trang (3 lớp canvas/text-layer), render nội dung
  PDF + text layer, rebuild khi đổi scale/rotation/view-mode.
- `NavigationController` — điều hướng trang, zoom, rotation, view-mode; phát các
  callback `onPageChange / onZoomChange / onRotationChange / onViewModeChange`.
- `ZoomController`, `RotateController`, `ViewModeController` — state con.

API tiêu biểu: `loadDocument`, `goToPage/next/prev`, `setZoom/zoomIn/Out/fit*`,
`setRotation/rotate*`, `setViewMode`, các getter, và helper toạ độ
`getPageAtClientPoint` / `toNormalizedPoint` để host quy đổi pointer → trang +
toạ độ chuẩn hoá 0–1.

### AnnotationStore (`AnnotationStore.ts`)
Lớp CRUD mỏng trên một `Y.Array` **do host cấp**. Mỗi phần tử là bản ghi JSON đã
`serialize()` (khoá bằng `type`: `'ink' | 'highlight' | 'freetext'`). Mọi mutation
bọc trong `doc.transact(...)`. `subscribe()` dùng `Y.Array.observe`.

### ViewStateAwareness (`ViewStateAwareness.ts`)
Lớp mỏng trên một **Yjs Awareness** (presence phù du) **do host cấp**, chứa
`{ viewMode, zoom, rotation, page }` dưới **một** trường awareness `view`.

**TẠI SAO Awareness thay vì Y.Doc**: view state đổi trên các hành động **tần suất
cao** — scroll, zoom, rotate, lật trang. Ghi những giá trị đó vào `Y.Doc` (CRDT có
lịch sử vĩnh viễn, chỉ append) khiến document **phình vô hạn** dù chỉ giá trị *mới
nhất* mới có ý nghĩa. Awareness là state **phù du**: **không** ghi vào lịch sử doc,
và tự **xoá** khi peer ngắt kết nối — đúng chỗ cho "peer này đang xem ở đâu".
Annotation vẫn nằm trong `Y.Doc` (Y.Array) vì đó là dữ liệu bền, cần lịch sử.

Bề mặt khớp với những gì `ViewSync` cần nên coordinator gần như không đổi:
- `getState()` — view state **local** đã publish (defaulted).
- `setState(partial, origin?)` — merge + publish vào trường `view` của awareness
  local, giữ nguyên các trường awareness khác. `origin` chỉ để tương thích chữ ký;
  self-filter làm bằng `clientID` (không phải origin) vì awareness không có lịch sử.
- `subscribe(cb)` — nghe `change`; khi một **peer remote** đổi trường `view`, gọi
  `cb` với view của peer đó và một origin **không phải** local (để `ViewSync` áp).
  Bỏ qua thay đổi của chính `clientID` mình.
- `isEmpty()` / `getRemoteState()` — có/không peer remote nào đang publish view;
  chọn **peer có `clientID` nhỏ nhất** (deterministic) để adopt-on-join.

Phụ thuộc trên một interface cấu trúc tối thiểu (`AwarenessLike`) nên unit-test
được mà không cần y-websocket. `ViewSync` phụ thuộc `ViewStateSource` (không phải
class cụ thể).

### Tools (`tools/`)
`InkTool`, `HighlightTool` (mode `free|box|text`), `FreeTextTool`. Tools nhận
`AnnotationStore` và tạo/commit `models/` vào store. Chúng **không** tự gắn pointer
listener (trừ `FreeTextTool` sở hữu DOM editable) — host gọi các method của tool.

### Models (`models/`)
`AnnotationObject` (base trừu tượng) + `InkObject`/`HighlightObject`/`FreeTextObject`.
Contract: `hitTest`, `getBounds`, `move`, `resize`, `serialize`, `deserialize`,
`render`. **Toạ độ lưu chuẩn hoá 0–1** theo kích thước trang (xem mục Mô hình dữ
liệu).

### Services / Utils
- `TextLayerService` — query các glyph span của text layer trong một range (chỉ
  đọc DOM, không sở hữu/không gắn listener).
- `TextSelectionManager` — quy đổi `window.getSelection()` thành range chuẩn hoá
  theo trang.
- `TextCoordinateUtils` — normalize/denormalize toạ độ, union rect.
- `SearchController` — tìm kiếm toàn tài liệu (thay Ctrl+F). Trích text mọi trang
  từ `PDFDocumentProxy`, `normalize()` (NFKC + gộp gạch cuối dòng + map dấu
  cong) rồi match RegExp (`caseSensitive`/`entireWord`), con trỏ selected + wrap
  vòng, `current/total`, debounce 250ms; khi match đổi trang gọi `goToPage`
  (chạy cho cả single & scroll). API: `setQuery/findNext/findPrevious/clear/
  getState/getSelectedMatch/getPageMatches/matchText/subscribe`. Framework-free.
  - `matchText(text)`: chạy đúng query hiện tại trên một chuỗi bất kỳ, trả offset
    trong chính chuỗi đó. Dùng để host highlight khớp **chính xác** text-layer
    (xem `LESSONS_LEARNED.md` mục highlight alignment).
- `OutlineController` — mục lục (TOC). `load()` (getOutline → cây), `hasOutline()`,
  `resolvePageNumber(item)` (dest→page theo thuật toán pdf.js), `goTo(item)`
  (resolve + goToPage). Xử lý PDF không có outline. Framework-free.

---

## Host app (`src/demo`)

### sync.ts — nơi DUY NHẤT nối Yjs
Tạo `Y.Doc`, `yAnnotations = doc.getArray('annotations')`,
`provider = new WebsocketProvider(...)`, và xuất `awareness = provider.awareness`.
**Không** còn `Y.Map('viewState')`: view state đi qua **Awareness** (presence),
không ghi vào Y.Doc. Room mặc định `pdfjs-pilot-annotations`, override qua `?room=`
(dùng để cô lập test). Xuất `clientId` (từ `doc.clientID`) làm `localOrigin` cho
`ViewSync`.

### SearchHighlighter.ts + searchUI.ts — Search/TOC UI (host)
- `SearchHighlighter` — vẽ match lên text-layer. Ghép `span.textContent` của các
  glyph span (đúng text người dùng thấy), gọi `SearchController.matchText` trên
  chuỗi đó → offset khớp span tuyệt đối, rồi bọc `<span class="search-highlight">`
  (thêm `.selected` cho match hiện tại). Highlight-all; nền bán trong suốt để
  chữ canvas hiện xuyên qua. Re-apply sau mỗi lần trang render lại.
- `searchUI` — search bar (input + `[current]/[total]` + prev/next), chặn Ctrl+F,
  và panel TOC đệ quy.

### DemoApp.ts — orchestrator
Sở hữu `PdfRenderer`, `AnnotationStore`, 3 tool, `HitTester`,
`TextSelectionManager`, `TouchGestureManager`. Trách nhiệm:
- Gắn `pointerdown/move/up` lên annotation canvas mỗi trang (`rebindCanvases`).
- Chọn method tool theo tool đang active.
- Render annotation đã commit lên canvas mỗi trang (lib không auto-render).
- Vòng đời `FreeTextTool` theo trang.
- Re-render khi store đổi (local hoặc remote) qua `store.subscribe`. **Lưu ý:**
  không rebuild DOM editor freetext trong callback này (observer chạy đồng bộ
  trong `doc.transact` → sẽ phá editor đang gõ).
- Phát callback `on{Page,Zoom,ViewMode,Rotation}Change` cho host.

### viewSync.ts — đồng bộ view state 2 chiều
Bắc cầu local↔remote qua `ViewStateSource` (do `ViewStateAwareness` hiện thực,
backing là **Awareness**, KHÔNG phải Y.Doc) với **3 lớp guard chống echo** +
**settle window**. Chi tiết xem `docs/LESSONS_LEARNED.md` (mục view-sync). Thứ tự
apply remote: viewMode → rotation → zoom → page. `syncInitial()` dùng
`getRemoteState()`: nếu có peer remote thì adopt view của nó, nếu không thì seed từ
state local hiện tại.

### TouchGestureManager.ts
Chặn `touchmove` 1 ngón khi tool vẽ đang active; 2 ngón để browser pan/pinch.

### main.ts — điểm vào
Dựng `ViewStateAwareness` (trên `provider.awareness`) + `ViewSync`, khởi tạo
`DemoApp` với callback nối `ui.ts` và `ViewSync`, tạo sidebar, load PDF mẫu, rồi
`viewSync.start()/syncInitial()`. Cũng gắn test hook: `__demoApp`, `__pdfProvider`,
`__pdfSync`, `__pdfViewState`. Test hook `__pdfViewState.set()` publish view như
một **peer remote giả** (một `Awareness` thứ hai trên Y.Doc riêng → `clientID`
khác, relay update vào awareness thật) để chạy đúng đường apply + guard như peer
thật; `get()` đọc view local đã publish, `getRemote()` đọc view của peer giả (để
kiểm "no echo").

---

## Luồng dữ liệu

### Vẽ annotation (ink/highlight box/free)
```
pointerdown/move/up trên annotationCanvas (DemoApp)
   → DemoApp gọi tool.beginStroke/update/end (toạ độ chuẩn hoá 0–1)
   → tool tạo model, AnnotationStore.add(model)  →  Y.Array (doc.transact)
   → Yjs phát WebSocket tới peer
   → store.subscribe fire (local & remote) → DemoApp.renderAllPages() vẽ lại
```

### Highlight text-mode
`document` mouseup → `TextSelectionManager.getSelection()` → mỗi client rect →
`HighlightTool.createFromTextRange(...)` → store → render.

### Đồng bộ view state (qua Awareness — KHÔNG ghi Y.Doc)
```
UI/nav đổi → DemoApp.on*Change → ViewSync.handleLocal*Change
   → ViewStateAwareness.setState({field}) → awareness.setLocalState({ view })
   → Yjs phát awareness update tới peer (KHÔNG vào lịch sử doc; tự xoá khi rời)
Peer remote đổi view → awareness 'change' → ViewStateAwareness.subscribe
   → ViewSync.applyRemote (origin != local)
   → gọi absolute setter (setViewMode/setRotation/setZoom/goToPage) cho field khác biệt
```
Self-filter bằng `clientID` (không phải origin) vì awareness không có lịch sử/commit
đồng bộ như Y.Doc.

---

## Mô hình dữ liệu

Mỗi phần tử `yAnnotations` là bản ghi JSON từ `serialize()`:

```json
{
  "type": "ink",
  "id": "ink_...",
  "pageNumber": 1,
  "paths": [{ "line": [null, null, 0.1, 0.1, ...], "points": [0.1, 0.1, ...] }],
  "color": "#2563eb",
  "strokeWidth": 2,
  "bounds": { "x": 0.1, "y": 0.1, "width": 0.1, "height": 0.1 }
}
```

- **Toạ độ chuẩn hoá 0–1** theo kích thước trang → độc lập zoom/rotation/DPI.
- `NaN` trong path của ink → `null` khi serialize (JSON không có `NaN`), khôi phục
  ngược khi `deserialize`.

View state **không** ở trong Y.Doc. Nó nằm trong **Awareness** dưới trường `view`
của mỗi peer: `{ viewMode: 'scroll'|'single', zoom: number, rotation: number,
page: number }` — presence phù du, không lưu vào lịch sử doc, tự xoá khi peer rời.

---

## Ba lớp DOM mỗi trang (`PageController.createPageView`)

| Lớp | z-index | pointer-events | Vai trò |
|-----|---------|----------------|---------|
| `viewerCanvas` | 1 | (mặc định) | PDF nền |
| `annotationCanvas` | 5 | `auto` | Nhận input vẽ |
| `textLayer` | 10 | `none` (container), span `auto` | Chọn text |

Vùng trống của text-layer để sự kiện rơi xuống annotationCanvas (vẽ); glyph span
vẫn chọn được. Khi bật tool vẽ, class `drawing-active` tắt pointer-events trên span
để drag bắt đầu trên chữ vẫn tới canvas vẽ.

---

## Chạy & test

```bash
npm run dev            # dev server (Vite)
npm run server         # y-websocket server (ws://localhost:1234)
npm run build          # build production
npx tsc --noEmit       # type-check
npm test               # unit (vitest)
npx playwright test    # e2e (Playwright)
```

Test e2e cô lập room bằng `?room=` (mỗi test một room) để state Yjs không rò rỉ.

---

## Phụ thuộc chính

```
yjs, y-websocket        # CRDT + transport
pdfjs-dist ^5.5.x       # render PDF + TextLayer
vitest, @playwright/test, jsdom
vite                    # build/dev
```

Xem thêm `docs/LESSONS_LEARNED.md` cho các cạm bẫy đã gặp và lưu ý khi migrate
thư viện này sang app production thật.
