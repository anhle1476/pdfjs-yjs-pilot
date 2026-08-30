import { bind } from "immer-yjs";
import * as Y from "yjs";
import type { Annotation } from "../../src/types";

/**
 * In-memory mock of a y-websocket "room".
 *
 * Instead of opening a real WebSocket connection to a y-websocket server,
 * this helper simulates the server at the *logic* level: it relays Yjs
 * document updates between every connected client using the standard Yjs
 * update protocol (`doc.on('update', ...)` -> `Y.applyUpdate(...)`).
 *
 * This is exactly how Yjs' own tests simulate multiple peers — no socket,
 * no `ws` library, no `net.Server` required. Any number of clients created
 * from the same room will converge to the same state, just like real clients
 * connected to the same room on a real y-websocket server.
 */

export interface MockSyncClient {
	/** The client's own Y.Doc. */
	doc: Y.Doc;
	/** The 'annotations' Y.Array on this client's doc. */
	annotationsArray: Y.Array<Annotation>;
	/** immer-yjs binder bound to the annotations array (same API as src/sync.ts). */
	binder: ReturnType<typeof bind<Annotation[]>>;
	/** Read the current annotations as a plain array via the binder. */
	get: () => Annotation[];
	/** Immer-style mutation helper (same as sync.update). */
	update: ReturnType<typeof bind<Annotation[]>>["update"];
	/** Subscribe to state changes (same as sync.subscribe). */
	subscribe: ReturnType<typeof bind<Annotation[]>>["subscribe"];
	/** Stop relaying updates for this client and free its binder. */
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
 *
 * @example
 * const room = createMockSyncRoom();
 * const a = room.createClient();
 * const b = room.createClient();
 * a.update((draft) => { draft.push(annotation); });
 * // b.get() now contains the annotation
 */
export function createMockSyncRoom(): MockSyncRoom {
	const clients: {
		client: MockSyncClient;
		onUpdate: (update: Uint8Array, origin: unknown) => void;
	}[] = [];

	const createClient = (): MockSyncClient => {
		const doc = new Y.Doc();
		const annotationsArray = doc.getArray<Annotation>("annotations");
		const binder = bind<Annotation[]>(annotationsArray);

		// Relay this doc's updates to every *other* client in the room.
		// We tag updates with `doc` as the origin so we can ignore updates we
		// applied ourselves (avoids echo loops and redundant work).
		const onUpdate = (update: Uint8Array, origin: unknown) => {
			if (origin === "mock-sync-relay") return;
			for (const entry of clients) {
				if (entry.client.doc === doc) continue;
				Y.applyUpdate(entry.client.doc, update, "mock-sync-relay");
			}
		};

		doc.on("update", onUpdate);

		const client: MockSyncClient = {
			doc,
			annotationsArray,
			binder,
			get: () => binder.get() as unknown as Annotation[],
			update: binder.update,
			subscribe: binder.subscribe,
			disconnect: () => {
				doc.off("update", onUpdate);
				binder.unbind();
				const idx = clients.findIndex((c) => c.client === client);
				if (idx !== -1) clients.splice(idx, 1);
			},
		};

		// New client should sync with the current room state immediately.
		// Pull existing state from any already-connected peer.
		const peer = clients[0];
		if (peer) {
			const state = Y.encodeStateAsUpdate(peer.client.doc);
			Y.applyUpdate(doc, state, "mock-sync-relay");
		}

		clients.push({ client, onUpdate });
		return client;
	};

	const destroy = () => {
		// Copy because disconnect() mutates the array.
		for (const entry of [...clients]) {
			entry.client.disconnect();
			entry.client.doc.destroy();
		}
		clients.length = 0;
	};

	return { createClient, destroy };
}
