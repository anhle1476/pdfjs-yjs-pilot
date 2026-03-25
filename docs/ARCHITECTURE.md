# PDF.js Pilot - Architecture Documentation

## Overview

This document describes the updated architecture of PDF.js Pilot, including the new plugin-based annotation system with `IToolPlugin` / `AnnotationObject`, real-time sync via Yjs, and how data flows through the application.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser Tab                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        Application Layer                               │  │
│  │                                                                        │  │
│  │   ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐      │  │
│  │   │  Sidebar    │     │   Tools     │     │      PdfPilot       │      │  │
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
│  │                       Sync Layer (sync.ts)                             │  │
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
│                    y-websocket Server (port 1234)                             │
└───────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Broadcast to all connected clients
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Another Browser Tab                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │   Same Architecture - Different Instance                               │  │
│  │                                                                        │  │
│  │   Y.Doc ◀──WebsocketProvider──▶ Annotations sync automatically         │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Plugin System Architecture

### IToolPlugin Interface

All annotation tools implement the `IToolPlugin` interface, providing a unified lifecycle and event handling contract.

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

### AnnotationObject Base Class

`AnnotationObject` is the abstract base for all drawable annotation objects. It declares the contract for geometric manipulation and persistence.

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

### InkPlugin and InkObject

`InkPlugin` implements `IToolPlugin` for the freehand ink drawing tool. It uses `InkDrawOutliner` from the drawers module to build SVG path data and produces `InkObject` instances.

**InkObject** stores:
- `id`: Unique identifier
- `paths`: Array of `{ line: number[], points: number[] }` - normalized path data
- `color`: Stroke color (hex)
- `strokeWidth`: Stroke thickness
- `bounds`: Bounding rectangle `{ x, y, width, height }`

```typescript
export class InkObject extends AnnotationObject {
  hitTest(x, y): boolean        // Point-in-path proximity check with margin
  getBounds(): Rect             // Returns precomputed bounding box
  move(dx, dy): void            // Translates all path points and bounds
  resize(anchor, dx, dy): void  // Scales paths relative to anchor (n/s/e/w)
  serialize(): any              // Returns JSON-serializable object (NaN → null)
  deserialize(data): void        // Restores object from serialized data (null → NaN)
  render(ctx, w, h): void      // Draws bezier curves to canvas using normalized coords
}

export class InkPlugin implements IToolPlugin {
  // Holds the shared annotation store
  private store: AnnotationObject[];

  // Pointer event handlers delegate to InkDrawOutliner
  onPointerDown(evt): void;
  onPointerMove(evt): void;
  onPointerUp(evt): void;   // Pushes completed InkObject into sharedStore

  render(ctx): void;        // Clears canvas, renders all InkObjects + preview
  getObjects(): AnnotationObject[];
}
```

**Key Design Decision**: Completed `InkObject` instances are pushed into a `sharedStore` (an `AnnotationObject[]`). This store is the single source of truth used for rendering and is the bridge to the sync layer.

## PdfPilot Integration

`PdfPilot` owns the `annotationCanvas` and initializes `InkPlugin` with a shared store:

```typescript
private sharedStore: AnnotationObject[] = [];
private inkPlugin: InkPlugin;

constructor(container: HTMLElement, options: PdfPilotOptions = {}) {
  this.inkPlugin = new InkPlugin(this.sharedStore);
  // ...
}

private setupToolManager() {
  // ToolManager handles non-ink tools (text, highlight)
  // Ink tool is handled directly by InkPlugin via pointer events
  this.annotationCanvas.addEventListener('pointerdown', (e) => {
    if (this.toolManager?.getTool() === 'ink') this.inkPlugin.onPointerDown(e);
  });
  // ... similarly for pointermove / pointerup
}
```

`renderAnnotations()` delegates entirely to the plugin:

```typescript
private renderAnnotations(): void {
  const ctx = this.annotationCanvas.getContext('2d');
  if (!ctx) return;
  if (this.inkPlugin) {
    this.inkPlugin.render(ctx);
  }
}
```

## Sync Layer

The sync layer (`sync.ts`) binds the `sharedStore` to a Yjs `Y.Array` so that all annotation objects (via their `serialize()` output) are broadcast to peers.

```typescript
export const sync = {
  subscribe: binder.subscribe,    // Listen for remote changes
  update: binder.update,          // Apply local changes (immer-style)
  get: () => binder.get(),        // Current annotation list
  provider,                       // WebsocketProvider for real-time transport
};
```

When a new `InkObject` is pushed into `sharedStore` by `InkPlugin.onPointerUp()`, the sync layer distributes it to all peers. When a remote change arrives via WebSocket, `binder.update()` merges it back into `sharedStore`.

## Data Flow: Ink Drawing

```
User drags on canvas
    │
    ▼
InkPlugin.onPointerDown()
    │ Creates InkDrawOutliner with normalized coords
    ▼
InkPlugin.onPointerMove()
    │ outliner.add() generates SVG path segment
    │ previewPath updated → render() draws live preview
    ▼
InkPlugin.onPointerUp()
    │ outliner.end() finalizes paths
    │ new InkObject(id, paths, color, strokeWidth) created
    │ sharedStore.push(inkObject)        ← stored for sync & render
    ▼
render() called via onRenderNeeded
    │ Iterates sharedStore
    │ Calls obj.render(ctx, w, h) for each InkObject
    │ Draws previewPath if active
    ▼
Sync Layer
    │ inkObject.serialize() → Yjs update → WebSocket broadcast
    ▼
Other Peers
    │ Receive Yjs update
    │ sharedStore updated via sync.update()
    │ render() redraws with new InkObject
```

## Data Model

### AnnotationObject Serialization Format

InkObjects serialize to a JSON-compatible representation for the sync layer:

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

**Note**: `NaN` values in path `line` arrays are serialized as `null` (JSON does not support `NaN`). On `deserialize()`, `null` values are restored back to `NaN` to maintain the InkDrawOutliner contract.

### Rect Interface

```typescript
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## File Structure

```
pdfjs-pilot/
├── src/
│   ├── main.ts                  # Entry point
│   ├── PdfPilot.ts              # Main PDF viewer + annotation orchestration
│   ├── tools.ts                 # ToolManager (text/highlight)
│   ├── sync.ts                  # Yjs + immer-yjs + WebsocketProvider binding
│   ├── ui.ts                    # Sidebar UI
│   ├── types.ts                 # Shared TypeScript types (Annotation, InkData, etc.)
│   ├── drawers/
│   │   ├── InkDrawOutliner.ts   # Bezier path builder (InkDrawOutliner)
│   │   └── Outline.ts          # Static utilities for normalization & bezier math
│   └── plugins/
│       ├── IToolPlugin.ts       # IToolPlugin interface + AnnotationObject base class
│       ├── InkPlugin.ts        # InkPlugin + InkObject implementation
│       └── HighlightPlugin.ts  # HighlightPlugin + HighlightObject implementation
├── tests/
│   ├── InkPlugin.test.ts        # Unit tests for InkObject and InkPlugin
│   └── HighlightPlugin.test.ts   # Unit tests for HighlightObject and HighlightPlugin
├── vitest.config.ts             # Test configuration
└── ARCHITECTURE.md              # This document
```

## Tool to Data Mapping

### Ink (Draw) Tool

**User Action**: Click and drag on annotation canvas

**Plugin**: `InkPlugin`

**Data Created**: `InkObject` with:
- `paths`: Bezier curve control points from `InkDrawOutliner` (normalized 0–1)
- `strokeWidth`: Configurable thickness
- `color`: Selected stroke color

**Sync**: `InkObject.serialize()` output is pushed into Yjs array

### Text Tool

**Plugin**: Handled directly by `ToolManager` in `tools.ts`

**Data Created**: `Annotation` with `type: 'text'`

### Highlight Tool

**Plugin**: `HighlightPlugin`

**Data Created**: `HighlightObject` with:
- `paths`: Polygon outline data from `HighlightOutliner` (normalized 0–1)
- `color`: Selected highlight color
- `opacity`: Highlight transparency (0-1)
- `quadPoints`: Optional PDF quad points for serialization

**Sync**: `HighlightObject.serialize()` output is pushed into Yjs array

**Key Differences from Ink**:
- Highlight uses rectangular selection (drag to create) rather than freehand drawing
- `HighlightOutliner` performs sweep-line algorithm to compute polygon union
- `HighlightObject` renders with semi-transparent fill (not stroke)

## Sync Mechanism

### y-websocket Provider

```typescript
import { WebsocketProvider } from 'y-websocket';

const provider = new WebsocketProvider('ws://localhost:1234', 'pdfjs-pilot-annotations', doc);
```

### How Sync Works

1. Client connects to WebSocket server at `ws://localhost:1234`
2. Server distributes document updates to all clients in the same room
3. Room-based sharing: same room name = shared document state

### Sync Flow

```
Tab A                                Server                         Tab B
  │                                     │                               │
  │  InkPlugin.onPointerUp()            │                               │
  │  sharedStore.push(inkObject)        │                               │
  │                                     │                               │
  ▼                                     │                               │
Y.Doc updated                           │                               │
  │                                     │                               │
  ├─────────────────────────────────────┼───────────────────────────────┤
  │                                     │                               │
  ▼                                     ▼                               ▼
WebSocket send                     Server                    WebSocket receive
to server                      (relay to room)                 from server
  │                                     │                               │
  └─────────────────────────────────────┼───────────────────────────────┘
                                        │
                                        ▼
                              All clients in room
                              receive the update
                              sharedStore updated
                              render() redraws
```

## Running the WebSocket Server

```bash
# Start the server on port 1234
HOST=localhost PORT=1234 npx y-websocket
```

## Dependencies

```json
{
  "yjs": "^13.6.21",         // CRDT implementation
  "y-websocket": "^3.0.0",   // WebSocket sync provider
  "immer-yjs": "^1.2.0",     // immer-style Yjs binding
  "pdfjs-dist": "^5.5.207",  // PDF rendering
  "vitest": "^4.1.1",        // Unit testing
  "jsdom":                  // DOM environment for tests
}
```

## Configuration

### Client-side (sync.ts)

```typescript
const ROOM_NAME = 'pdfjs-pilot-annotations';
const WS_SERVER_URL = 'ws://localhost:1234';
```

### Server-side (Environment Variables)

```bash
HOST=localhost
PORT=1234
YPERSISTENCE=./dbDir  # Optional: Enable LevelDB persistence
```
