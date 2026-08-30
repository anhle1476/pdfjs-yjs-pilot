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

const ROOM_NAME = 'pdfjs-pilot-annotations';
const WS_SERVER_URL = 'ws://localhost:1234';

export const doc = new Y.Doc();
export const yAnnotations = doc.getArray<any>('annotations');
export const provider = new WebsocketProvider(WS_SERVER_URL, ROOM_NAME, doc);

provider.on('status', (event: { status: string }) => {
  console.log('WebSocket status:', event.status);
});
