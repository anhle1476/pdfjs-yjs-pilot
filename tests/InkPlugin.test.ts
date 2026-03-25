import { beforeEach, describe, expect, it, vi } from "vitest";
import { InkObject } from "../src/models/InkObject";
import { InkPlugin } from "../src/plugins/InkPlugin";

describe("InkObject", () => {
	const mockPaths = [
		{
			points: [0.1, 0.1, 0.2, 0.2],
			line: [NaN, NaN, NaN, NaN, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2],
		},
	];

	it("calculates bounds correctly", () => {
		const ink = new InkObject("test-1", mockPaths, "#000", 1);
		const bounds = ink.getBounds();
		expect(bounds.x).toBeCloseTo(0.1);
		expect(bounds.y).toBeCloseTo(0.1);
		expect(bounds.width).toBeCloseTo(0.1);
		expect(bounds.height).toBeCloseTo(0.1);
	});

	it("handles empty paths when calculating bounds", () => {
		const ink = new InkObject("test-empty", [], "#000", 1);
		const bounds = ink.getBounds();
		expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	it("handles resize with different anchors", () => {
		const ink = new InkObject(
			"test-resize",
			JSON.parse(JSON.stringify(mockPaths)),
			"#000",
			1,
		);
		ink.resize("nw", 0.1, 0.1);
		const bounds = ink.getBounds();
		expect(bounds.width).toBeCloseTo(0);
		expect(bounds.height).toBeCloseTo(0);
	});

	it("hitTest correctly identifies pointer intersection", () => {
		const ink = new InkObject("test-2", mockPaths, "#000", 1);

		// Inside path points (with margin)
		expect(ink.hitTest(0.1, 0.1)).toBe(true);
		expect(ink.hitTest(0.2, 0.2)).toBe(true);

		// Outside
		expect(ink.hitTest(0.5, 0.5)).toBe(false);
		expect(ink.hitTest(0, 0)).toBe(false);

		// Inside bounds but not near path
		expect(ink.hitTest(0.1, 0.2)).toBe(false);
	});

	it("move updates bounds and paths", () => {
		const ink = new InkObject(
			"test-3",
			JSON.parse(JSON.stringify(mockPaths)),
			"#000",
			1,
		);
		ink.move(0.1, 0.1);

		const bounds = ink.getBounds();
		expect(bounds.x).toBeCloseTo(0.2);
		expect(bounds.y).toBeCloseTo(0.2);

		expect(ink.paths[0].line[4]).toBeCloseTo(0.2);
		expect(ink.paths[0].line[5]).toBeCloseTo(0.2);
	});

	it("resize updates bounds and scales paths", () => {
		const ink = new InkObject(
			"test-4",
			JSON.parse(JSON.stringify(mockPaths)),
			"#000",
			1,
		);

		// Resize by adding 0.1 to width and height (anchor se)
		ink.resize("se", 0.1, 0.1);

		const bounds = ink.getBounds();
		expect(bounds.width).toBeCloseTo(0.2);
		expect(bounds.height).toBeCloseTo(0.2);

		// Original max point was 0.2, after resize it should be 0.3 (since x is 0.1, width is 0.2)
		expect(ink.paths[0].line[10]).toBeCloseTo(0.3);
		expect(ink.paths[0].line[11]).toBeCloseTo(0.3);
	});

	it("serialize and deserialize reproduce identical objects", () => {
		const ink = new InkObject("test-5", mockPaths, "#ff0000", 2);
		const data = ink.serialize();

		expect(data.id).toBe("test-5");
		expect(data.color).toBe("#ff0000");
		expect(data.strokeWidth).toBe(2);

		const newInk = new InkObject();
		newInk.deserialize(data);

		expect(newInk.id).toBe("test-5");
		expect(newInk.color).toBe("#ff0000");
		expect(newInk.strokeWidth).toBe(2);
		expect(newInk.getBounds()).toEqual(ink.getBounds());
		expect(newInk.paths).toEqual(ink.paths);
	});

	it("renders paths correctly", () => {
		const paths = [
			{ points: [], line: [NaN, NaN, NaN, NaN, 0.1, 0.1] }, // length 6
			{
				points: [],
				line: [NaN, NaN, NaN, NaN, 0.1, 0.1, NaN, NaN, NaN, NaN, 0.2, 0.2],
			}, // length 12 with NaN
			{
				points: [],
				line: [NaN, NaN, NaN, NaN, 0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2],
			}, // standard curve
		];
		const ink = new InkObject("test-render", paths, "#000", 1);

		const mockCtx = {
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			bezierCurveTo: vi.fn(),
			stroke: vi.fn(),
		} as unknown as CanvasRenderingContext2D;

		ink.render(mockCtx, 800, 600);
		expect(mockCtx.beginPath).toHaveBeenCalled();
		expect(mockCtx.moveTo).toHaveBeenCalledTimes(3);
		expect(mockCtx.lineTo).toHaveBeenCalledTimes(2);
		expect(mockCtx.bezierCurveTo).toHaveBeenCalledTimes(1);
		expect(mockCtx.stroke).toHaveBeenCalled();
	});
});

describe("InkPlugin", () => {
	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let store: any[];

	beforeEach(() => {
		(globalThis as any).Path2D = vi.fn() as any;
		canvas = document.createElement("canvas");
		canvas.width = 800;
		canvas.height = 600;

		ctx = {
			canvas,
			stroke: vi.fn(),
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			bezierCurveTo: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			scale: vi.fn(),
			setTransform: vi.fn(),
			clearRect: vi.fn(),
		} as unknown as CanvasRenderingContext2D;

		// Mock getBoundingClientRect
		canvas.getBoundingClientRect = () => ({
			left: 0,
			top: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
			x: 0,
			y: 0,
			toJSON: () => {},
		});

		store = [];
	});

	it("should create an InkObject on drawing completion", () => {
		const plugin = new InkPlugin(store);
		plugin.activate(canvas);

		plugin.onPointerDown(
			new PointerEvent("pointerdown", { clientX: 10, clientY: 10 }),
		);
		plugin.onPointerMove(
			new PointerEvent("pointermove", { clientX: 20, clientY: 20 }),
		);
		plugin.onPointerUp(
			new PointerEvent("pointerup", { clientX: 30, clientY: 30 }),
		);

		const objects = plugin.getObjects();
		expect(objects.length).toBe(1);
		expect(objects[0]).toBeInstanceOf(InkObject);

		const obj = objects[0] as InkObject;
		expect(obj.paths.length).toBeGreaterThan(0);
		expect(store).toContain(obj);
	});

	it("handles events when not active or drawing", () => {
		const plugin = new InkPlugin(store);

		// not active
		plugin.onPointerDown(new PointerEvent("pointerdown"));
		plugin.onPointerMove(new PointerEvent("pointermove"));
		plugin.onPointerUp(new PointerEvent("pointerup"));
		plugin.render({} as any); // coverage for !this.canvas
		expect(store.length).toBe(0);

		plugin.activate(canvas);
		// not drawing
		plugin.onPointerMove(new PointerEvent("pointermove"));
		plugin.onPointerUp(new PointerEvent("pointerup"));
		expect(store.length).toBe(0);

		plugin.deactivate();
		plugin.onPointerDown(new PointerEvent("pointerdown"));
		expect(store.length).toBe(0);
	});

	it("renders preview path correctly", () => {
		const plugin = new InkPlugin(store);
		plugin.activate(canvas);

		plugin.onPointerDown(
			new PointerEvent("pointerdown", { clientX: 10, clientY: 10 }),
		);
		plugin.onPointerMove(
			new PointerEvent("pointermove", { clientX: 15, clientY: 15 }),
		);

		// trigger render
		plugin.render(ctx);
		expect(ctx.stroke).toHaveBeenCalled();
	});

	it("should render objects from the store", () => {
		const plugin = new InkPlugin(store);
		plugin.activate(canvas);

		const ink = new InkObject(
			"test-render",
			[{ points: [0.5, 0.5], line: [NaN, NaN, NaN, NaN, 0.5, 0.5] }],
			"#000",
			1,
		);
		store.push(ink);

		plugin.render(ctx);

		expect(ctx.stroke).toHaveBeenCalled();
	});
});
