# FreeTextPlugin Migration Guide

## Overview

This document describes the migration from the legacy `FreeTextEditor` implementation in `display/editor/freetext.js` to the new `FreeTextPlugin` architecture in `src/plugins/FreeTextPlugin.ts`.

## Architecture Comparison

### Legacy Architecture (freetext.js)

```
FreeTextEditor (AnnotationEditor subclass)
├── Uses contentEditable div for text editing
├── Integrated with AnnotationEditorLayer
├── Uses static methods for defaults (initialize, updateDefaultParams)
└── Complex keyboard event handling via KeyboardManager
```

### New Plugin Architecture (FreeTextPlugin)

```
FreeTextPlugin (implements IToolPlugin)
├── Uses DOM-based contentEditable for text input
├── Integrates with PdfPilot via sharedStore
├── Full IToolPlugin interface implementation
└── Sync-ready via Yjs integration
```

## Key Differences

### 1. Plugin Interface Compliance

The new `FreeTextPlugin` implements the `IToolPlugin` interface:

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

### 2. Data Model

The `FreeTextObject` class provides serialization support:

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

### 3. DOM vs Canvas Rendering

- **Legacy**: Renders directly via the editor's `render()` method returning a DOM div
- **New**: Uses a separate `_editorContainer` overlay for DOM-based text editing while canvas is used for annotation layer

## Migration Steps

### Step 1: Import the Plugin

```typescript
import { FreeTextPlugin } from './plugins/FreeTextPlugin';
import { FreeTextObject } from './models/FreeTextObject';
```

### Step 2: Initialize the Plugin

```typescript
// Add to sharedStore (same store used by InkPlugin and HighlightPlugin)
private sharedStore: AnnotationObject[] = [];
private freeTextPlugin: FreeTextPlugin;

constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
  this.freeTextPlugin = new FreeTextPlugin(this.sharedStore, {
    defaultFontSize: 10,
    defaultColor: '#000000',
  });
}
```

### Step 3: Activate on Current Page

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

### Step 4: Add Event Listeners

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

### Step 5: Handle Page Changes

```typescript
private setupAnnotationPluginsForCurrentPage(): void {
  this.freeTextPlugin.setPageNumber(this.currentPageNumber);
  this.freeTextPlugin.deactivate();
  this.freeTextPlugin.activate(currentPageView.annotationCanvas, ctx);
  this.setupAnnotationEventListeners(currentPageView.annotationCanvas);
  this.renderAnnotationsForCurrentPage();
}
```

## API Reference

### FreeTextPlugin Methods

| Method | Description |
|--------|-------------|
| `activate(canvas, context)` | Initialize the plugin with a canvas |
| `deactivate()` | Clean up resources |
| `setPageNumber(page)` | Switch to a different page |
| `getPageNumber()` | Get current page number |
| `onPointerDown(evt)` | Handle pointer down event |
| `onPointerMove(evt)` | Handle pointer move event |
| `onPointerUp(evt)` | Handle pointer up event |
| `getObjects()` | Get annotations for current page |
| `getAllObjects()` | Get all annotations |
| `getData()` | Serialize all objects |
| `setData(data)` | Restore objects from serialized data |
| `validate()` | Validate all objects |
| `initialize(container)` | Set up editor container |
| `destroy()` | Clean up and deactivate |
| `commitAll()` | Commit all active editors |

### FreeTextPlugin Options

```typescript
interface FreeTextPluginOptions {
  defaultFontSize?: number;  // Default: 10
  defaultColor?: string;     // Default: '#000000'
  container?: HTMLElement;    // Optional custom container
}
```

### FreeTextPlugin Callbacks

```typescript
onRenderNeeded?: () => void;          // Called when re-render is needed
onObjectCreated?: (obj: FreeTextObject) => void;   // Called when object is created
onObjectUpdated?: (obj: FreeTextObject) => void;   // Called when object is updated
onObjectDeleted?: (obj: FreeTextObject) => void;   // Called when object is deleted
```

### FreeTextObject Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique identifier |
| `content` | `string` | Text content |
| `fontSize` | `number` | Font size in pixels |
| `color` | `string` | Text color (hex) |
| `bounds` | `Rect` | Position and dimensions (normalized 0-1) |
| `pageNumber` | `number` | Page index |

### FreeTextObject Methods

| Method | Description |
|--------|-------------|
| `hitTest(x, y)` | Check if point is within bounds |
| `getBounds()` | Get bounds (copy) |
| `move(dx, dy)` | Translate annotation |
| `resize(anchor, dx, dy)` | Resize from anchor (n/s/e/w/nw/ne/se/sw) |
| `serialize()` | Convert to JSON-serializable object |
| `deserialize(data)` | Restore from serialized data |
| `setContent(content)` | Set text content |
| `getContent()` | Get text content |
| `isEmpty()` | Check if content is empty/whitespace |

## Serialization Format

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

## Integration with Sync Layer

The `FreeTextPlugin` integrates with the Yjs sync layer through the shared store:

```typescript
this.freeTextPlugin.onObjectCreated = (obj) => {
  sync.update((draft: unknown) => {
    (draft as Annotation[]).push(obj.serialize());
  });
};
```

When receiving remote updates:

```typescript
sync.subscribe((annotations) => {
  const freetextData = annotations.filter(a => a.type === 'freetext');
  this.freeTextPlugin.setData(freetextData);
});
```

## Breaking Changes

1. **No direct DOM access**: The plugin manages its own editor container internally
2. **Callback-based events**: Use `onObjectCreated`, `onObjectUpdated`, `onObjectDeleted` callbacks instead of events
3. **Normalized coordinates**: Bounds are normalized (0-1) instead of pixel values
4. **Page-based organization**: Objects are filtered by `pageNumber`

## Testing

Run tests with:

```bash
npx vitest run tests/FreeTextPlugin.test.ts
```

Run with coverage:

```bash
npx vitest run --coverage
```

## File Structure

```
src/
├── models/
│   └── FreeTextObject.ts      # Data model
├── plugins/
│   └── FreeTextPlugin.ts      # Main plugin implementation
└── types.ts                   # Updated with FreeTextData interface
```

## Comparison with Other Plugins

| Feature | InkPlugin | HighlightPlugin | FreeTextPlugin |
|---------|-----------|-----------------|----------------|
| Drawing mode | Freehand | Box/Freehand | Click/drag |
| Rendering | Canvas Path2D | Canvas fill | DOM overlay |
| Preview | Yes | Yes | Yes (bounds only) |
| Sync-ready | Yes | Yes | Yes |
| Data format | paths[] | paths[] | content string |