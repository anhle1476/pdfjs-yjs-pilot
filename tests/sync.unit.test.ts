import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock y-websocket so importing src/sync.ts does NOT open a real socket to
// ws://localhost:1234. The WebsocketProvider constructor just records its args.
const providerInstances: Array<{ url: string; room: string; on: ReturnType<typeof vi.fn> }> = [];

vi.mock("y-websocket", () => {
	class WebsocketProvider {
		url: string;
		room: string;
		on = vi.fn();
		constructor(url: string, room: string, _doc: unknown) {
			this.url = url;
			this.room = room;
			providerInstances.push(this);
		}
	}
	return { WebsocketProvider };
});

describe("src/sync.ts (with mocked y-websocket)", () => {
	beforeEach(() => {
		providerInstances.length = 0;
		vi.resetModules();
	});

	it("exports a sync object with subscribe/update/get/provider without opening a socket", async () => {
		const mod = await import("../src/sync");

		expect(typeof mod.sync.subscribe).toBe("function");
		expect(typeof mod.sync.update).toBe("function");
		expect(typeof mod.sync.get).toBe("function");
		expect(mod.sync.provider).toBeDefined();

		// The provider was constructed with the hardcoded URL/room.
		expect(providerInstances).toHaveLength(1);
		expect(providerInstances[0].url).toBe("ws://localhost:1234");
		expect(providerInstances[0].room).toBe("pdfjs-pilot-annotations");
	});

	it("get() starts empty and reflects updates made through the binder", async () => {
		const mod = await import("../src/sync");

		expect(mod.sync.get()).toEqual([]);

		mod.sync.update((draft) => {
			draft.push({
				id: "local-1",
				type: "freetext",
				page: 1,
				position: { x: 0, y: 0 },
				data: {
					content: "x",
					fontSize: 12,
					color: "#000",
					bounds: { x: 0, y: 0, width: 1, height: 1 },
				},
				color: "#000",
				createdAt: 1,
			});
		});

		const result = mod.sync.get();
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("local-1");
	});
});
