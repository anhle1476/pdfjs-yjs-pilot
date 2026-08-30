import { afterEach, describe, expect, it } from "vitest";
import type { Annotation } from "../src/types";
import { createMockSyncRoom, type MockSyncRoom } from "./helpers/mockYWebsocket";

const makeAnnotation = (id: string, overrides: Partial<Annotation> = {}): Annotation => ({
	id,
	type: "freetext",
	page: 1,
	position: { x: 0.1, y: 0.2 },
	data: {
		content: "hello",
		fontSize: 14,
		color: "#000000",
		bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
	},
	color: "#000000",
	createdAt: 1_700_000_000_000,
	...overrides,
});

describe("mock y-websocket sync room (in-memory relay)", () => {
	let room: MockSyncRoom;

	afterEach(() => {
		room?.destroy();
	});

	it("relays an added annotation from client A to client B", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		const ann = makeAnnotation("a-1");
		a.update((draft) => {
			draft.push(ann);
		});

		// B receives the update via the in-memory relay (Y.applyUpdate).
		expect(b.get()).toHaveLength(1);
		expect(b.get()[0].id).toBe("a-1");
		// Also verify at the raw Y.Array level. immer-yjs stores each item as a
		// Y.Map, so read it via toJSON() to get the plain object.
		expect(b.annotationsArray.length).toBe(1);
		const raw = b.annotationsArray.get(0) as unknown as {
			toJSON: () => Annotation;
		};
		expect(raw.toJSON().id).toBe("a-1");
	});

	it("syncs bidirectionally between two clients", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		a.update((draft) => {
			draft.push(makeAnnotation("a-1"));
		});
		b.update((draft) => {
			draft.push(makeAnnotation("b-1"));
		});

		const ids = (c: typeof a) => c.get().map((x) => x.id).sort();
		expect(ids(a)).toEqual(["a-1", "b-1"]);
		expect(ids(b)).toEqual(["a-1", "b-1"]);
	});

	it("syncs an update (edit) of an existing annotation", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		a.update((draft) => {
			draft.push(makeAnnotation("edit-1", { color: "#000000" }));
		});
		expect(b.get()[0].color).toBe("#000000");

		// Edit on B, verify A observes the change.
		b.update((draft) => {
			draft[0].color = "#ff0000";
		});
		expect(a.get()[0].color).toBe("#ff0000");
	});

	it("syncs a deletion across clients", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		a.update((draft) => {
			draft.push(makeAnnotation("del-1"));
			draft.push(makeAnnotation("del-2"));
		});
		expect(b.get()).toHaveLength(2);

		b.update((draft) => {
			// remove del-1
			const idx = draft.findIndex((x) => x.id === "del-1");
			draft.splice(idx, 1);
		});

		expect(a.get().map((x) => x.id)).toEqual(["del-2"]);
		expect(b.get().map((x) => x.id)).toEqual(["del-2"]);
	});

	it("gives a late-joining client the current room state", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		a.update((draft) => {
			draft.push(makeAnnotation("early-1"));
		});

		// C joins after the annotation already exists.
		const c = room.createClient();
		expect(c.get()).toHaveLength(1);
		expect(c.get()[0].id).toBe("early-1");
	});

	it("notifies subscribers when a relayed update arrives", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		let bStateLen = -1;
		const unsub = b.subscribe((state) => {
			bStateLen = state.length;
		});

		a.update((draft) => {
			draft.push(makeAnnotation("sub-1"));
		});

		expect(bStateLen).toBe(1);
		unsub();
	});

	it("stops receiving updates after disconnect", () => {
		room = createMockSyncRoom();
		const a = room.createClient();
		const b = room.createClient();

		b.disconnect();

		a.update((draft) => {
			draft.push(makeAnnotation("after-disconnect"));
		});

		// b's doc no longer relays, so it should not have received the update.
		expect(b.annotationsArray.length).toBe(0);
	});
});
