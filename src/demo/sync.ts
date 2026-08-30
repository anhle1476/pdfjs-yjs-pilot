// Demo app networking layer.
//
// This is the ONLY place the demo app wires up Yjs. The lib (src/lib) never
// creates a Y.Doc or touches y-websocket — the host app (this demo) owns the
// document and the network provider, and simply hands the shared Y.Array of
// annotations to the lib's AnnotationStore.
//
// Room name / port are kept identical to the previous app so the demo still
// works against `npm run server` (the bundled y-websocket server).

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const DEFAULT_ROOM_NAME = 'pdfjs-pilot-annotations';
const WS_SERVER_URL = 'ws://localhost:1234';

// The room name defaults to the shared pilot room, but can be overridden via a
// `?room=` query parameter. This lets automated tests isolate their own room
// so authoritative view state (view mode, zoom, rotation, page) does not leak
// between otherwise-independent sessions. Production/demo usage is unchanged.
function resolveRoomName(): string {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room) return room;
    }
  } catch {
    /* ignore — fall back to default */
  }
  return DEFAULT_ROOM_NAME;
}

const ROOM_NAME = resolveRoomName();

export const doc = new Y.Doc();
export const yAnnotations = doc.getArray<any>('annotations');
export const provider = new WebsocketProvider(WS_SERVER_URL, ROOM_NAME, doc);

// View state (view mode, zoom, rotation, page) is replicated via the provider's
// *Awareness* — ephemeral presence state that is NOT written into the Y.Doc, so
// frequent scroll/zoom/rotate actions do not bloat the CRDT history. Annotations
// remain in the Y.Doc (yAnnotations) as authoritative, persisted data.
export const awareness = provider.awareness;

// Stable per-tab client id, used as the ViewSync local origin.
export const clientId = `client-${doc.clientID}`;

provider.on('status', (event: { status: string }) => {
  console.log('WebSocket status:', event.status);
});
