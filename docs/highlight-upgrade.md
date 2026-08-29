# Kế hoạch Nâng cấp HighlightPlugin - Tính năng Tô sáng Văn bản PDF (HighlightPlugin Upgrade Plan)

## Phân tích Trạng thái Hiện tại (Current State Analysis)

### Các hạn chế của HighlightPlugin.ts (HighlightPlugin.ts Limitations)
`HighlightPlugin.ts` hiện tại về cơ bản là một **công cụ vẽ** thay vì một **công cụ tô sáng văn bản**:

1. **Cách tiếp cận dựa trên hình chữ nhật**: Chỉ tạo ra các hình chữ nhật đơn giản dựa trên tọa độ chuột
2. **Không nhận biết văn bản**: Không thể phát hiện ranh giới văn bản, ký tự hoặc luồng văn bản
3. **Không tích hợp lớp văn bản**: Hoạt động độc lập với lớp văn bản (text layer) của PDF.js
4. **Bộ tạo đường bao đơn giản**: Tạo ra các vùng hình chữ nhật cơ bản mà không hiểu hình học văn bản

### Khả năng Gốc của PDF.js (PDF.js Original Capabilities)
Triển khai tô sáng gốc của PDF.js cung cấp:

1. **Lựa chọn văn bản**: Phát hiện nội dung và ranh giới văn bản thực tế
2. **Tích hợp lớp văn bản**: Hoạt động với các nút văn bản DOM và các phần tử lớp văn bản
3. **Phát hiện ký tự/từ/dòng**: Hiểu bố cục và luồng văn bản
4. **Tạo đường bao chính xác**: Tạo ra các đường dẫn đa giác theo hình học văn bản
5. **Sử dụng Selection API**: Sử dụng Selection API của trình duyệt để phát hiện văn bản

## Kiến trúc Nâng cấp (Upgrade Architecture)

### Giai đoạn 1: Tích hợp Lớp Văn bản (Text Layer Integration)
**Mục tiêu**: Tích hợp với lớp văn bản của PDF.js để truy cập nội dung và bố cục văn bản

#### Các Thành phần cần Triển khai:
1. **TextLayerService**
   - Giao tiếp với lớp văn bản của PDF.js
   - Phát hiện và ánh xạ các nút văn bản (text nodes)
   - Các tiện ích chuyển đổi tọa độ
   - Tính toán ranh giới văn bản

2. **TextSelectionManager**
   - Tích hợp Selection API
   - Phát hiện phạm vi văn bản (text range)
   - Hỗ trợ văn bản nhiều dòng
   - Phân tích luồng văn bản

#### Các Tệp Chính cần Tạo/Sửa đổi:
```
src/services/TextLayerService.ts
src/services/TextSelectionManager.ts
src/utils/TextCoordinateUtils.ts
```

### Giai đoạn 2: Bộ tạo Đường bao Nhận biết Văn bản (Text-Aware Outliner)
**Mục tiêu**: Thay thế bộ tạo đường bao dựa trên hình chữ nhật bằng công cụ hình học nhận biết văn bản

#### Các Thành phần cần Triển khai:
1. **TextHighlightOutliner**
   - Các thuật toán xử lý hộp văn bản
   - Phát hiện ngắt dòng
   - Phân tích khoảng cách ký tự
   - Tạo đường dẫn đa giác theo hình học văn bản

2. **TextBoxAnalyzer**
   - Trích xuất hộp văn bản từ lớp văn bản
   - Phát hiện văn bản chồng lấp
   - Phân tích hướng luồng văn bản (LTR/RTL)
   - Hỗ trợ văn bản nhiều cột

#### Các Tệp Chính cần Tạo/Sửa đổi:
```
src/drawers/TextHighlightOutliner.ts
src/analyzers/TextBoxAnalyzer.ts
src/models/TextBox.ts
```

### Giai đoạn 3: HighlightPlugin Nâng cao (Enhanced HighlightPlugin)
**Mục tiêu**: Nâng cấp HighlightPlugin hiện có với các khả năng tô sáng văn bản

#### Các Thay đổi Cốt lõi:
1. **Chế độ Lựa chọn Văn bản (Text Selection Mode)**
   - Thêm chế độ lựa chọn văn bản bên cạnh chế độ hình chữ nhật hiện có
   - Chuyển đổi giữa tô sáng tự do và tô sáng nhận biết văn bản
   - Duy trì khả năng tương thích ngược

2. **Tăng cường Xử lý Sự kiện (Event Handling Enhancement)**
   - Xử lý sự kiện lựa chọn văn bản
   - Hỗ trợ lựa chọn nhiều dòng
   - Phát hiện ranh giới lựa chọn
   - Tô sáng văn bản thời gian thực trong khi lựa chọn

3. **Nâng cấp Công cụ Hiển thị (Rendering Engine Upgrade)**
   - Hiển thị phần tô sáng nhận biết văn bản
   - Theo sát ranh giới văn bản chính xác
   - Hỗ trợ tô sáng nhiều phân đoạn
   - Tối ưu hóa hiệu suất cho các lựa chọn lớn

#### Tệp Sửa đổi:
```
src/plugins/HighlightPlugin.ts (viết lại phần lớn)
```

## Chi tiết Triển khai Kỹ thuật (Technical Implementation Details)

### Mẫu Tích hợp Lớp Văn bản (Text Layer Integration Pattern)
```typescript
interface TextLayerService {
  getTextNodesInRange(startX: number, startY: number, endX: number, endY: number): TextNode[];
  getTextBounds(textNode: TextNode): DOMRect;
  transformPageToCanvasCoordinates(pageCoords: Point): Point;
  getTextFlowDirection(): 'ltr' | 'rtl';
  getLineHeight(element: Element): number;
}
```

### Thuật toán Lựa chọn Văn bản (Text Selection Algorithm)
```typescript
class TextSelectionManager {
  private selection: Selection | null = null;
  
  detectTextSelection(startPoint: Point, endPoint: Point): TextRange[] {
    // Các bước thuật toán:
    // 1. Lấy các nút văn bản trong vùng lựa chọn
    // 2. Tính toán ranh giới văn bản
    // 3. Xử lý lựa chọn nhiều dòng
    // 4. Tính đến hướng luồng văn bản
    // 5. Trả về mảng các phạm vi văn bản với tọa độ chính xác
  }
  
  getTextBoxesFromSelection(): TextBox[] {
    // Chuyển đổi lựa chọn thành các hộp văn bản
    // Xử lý lựa chọn ký tự một phần
    // Hợp nhất các hộp chồng lấp
    // Sắp xếp theo thứ tự đọc
  }
}
```

### Thuật toán Bộ tạo Đường bao Nhận biết Văn bản (Text-Aware Outliner Algorithm)
```typescript
class TextHighlightOutliner {
  createOutlinesFromTextBoxes(textBoxes: TextBox[]): HighlightOutline {
    // Các bước thuật toán:
    // 1. Sắp xếp các hộp văn bản theo thứ tự đọc
    // 2. Phát hiện ngắt dòng và ranh giới đoạn văn
    // 3. Tính toán các đỉnh đa giác chính xác
    // 4. Xử lý khoảng cách văn bản và kerning
    // 5. Tạo đường dẫn SVG theo hình học văn bản
    // 6. Tối ưu hóa đường dẫn cho hiệu suất hiển thị
  }
}
```

## Các Giai đoạn Triển khai (Implementation Phases)

### Giai đoạn 1: Nền tảng (Foundation) (Tuần 1-2)
- [ ] Tạo TextLayerService với khả năng phát hiện nút văn bản cơ bản
- [ ] Triển khai các tiện ích chuyển đổi tọa độ
- [ ] Thêm các phương thức tính toán ranh giới văn bản
- [ ] Tạo các kiểm thử đơn vị cho tích hợp lớp văn bản

### Giai đoạn 2: Công cụ Lựa chọn (Selection Engine) (Tuần 3-4)
- [ ] Triển khai TextSelectionManager với Selection API
- [ ] Thêm các thuật toán phát hiện phạm vi văn bản
- [ ] Xử lý lựa chọn văn bản nhiều dòng
- [ ] Tích hợp với phân tích luồng văn bản
- [ ] Tạo các điểm chuẩn (benchmarks) hiệu suất

### Giai đoạn 3: Nâng cấp Bộ tạo Đường bao (Outliner Upgrade) (Tuần 5-6)
- [ ] Phát triển thuật toán TextHighlightOutliner
- [ ] Triển khai công cụ phân tích hộp văn bản
- [ ] Thêm tính năng tạo đa giác theo hình học văn bản
- [ ] Xử lý các trường hợp biên (văn bản chồng lấp, văn bản bị xoay)
- [ ] Tối ưu hóa hiệu suất hiển thị

### Giai đoạn 4: Tích hợp Plugin (Plugin Integration) (Tuần 7-8)
- [ ] Viết lại HighlightPlugin với chế độ lựa chọn văn bản
- [ ] Thêm nút chuyển đổi giữa chế độ hình chữ nhật và văn bản
- [ ] Triển khai tô sáng văn bản thời gian thực
- [ ] Thêm lớp tương thích ngược
- [ ] Tạo bộ kiểm thử toàn diện

### Giai đoạn 5: Hoàn thiện & Tối ưu hóa (Polish & Optimization) (Tuần 9-10)
- [ ] Tối ưu hóa hiệu suất cho các tài liệu lớn
- [ ] Thêm các tính năng hỗ trợ tiếp cận (accessibility)
- [ ] Triển khai chức năng hoàn tác/làm lại (undo/redo)
- [ ] Thêm các phím tắt cho lựa chọn văn bản
- [ ] Kiểm thử cuối cùng và sửa lỗi

## Thách thức Kỹ thuật Chính (Key Technical Challenges)

### 1. Ánh xạ Tọa độ Văn bản (Text Coordinate Mapping)
**Thách thức**: Ánh xạ chính xác giữa tọa độ PDF, tọa độ DOM và tọa độ canvas
**Giải pháp**: Triển khai các tiện ích chuyển đổi tọa độ mạnh mẽ với khả năng sửa lỗi

### 2. Lựa chọn Nhiều dòng (Multi-Line Selection)
**Thách thức**: Xử lý các lựa chọn trải dài trên nhiều dòng với độ cao dòng khác nhau
**Giải pháp**: Phát triển các thuật toán phát hiện dòng có tính đến các kích thước phông chữ và khoảng cách khác nhau

### 3. Hướng Luồng Văn bản (Text Flow Direction)
**Thách thức**: Hỗ trợ cả luồng văn bản LTR và RTL
**Giải pháp**: Triển khai phát hiện hướng văn bản và điều chỉnh các thuật toán lựa chọn tương ứng

### 4. Tối ưu hóa Hiệu suất (Performance Optimization)
**Thách thức**: Duy trì hiệu suất mượt mà với các tài liệu lớn và các lựa chọn phức tạp
**Giải pháp**: Triển khai các cơ chế lập chỉ mục và lưu trữ đệm (caching) văn bản hiệu quả

### 5. Tương thích Đa trình duyệt (Cross-Browser Compatibility)
**Thách thức**: Xử lý các biến thể trong việc triển khai Selection API trên các trình duyệt khác nhau
**Giải pháp**: Tạo các bộ điều hợp (adapters) và phương án dự phòng (fallbacks) riêng cho từng trình duyệt

## Chiến lược Kiểm thử (Testing Strategy)

### Kiểm thử Đơn vị (Unit Tests)
- Độ chính xác của chuyển đổi tọa độ văn bản
- Phát hiện ranh giới lựa chọn văn bản
- Tính đúng đắn của thuật toán bộ tạo đường bao
- Các điểm chuẩn hiệu suất

### Kiểm thử Tích hợp (Integration Tests)
- Chức năng tích hợp lớp văn bản
- Các kịch bản lựa chọn nhiều dòng
- Khả năng tương thích đa trình duyệt
- Hiệu suất trên tài liệu lớn

### Kiểm thử Trải nghiệm Người dùng (User Experience Tests)
- Độ chính xác của lựa chọn văn bản
- Khả năng phản hồi của tính năng tô sáng thời gian thực
- Tuân thủ các tiêu chuẩn hỗ trợ tiếp cận
- Khả năng tương thích với thiết bị di động

## Chỉ số Thành công (Success Metrics)

### Chỉ số Chức năng (Functional Metrics)
- [ ] Độ chính xác lựa chọn văn bản: độ chính xác >95% trong việc phát hiện ranh giới văn bản
- [ ] Hỗ trợ lựa chọn nhiều dòng: Xử lý 100% các kịch bản nhiều dòng
- [ ] Hiệu suất: thời gian phản hồi <100ms cho việc lựa chọn văn bản
- [ ] Tương thích trình duyệt: Hỗ trợ hơn 95% các trình duyệt hiện đại

### Chỉ số Trải nghiệm Người dùng (User Experience Metrics)
- [ ] Độ chính xác lựa chọn: Người dùng có thể chọn chính xác từng ký tự
- [ ] Phản hồi trực quan: Tô sáng thời gian thực trong khi lựa chọn
- [ ] Hỗ trợ tiếp cận: Hỗ trợ đầy đủ điều hướng bằng bàn phím
- [ ] Hỗ trợ di động: Lựa chọn văn bản thân thiện với cảm ứng trên thiết bị di động

## Chiến lược Di chuyển (Migration Strategy)

### Khả năng Tương thích Ngược (Backward Compatibility)
- Duy trì chức năng dựa trên hình chữ nhật hiện có
- Thêm công tắc chuyển đổi cho các chế độ văn bản/hình chữ nhật
- Duy trì khả năng tương thích API hiện có
- Cung cấp hướng dẫn di chuyển cho các triển khai hiện tại

### Kế hoạch Triển khai (Rollout Plan)
1. **Bản Alpha**: Kiểm thử nội bộ với lựa chọn văn bản cơ bản
2. **Bản Beta**: Kiểm thử cộng đồng với đầy đủ các tính năng
3. **Bản Production**: Triển khai đầy đủ với các tối ưu hóa hiệu suất
4. **Ngừng hỗ trợ bản cũ**: Loại bỏ dần chế độ chỉ hình chữ nhật

## Cải tiến Tương lai (Future Enhancements)

### Các tính năng Nâng cao (Advanced Features)
- **Tích hợp OCR**: Tô sáng văn bản trong các tài liệu đã quét
- **Hỗ trợ Đa ngôn ngữ**: Tăng cường phân tích văn bản cho các hệ chữ phức tạp
- **Lựa chọn do AI hỗ trợ**: Phát hiện ranh giới văn bản thông minh bằng ML
- **Tô sáng Cộng tác**: Chia sẻ tô sáng thời gian thực

### Cải thiện Hiệu suất (Performance Improvements)
- **Web Workers**: Chuyển việc xử lý văn bản sang các luồng nền
- **Kết xuất Tăng dần (Incremental Rendering)**: Tải dần cho các tài liệu lớn
- **Tăng tốc GPU**: Hiển thị tô sáng được tăng tốc bằng phần cứng
- **Tối ưu hóa Bộ nhớ**: Quản lý bộ nhớ hiệu quả cho các lựa chọn lớn

Kế hoạch nâng cấp này chuyển đổi HighlightPlugin đơn giản dựa trên hình chữ nhật thành một hệ thống tô sáng nhận biết văn bản tinh vi, tương xứng với khả năng gốc của PDF.js trong khi vẫn duy trì các tiêu chuẩn về hiệu suất và khả năng sử dụng.