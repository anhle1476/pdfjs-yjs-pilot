# HighlightPlugin Upgrade Plan - PDF.js Text Highlighting Feature

## Current State Analysis

### HighlightPlugin.ts Limitations
The current `HighlightPlugin.ts` is fundamentally a **drawing tool** rather than a **text highlighter**:

1. **Rectangle-based approach**: Only creates simple rectangles based on mouse coordinates
2. **No text awareness**: Cannot detect text boundaries, characters, or text flow
3. **No text layer integration**: Works independently of PDF.js text layer
4. **Simple outliner**: Creates basic rectangular regions without text geometry understanding

### PDF.js Original Capabilities
The original PDF.js highlight implementation provides:

1. **Text selection**: Detects actual text content and boundaries
2. **Text layer integration**: Works with DOM text nodes and text layer elements
3. **Character/word/line detection**: Understands text layout and flow
4. **Precise outlining**: Creates polygonal paths following text geometry
5. **Selection API usage**: Uses browser Selection API for text detection

## Upgrade Architecture

### Phase 1: Text Layer Integration
**Objective**: Integrate with PDF.js text layer to access text content and layout

#### Components to Implement:
1. **TextLayerService**
   - Interface with PDF.js text layer
   - Text node detection and mapping
   - Coordinate transformation utilities
   - Text boundary calculation

2. **TextSelectionManager**
   - Selection API integration
   - Text range detection
   - Multi-line text support
   - Text flow analysis

#### Key Files to Create/Modify:
```
src/services/TextLayerService.ts
src/services/TextSelectionManager.ts
src/utils/TextCoordinateUtils.ts
```

### Phase 2: Text-Aware Outliner
**Objective**: Replace rectangle-based outliner with text-aware geometry engine

#### Components to Implement:
1. **TextHighlightOutliner**
   - Text box processing algorithms
   - Line break detection
   - Character spacing analysis
   - Polygonal path generation following text geometry

2. **TextBoxAnalyzer**
   - Text box extraction from text layer
   - Overlapping text detection
   - Text flow direction analysis (LTR/RTL)
   - Multi-column text support

#### Key Files to Create/Modify:
```
src/drawers/TextHighlightOutliner.ts
src/analyzers/TextBoxAnalyzer.ts
src/models/TextBox.ts
```

### Phase 3: Enhanced HighlightPlugin
**Objective**: Upgrade existing HighlightPlugin with text highlighting capabilities

#### Core Changes:
1. **Text Selection Mode**
   - Add text selection mode alongside existing rectangle mode
   - Toggle between free-form and text-aware highlighting
   - Preserve backward compatibility

2. **Event Handling Enhancement**
   - Text selection event handling
   - Multi-line selection support
   - Selection boundary detection
   - Real-time text highlighting during selection

3. **Rendering Engine Upgrade**
   - Text-aware highlight rendering
   - Precise text boundary following
   - Multi-fragment highlight support
   - Performance optimization for large selections

#### Modified File:
```
src/plugins/HighlightPlugin.ts (major rewrite)
```

## Technical Implementation Details

### Text Layer Integration Pattern
```typescript
interface TextLayerService {
  getTextNodesInRange(startX: number, startY: number, endX: number, endY: number): TextNode[];
  getTextBounds(textNode: TextNode): DOMRect;
  transformPageToCanvasCoordinates(pageCoords: Point): Point;
  getTextFlowDirection(): 'ltr' | 'rtl';
  getLineHeight(element: Element): number;
}
```

### Text Selection Algorithm
```typescript
class TextSelectionManager {
  private selection: Selection | null = null;
  
  detectTextSelection(startPoint: Point, endPoint: Point): TextRange[] {
    // Algorithm steps:
    // 1. Get text nodes in selection area
    // 2. Calculate text boundaries
    // 3. Handle multi-line selections
    // 4. Account for text flow direction
    // 5. Return array of text ranges with precise coordinates
  }
  
  getTextBoxesFromSelection(): TextBox[] {
    // Convert selection to text boxes
    // Handle partial character selection
    // Merge overlapping boxes
    // Sort by reading order
  }
}
```

### Text-Aware Outliner Algorithm
```typescript
class TextHighlightOutliner {
  createOutlinesFromTextBoxes(textBoxes: TextBox[]): HighlightOutline {
    // Algorithm steps:
    // 1. Sort text boxes by reading order
    // 2. Detect line breaks and paragraph boundaries
    // 3. Calculate precise polygon vertices
    // 4. Handle text spacing and kerning
    // 5. Generate SVG path following text geometry
    // 6. Optimize path for rendering performance
  }
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create TextLayerService with basic text node detection
- [ ] Implement coordinate transformation utilities
- [ ] Add text boundary calculation methods
- [ ] Create unit tests for text layer integration

### Phase 2: Selection Engine (Week 3-4)
- [ ] Implement TextSelectionManager with Selection API
- [ ] Add text range detection algorithms
- [ ] Handle multi-line text selection
- [ ] Integrate with text flow analysis
- [ ] Create performance benchmarks

### Phase 3: Outliner Upgrade (Week 5-6)
- [ ] Develop TextHighlightOutliner algorithm
- [ ] Implement text box analysis engine
- [ ] Add polygon generation following text geometry
- [ ] Handle edge cases (overlapping text, rotated text)
- [ ] Optimize rendering performance

### Phase 4: Plugin Integration (Week 7-8)
- [ ] Rewrite HighlightPlugin with text selection mode
- [ ] Add toggle between rectangle and text modes
- [ ] Implement real-time text highlighting
- [ ] Add backward compatibility layer
- [ ] Create comprehensive test suite

### Phase 5: Polish & Optimization (Week 9-10)
- [ ] Performance optimization for large documents
- [ ] Add accessibility features
- [ ] Implement undo/redo functionality
- [ ] Add keyboard shortcuts for text selection
- [ ] Final testing and bug fixes

## Key Technical Challenges

### 1. Text Coordinate Mapping
**Challenge**: Accurately map between PDF coordinates, DOM coordinates, and canvas coordinates
**Solution**: Implement robust coordinate transformation utilities with error correction

### 2. Multi-Line Selection
**Challenge**: Handle selections that span multiple lines with varying line heights
**Solution**: Develop line detection algorithms that account for different font sizes and spacing

### 3. Text Flow Direction
**Challenge**: Support both LTR and RTL text flows
**Solution**: Implement text direction detection and adjust selection algorithms accordingly

### 4. Performance Optimization
**Challenge**: Maintain smooth performance with large documents and complex selections
**Solution**: Implement efficient text indexing and caching mechanisms

### 5. Cross-Browser Compatibility
**Challenge**: Handle variations in Selection API implementation across browsers
**Solution**: Create browser-specific adapters and fallbacks

## Testing Strategy

### Unit Tests
- Text coordinate transformation accuracy
- Text selection boundary detection
- Outliner algorithm correctness
- Performance benchmarks

### Integration Tests
- Text layer integration functionality
- Multi-line selection scenarios
- Cross-browser compatibility
- Large document performance

### User Experience Tests
- Text selection precision
- Real-time highlighting responsiveness
- Accessibility compliance
- Mobile device compatibility

## Success Metrics

### Functional Metrics
- [ ] Text selection accuracy: >95% precision in detecting text boundaries
- [ ] Multi-line selection support: Handle 100% of multi-line scenarios
- [ ] Performance: <100ms response time for text selection
- [ ] Browser compatibility: Support 95%+ of modern browsers

### User Experience Metrics
- [ ] Selection precision: Users can select individual characters accurately
- [ ] Visual feedback: Real-time highlighting during selection
- [ ] Accessibility: Full keyboard navigation support
- [ ] Mobile support: Touch-friendly text selection on mobile devices

## Migration Strategy

### Backward Compatibility
- Preserve existing rectangle-based functionality
- Add toggle switch for text/rectangle modes
- Maintain existing API compatibility
- Provide migration guide for existing implementations

### Rollout Plan
1. **Alpha Release**: Internal testing with basic text selection
2. **Beta Release**: Community testing with full feature set
3. **Production Release**: Full rollout with performance optimizations
4. **Legacy Deprecation**: Gradual phase-out of rectangle-only mode

## Future Enhancements

### Advanced Features
- **OCR Integration**: Highlight text in scanned documents
- **Multi-Language Support**: Enhanced text analysis for complex scripts
- **AI-Powered Selection**: Smart text boundary detection using ML
- **Collaborative Highlighting**: Real-time shared highlighting

### Performance Improvements
- **Web Workers**: Offload text processing to background threads
- **Incremental Rendering**: Progressive loading for large documents
- **GPU Acceleration**: Hardware-accelerated highlight rendering
- **Memory Optimization**: Efficient memory management for large selections

This upgrade plan transforms the simple rectangle-based HighlightPlugin into a sophisticated text-aware highlighting system that matches PDF.js's native capabilities while maintaining performance and usability standards.