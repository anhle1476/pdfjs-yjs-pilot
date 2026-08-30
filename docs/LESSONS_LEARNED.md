# Lưu ý khi migrate Pilot sang App thật

Tài liệu này là danh sách các **cạm bẫy đã kiểm chứng** và **điểm phải kiểm tra**
khi mang thư viện `src/lib` (và cách wiring trong `src/demo`) vào một ứng dụng
production thật. Mỗi mục nêu: vấn đề → vì sao → phải làm gì khi migrate. Xem
`docs/ARCHITECTURE.md` cho bức tranh tổng thể.

---

## 1. Text layer: BẮT BUỘC cung cấp CSS glyph sizing + `--total-scale-factor`

**Vấn đề**: chọn text bị lệch — highlight HTML không đè đúng glyph canvas ("Part"
copy ra "Pa", highlight cả dòng tràn ra ngoài page).

**Vì sao**: `pdfjsLib.TextLayer` (v5.x) chỉ set inline các biến ở đơn vị PDF gốc
(`--font-height`, `--scale-x`, `--rotate`) cho mỗi glyph span; **font-size thực tế
do CSS của bạn tính** qua `--total-scale-factor`. Thiếu → span về 16px mặc định.

**Khi migrate — phải mang theo ĐỦ 2 phần** (nếu không sẽ tái hiện bug):
- CSS `.text-layer` + `.text-layer span` (trong `src/demo/style.css`): các biến
  `--min-font-size / --text-scale-factor / --min-font-size-inv`, `font-size:
  calc(var(--text-scale-factor) * var(--font-height))`, `transform: rotate(...)
  scaleX(var(--scale-x)) scale(var(--min-font-size-inv))`.
- `PageController.createPageView` set `--total-scale-factor = viewport.scale`
  (KHÔNG nhân `devicePixelRatio` — dpr chỉ cho backing-store canvas).
- Nếu app dùng CSS framework/reset khác, kiểm tra reset không đè `.text-layer span`.
- Nguồn chân lý: `node_modules/pdfjs-dist/web/pdf_viewer.css` (block `.textLayer`).
  Khi nâng pdfjs, đối chiếu lại tên biến (từng đổi `--scale-factor` →
  `--total-scale-factor`).

---

## 2. Đừng test text-selection bằng synthetic mouse drag

**Vấn đề**: assertion "kéo chuột tổng hợp → `getSelection()` khác rỗng" flaky/false
trong headless Chromium, kể cả khi selection hoạt động thật trên trình duyệt.

**Khi migrate**: nếu bê test e2e sang, test **hệ quả của contract** thay vì cơ chế
input: (a) span có `pointer-events: auto` (không `drawing-active`); (b) chọn được
qua `document.createRange().selectNodeContents(span)`; (c) click vùng
text-không-annotation làm `getSelectedId()` về `null`. Đây cũng là mẫu đúng cho
test selection ở app thật.

---

## 3. Gesture đa-ngón phải xử lý ở JS, không phải `touch-action` CSS

**Vấn đề**: cần "chặn pan 1 ngón khi vẽ, cho pan/pinch 2 ngón". `touch-action` CSS
không diễn đạt được theo số ngón.

**Khi migrate** (`TouchGestureManager`): listener touch phải **non-passive**
(để `preventDefault`) và nên ở **capture**. Chỉ `preventDefault` khi đúng 1 ngón và
tool sở hữu gesture; ≥2 ngón thì buông cho browser và huỷ stroke dở. Trên mobile
thật, kiểm thêm: Apple Pencil / stylus (`pointerType`), trình duyệt in-app
(WebView) có thể chặn gesture khác nhau.

---

## 4. Đồng bộ view-state 2 chiều: 3 guard + settle window (dễ ping-pong)

**Vấn đề**: áp thay đổi remote → trigger callback local → ghi lại → ping-pong.

**Khi migrate `ViewSync`, giữ đủ cả 3 lớp** (bỏ lớp nào cũng lỗi):
1. Cờ `isApplyingRemote` (giữ qua `await`, clear trong `finally`).
2. Origin tagging — Yjs gọi observer **đồng bộ ngay trên commit local**, nên cần
   bỏ qua event có `origin === localOrigin`.
3. Value diffing — chỉ ghi/áp field đã đổi; zoom so bằng `ZOOM_EPSILON`.

**Cạm bẫy settle window** (`APPLY_SETTLE_MS`): `goToPage` set `scrollTop` → scroll
listener (debounced ~100ms) phát page-change **sau khi** cờ đã clear → bị ghi lại
như local edit → ping-pong trang. Settle window phải **lớn hơn** debounce scroll
của app bạn. Nếu app production dùng cơ chế scroll/navigation khác, **đo lại**
debounce và chỉnh `settleMs`.

---

## 5. Cô lập state chia sẻ (Yjs room) giữa các phiên/test

**Vấn đề**: mọi phiên cùng room `pdfjs-pilot-annotations` → tích luỹ & rò rỉ
state; test "pass đơn lẻ, fail theo suite".

**Khi migrate**:
- Đặt **room theo tài liệu/không gian làm việc thật** (vd `doc-{id}`), không dùng
  room cứng. `sync.ts` đọc `?room=` chỉ là cơ chế demo/test — thay bằng nguồn id
  thật của app.
- Test e2e: mỗi test một room duy nhất.
- Cân nhắc TTL/dọn dẹp room và `YPERSISTENCE` phía server cho production.

---

## 6. Ranh giới sở hữu: lib KHÔNG tạo Y.Doc / KHÔNG đụng network

**Nguyên tắc pilot**: `AnnotationStore`/`ViewStateStore` chỉ nhận `Y.Array`/`Y.Map`
do host cấp; `src/demo/sync.ts` là nơi duy nhất tạo `Y.Doc` + provider.

**Khi migrate**: đây là điểm tích hợp chính. App thật cắm transport/auth/room của
mình vào chỗ của `sync.ts`, rồi trao cấu trúc chia sẻ cho store. **Không** để logic
network rò vào `src/lib`. Truyền phụ thuộc vào (kể cả timer — `ViewSync` cho inject
`setTimeoutFn` để test).

---

## 7. Toạ độ chuẩn hoá 0–1, không lưu pixel

**Nguyên tắc**: annotation lưu 0–1 theo kích thước trang; quy đổi pixel↔normalized
chỉ ở ranh giới render/input (`TextCoordinateUtils`, helper của `PdfRenderer`).

**Khi migrate**: nếu app có schema annotation sẵn (vd theo PDF user-space /
quadPoints), viết lớp adapter ở ranh giới, **đừng** rải phép quy đổi khắp nơi. Chú
ý `NaN → null` khi serialize path của ink.

---

## 8. Ba lớp DOM + `pointer-events` là cách phân luồng "vẽ" vs "chọn chữ"

**Nguyên tắc**: canvas nền (z1) / annotation canvas (z5, pointer-events auto) /
text-layer (z10, container none, span auto). `drawing-active` tắt span khi vẽ.

**Khi migrate**: nếu app chèn thêm overlay (toolbar nổi, comment pin, layer chú
thích riêng), phải soi lại toàn bộ ngăn xếp z-index + pointer-events — chèn sai một
lớp là hỏng cả vẽ lẫn chọn chữ.

---

## 9. Rebuild DOM idempotent; phân biệt "vẽ lại annotation" vs "dựng lại page DOM"

**Nguyên tắc**: `PageController.renderAll/VisiblePages` clear rồi dựng lại đúng
chuỗi trang 1..N (regression Bug3). Nhưng `DemoApp.renderAllPages` **chỉ** vẽ lại
canvas annotation, KHÔNG dựng lại DOM text-layer (nên không phá native selection).

**Khi migrate**: hai thao tác cùng tên "render" ở hai tầng có tác dụng phụ rất
khác (selection, scroll position, editor DOM). Đặc biệt: **không** rebuild DOM
editor freetext trong store-change observer (chạy đồng bộ trong `doc.transact` →
mất focus sau ký tự đầu). Vòng đời editor nên do navigation/view/tool điều khiển.

---

## 10. pdf.js worker & tải PDF

**Khi migrate**: `PdfRenderer` set `GlobalWorkerOptions.workerSrc` từ
`pdfjs-dist/build/pdf.worker.min.mjs?url` (Vite). App production có bundler/CDN
khác → cấu hình `workerSrc` cho đúng (self-host worker để tránh phụ thuộc CDN).
PDF mẫu trong `main.ts` tải từ GitHub (cần mạng); app thật thay bằng nguồn tài liệu
của bạn + xử lý CORS/auth.

---

## 11. Vite: CSS phải import từ JS, KHÔNG dùng `<link>` tĩnh vào file `.ts`/`.css` nguồn

**Vấn đề**: `index.html` nạp `<link rel="stylesheet" href="/src/demo/style.css">`.
Trong Vite **dev**, đường dẫn đó được phục vụ dưới dạng **JS module**
(`content-type: text/javascript`, nội dung mở đầu bằng `import {createHotContext}`),
KHÔNG phải `text/css`. Trình duyệt parse JS-as-CSS → gần như toàn bộ rule bị bỏ.
Bug này có thể ẩn rất lâu nếu các style quan trọng đều là inline (như text-layer
trong `PageController`), chỉ lộ ra khi một rule thuần-CSS (vd `.search-highlight`)
không áp dụng.

**Khi migrate**: nạp CSS bằng `import './style.css'` trong JS entry (đã sửa ở
`main.ts`). Vite sẽ inject đúng ở dev và emit vào bundle ở production
(`dist/assets/index-*.css`). Đừng trỏ `<link>` tới file nguồn trong `src/`.

**Kiểm nhanh**: nếu một CSS rule "có trong file mà không áp dụng", kiểm
`content-type` của file CSS server trả về, và liệt kê `document.styleSheets` xem
rule có được parse không (đừng chỉ tin file trên đĩa).

---

## 12. Highlight text-layer: match trên CHÍNH text span DOM, đừng map qua `item.str`

**Vấn đề**: vẽ search-highlight lên text-layer bằng cách map offset match (tính
trên page text ghép từ `getTextContent().items[].str`) sang glyph span theo giả
định "span khớp 1:1 với item" → highlight **lệch dần** về sau trang. Ba nguồn lệch:
1. Item có `str === ''` KHÔNG tạo span (pdf.js bỏ) → lệch pairing.
2. **Ligature**: pdf.js NFKC-normalize khi render (`ﬁ` → `fi`), span text dài hơn
   `item.str`.
3. Một số span có space thừa đầu/cuối so với `item.str`.

**Cách đúng (bền vững)**: highlighter build "page text" từ **chính `span.textContent`
của các glyph span** (đúng thứ tự DOM), rồi chạy đúng query trên chuỗi đó
(`SearchController.matchText`) → offset khớp span tuyệt đối, độc lập item layout.
Đây cũng là cách pdf.js `TextHighlighter` làm (chạy trên chuỗi đã render). Search
controller vẫn lo `total/current/navigation`; highlighter vẽ độc lập bằng cùng
query. Kiểm parity: `getState().total` phải bằng số `.search-highlight` ở scroll
mode (mọi trang render).

**Bonus**: khi normalize có xoá ký tự (gộp gạch cuối dòng `-\n`), map end-offset
bằng `getOriginalIndex(normEnd - 1) + 1` để match không "nuốt" vùng bị xoá ngay
sau nó.

**Highlight styling**: dùng nền **bán trong suốt** (`rgba(...,0.4)`), KHÔNG force
`color`, để glyph gốc trên canvas hiện xuyên qua. Selector phải đủ specificity
thắng `.text-layer span { color: transparent }` (dùng `.text-layer .search-highlight`).

---

## Checklist migration nhanh

- [ ] Mang **đủ** CSS text-layer + set `--total-scale-factor` (mục 1); chạy test
      alignment.
- [ ] Cấu hình `workerSrc` cho bundler/CDN của app (mục 10).
- [ ] Thay `sync.ts`: transport/auth/room theo id tài liệu thật; lib giữ nguyên
      (mục 5, 6).
- [ ] Đo lại debounce scroll → chỉnh `settleMs` của ViewSync (mục 4).
- [ ] Rà z-index/pointer-events nếu thêm overlay (mục 8).
- [ ] Adapter cho schema annotation nếu khác 0–1 (mục 7).
- [ ] Không rebuild editor freetext trong store observer (mục 9).
- [ ] Nạp CSS qua `import` từ JS, không `<link>` tĩnh vào `src/` (mục 11).
- [ ] Nếu highlight text-layer: match trên span DOM text, không map qua item.str;
      nền bán trong suốt, selector đủ specificity (mục 12).
- [ ] `tsc --noEmit` + `npm test` + `npm run build` + `npx playwright test` xanh.
