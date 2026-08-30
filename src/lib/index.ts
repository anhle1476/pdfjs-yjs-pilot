// Public surface for the pdf-annotation lib.
//
// This lib is a pure API layer intended to be copied into a host application.
// It has NO UI dependency, does NOT manage the Yjs network (the host supplies a
// Y.Array), and installs NO global input listeners — the sole exception being
// FreeTextTool, which owns its intrinsic contentEditable DOM input UI.

// Renderer (render/view only)
export { PdfRenderer } from './PdfRenderer';
export type { PdfRendererOptions, PageView, ViewMode } from './PdfRenderer';

// Annotation persistence over a host-owned Y.Array
export { AnnotationStore } from './AnnotationStore';

// View-state replication over a host-owned Yjs Awareness (ephemeral presence).
// View state is NOT written into the Y.Doc — see ViewStateAwareness for why.
export { ViewStateAwareness, DEFAULT_VIEW_STATE, VIEW_FIELD, REMOTE_ORIGIN } from './ViewStateAwareness';
export type {
  ViewState,
  ViewModeState,
  AwarenessLike,
  ViewStateSource,
} from './ViewStateAwareness';

// Hit testing
export { HitTester, hitTest } from './HitTester';
export type { HitTestResult } from './HitTester';

// Text-layer / text-selection services (framework-free)
export { TextLayerService } from './services/TextLayerService';
export type { TextNodeInfo } from './services/TextLayerService';
export { TextSelectionManager } from './services/TextSelectionManager';
export type { SelectedTextRange } from './services/TextSelectionManager';

// PDF Search (Ctrl+F replacement) — framework-free port of pdf.js find
export { SearchController, normalize, getOriginalIndex } from './services/SearchController';
export type {
  SearchOptions,
  SearchStatus,
  SearchState,
  SelectedMatch,
  PageMatch,
  SearchControllerDeps,
  SearchNavigationFacade,
  SearchDocumentProxy,
  SearchPageProxy,
  SearchTextItem,
  NormalizeResult,
} from './services/SearchController';

// Table of Contents (outline) — framework-free
export { OutlineController } from './services/OutlineController';
export type {
  OutlineItem,
  OutlineControllerDeps,
  OutlineNavigationFacade,
  OutlineDocumentProxy,
  RawOutlineNode,
} from './services/OutlineController';

// Coordinate utilities
export { TextCoordinateUtils } from './utils/TextCoordinateUtils';
export type { Point } from './utils/TextCoordinateUtils';

// Tools
export { InkTool } from './tools/InkTool';
export type { InkToolOptions, InkToolState } from './tools/InkTool';

export { HighlightTool } from './tools/HighlightTool';
export type {
  HighlightToolOptions,
  HighlightToolState,
  HighlightMode,
  TextRange,
} from './tools/HighlightTool';

export { FreeTextTool } from './tools/FreeTextTool';
export type { FreeTextToolOptions, FreeTextToolState } from './tools/FreeTextTool';

// Models
export { AnnotationObject } from './models/AnnotationObject';
export type { Rect } from './models/AnnotationObject';
export { InkObject } from './models/InkObject';
export type { InkPath, InkObjectData } from './models/InkObject';
export { HighlightObject } from './models/HighlightObject';
export type { HighlightPath, HighlightObjectData } from './models/HighlightObject';
export { FreeTextObject } from './models/FreeTextObject';
export type { FreeTextObjectData } from './models/FreeTextObject';
