import * as Y from 'yjs';

/**
 * In-memory mock of a y-websocket "room".
 *
 * Instead of opening a real WebSocket connection to a y-websocket server,
 * this helper simulates the server at the *logic* level: it relays Yjs
 * document updates between every connected client using the standard Yjs
 * update protocol (`doc.on('update', ...)` -> `Y.applyUpdate(...)`).
 *
 * This is exactly how Yjs' own tests simulate multiple peers — no socket,
 * no `ws` library. Any number of clients created from the same room will
 * converge to the same state, just like real clients on a real y-websocket
 * server.
 *
 * Unlike the original repo's helper, this version has NO dependency on
 * `immer-yjs` (which has been removed). It exposes the raw `Y.Array` so tests
 * can drive it through the lib's AnnotationStore, matching production.
 */

export interface MockSyncClient {
  /** The client's own Y.Doc. */
  doc: Y.Doc;
  /** The 'annotations' Y.Array on this client's doc. */
  annotationsArray: Y.Array<any>;
  /** Read the current annotations as a plain array. */
  get: () => any[];
  /** Stop relaying updates for this client. */
  disconnect: () => void;
}

export interface MockSyncRoom {
  /** Create and connect a new client to this room. */
  createClient: () => MockSyncClient;
  /** Disconnect and destroy every client in the room. */
  destroy: () => void;
}

/**
 * Create an in-memory sync room that relays Yjs updates between all clients.
 */
export function createMockSyncRoom(): MockSyncRoom {
  const clients: {
    client: MockSyncClient;
    onUpdate: (update: Uint8Array, origin: unknown) => void;
  }[] = [];

  const createClient = (): MockSyncClient => {
    const doc = new Y.Doc();
    const annotationsArray = doc.getArray<any>('annotations');

    // Relay this doc's updates to every *other* client in the room.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'mock-sync-relay') return;
      for (const entry of clients) {
        if (entry.client.doc === doc) continue;
        Y.applyUpdate(entry.client.doc, update, 'mock-sync-relay');
      }
    };

    doc.on('update', onUpdate);

    const client: MockSyncClient = {
      doc,
      annotationsArray,
      get: () => annotationsArray.toArray(),
      disconnect: () => {
        doc.off('update', onUpdate);
        const idx = clients.findIndex((c) => c.client === client);
        if (idx !== -1) clients.splice(idx, 1);
      },
    };

    // New client should sync with the current room state immediately.
    const peer = clients[0];
    if (peer) {
      const state = Y.encodeStateAsUpdate(peer.client.doc);
      Y.applyUpdate(doc, state, 'mock-sync-relay');
    }

    clients.push({ client, onUpdate });
    return client;
  };

  const destroy = () => {
    for (const entry of [...clients]) {
      entry.client.disconnect();
      entry.client.doc.destroy();
    }
    clients.length = 0;
  };

  return { createClient, destroy };
}
