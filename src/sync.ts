import { bind } from 'immer-yjs';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Annotation } from './types';

const doc = new Y.Doc();
const yannotations = doc.getArray<Annotation>('annotations');
const binder = bind(yannotations);

const ROOM_NAME = 'pdfjs-pilot-annotations';
const WS_SERVER_URL = 'ws://localhost:1234';

const provider = new WebsocketProvider(WS_SERVER_URL, ROOM_NAME, doc);

provider.on('status', (event: { status: string }) => {
  console.log('WebSocket status:', event.status);
});

export const sync = {
  subscribe: binder.subscribe,
  update: binder.update,
  get: () => binder.get() as unknown as Annotation[],
  provider,
};

export { doc, yannotations };
