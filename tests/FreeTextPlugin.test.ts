import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeTextObject } from '../src/models/FreeTextObject';
import { FreeTextPlugin } from '../src/plugins/FreeTextPlugin';
import { AnnotationObject } from '../src/plugins/IToolPlugin';

describe('FreeTextObject', () => {
  it('creates FreeTextObject with default values', () => {
    const obj = new FreeTextObject();
    expect(obj.id).toBe('');
    expect(obj.content).toBe('');
    expect(obj.fontSize).toBe(10);
    expect(obj.color).toBe('#000000');
    expect(obj.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(obj.pageNumber).toBe(1);
  });

  it('creates FreeTextObject with provided values', () => {
    const bounds = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const obj = new FreeTextObject('test-id', 'Hello World', 12, '#ff0000', bounds);

    expect(obj.id).toBe('test-id');
    expect(obj.content).toBe('Hello World');
    expect(obj.fontSize).toBe(12);
    expect(obj.color).toBe('#ff0000');
    expect(obj.bounds).toEqual(bounds);
  });

  it('hitTest returns true for point inside bounds', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });

    expect(obj.hitTest(0.15, 0.15)).toBe(true);
    expect(obj.hitTest(0.2, 0.15)).toBe(true);
    expect(obj.hitTest(0.29, 0.19)).toBe(true);
  });

  it('hitTest returns false for point outside bounds', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });

    expect(obj.hitTest(0.05, 0.15)).toBe(false);
    expect(obj.hitTest(0.35, 0.15)).toBe(false);
    expect(obj.hitTest(0.15, 0.05)).toBe(false);
    expect(obj.hitTest(0.15, 0.25)).toBe(false);
  });

  it('getBounds returns a copy of bounds', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });

    const bounds = obj.getBounds();
    bounds.x = 999;
    expect(obj.bounds.x).toBe(0.1);
  });

  it('move updates bounds', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });

    obj.move(0.1, 0.2);
    expect(obj.bounds).toEqual({
      x: 0.2,
      y: 0.4,
      width: 0.3,
      height: 0.4,
    });
  });

  it('resize updates bounds with different anchors', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });

    obj.resize('se', 0.1, 0.05);
    expect(obj.bounds.x).toBeCloseTo(0.1);
    expect(obj.bounds.y).toBeCloseTo(0.1);
    expect(obj.bounds.width).toBeCloseTo(0.3);
    expect(obj.bounds.height).toBeCloseTo(0.15);
  });

  it('resize handles w anchor correctly', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });

    obj.resize('w', 0.05, 0);
    expect(obj.bounds.x).toBeCloseTo(0.15);
    expect(obj.bounds.y).toBeCloseTo(0.1);
    expect(obj.bounds.width).toBeCloseTo(0.15);
    expect(obj.bounds.height).toBeCloseTo(0.1);
  });

  it('resize handles n anchor correctly', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000', {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    });

    obj.resize('n', 0, 0.05);
    expect(obj.bounds.x).toBeCloseTo(0.1);
    expect(obj.bounds.y).toBeCloseTo(0.15);
    expect(obj.bounds.width).toBeCloseTo(0.2);
    expect(obj.bounds.height).toBeCloseTo(0.05);
  });

  it('serialize returns correct data structure', () => {
    const obj = new FreeTextObject('test-id', 'Test Content', 12, '#ff0000', {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });
    obj.pageNumber = 2;

    const serialized = obj.serialize();

    expect(serialized.type).toBe('freetext');
    expect(serialized.id).toBe('test-id');
    expect(serialized.content).toBe('Test Content');
    expect(serialized.fontSize).toBe(12);
    expect(serialized.color).toBe('#ff0000');
    expect(serialized.bounds).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    expect(serialized.page).toBe(2);
  });

  it('deserialize restores object correctly', () => {
    const data = {
      type: 'freetext' as const,
      id: 'test-id',
      content: 'Test Content',
      fontSize: 14,
      color: '#00ff00',
      bounds: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
      page: 3,
    };

    const obj = new FreeTextObject();
    obj.deserialize(data);

    expect(obj.id).toBe('test-id');
    expect(obj.content).toBe('Test Content');
    expect(obj.fontSize).toBe(14);
    expect(obj.color).toBe('#00ff00');
    expect(obj.bounds).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.5 });
    expect(obj.pageNumber).toBe(3);
  });

  it('deserialize handles missing page gracefully', () => {
    const data = {
      type: 'freetext' as const,
      id: 'test-id',
      content: 'Test',
      fontSize: 10,
      color: '#000',
      bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
    };

    const obj = new FreeTextObject();
    obj.deserialize(data);

    expect(obj.pageNumber).toBe(1);
  });

  it('setContent and getContent handle content correctly', () => {
    const obj = new FreeTextObject('test', 'Test', 10, '#000');

    obj.setContent('Hello World');
    expect(obj.content).toBe('Hello World');

    expect(obj.getContent()).toBe('Hello World');
  });

  it('isEmpty returns true for empty content', () => {
    const obj = new FreeTextObject('test', '', 10, '#000');
    expect(obj.isEmpty()).toBe(true);
  });

  it('isEmpty returns true for whitespace-only content', () => {
    const obj = new FreeTextObject('test', '   ', 10, '#000');
    expect(obj.isEmpty()).toBe(true);
  });

  it('isEmpty returns false for non-empty content', () => {
    const obj = new FreeTextObject('test', 'Hello', 10, '#000');
    expect(obj.isEmpty()).toBe(false);
  });

  it('serialize and deserialize produce equivalent objects', () => {
    const original = new FreeTextObject(
      'test-cycle',
      'Test Content',
      14,
      '#123456',
      { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    );
    original.pageNumber = 5;

    const serialized = original.serialize();
    const restored = new FreeTextObject();
    restored.deserialize(serialized);

    expect(restored.id).toBe(original.id);
    expect(restored.content).toBe(original.content);
    expect(restored.fontSize).toBe(original.fontSize);
    expect(restored.color).toBe(original.color);
    expect(restored.bounds).toEqual(original.bounds);
    expect(restored.pageNumber).toBe(original.pageNumber);
  });
});

describe('FreeTextPlugin', () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let store: AnnotationObject[];
  let mockContainer: HTMLElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    ctx = {
      canvas,
      fillText: vi.fn(),
      stroke: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    store = [];
    mockContainer = document.createElement('div');
    mockContainer.style.position = 'relative';
    mockContainer.style.width = '800px';
    mockContainer.style.height = '600px';
    document.body.appendChild(mockContainer);
    mockContainer.appendChild(canvas);
  });

  afterEach(() => {
    try {
      document.body.removeChild(mockContainer);
    } catch {
    }
  });

  describe('constructor and initialization', () => {
    it('creates plugin with default values', () => {
      const plugin = new FreeTextPlugin(store);

      expect(plugin.defaultFontSize).toBe(10);
      expect(plugin.defaultColor).toBe('#000000');
    });

    it('creates plugin with custom options', () => {
      const plugin = new FreeTextPlugin(store, {
        defaultFontSize: 14,
        defaultColor: '#ff0000',
      });

      expect(plugin.defaultFontSize).toBe(14);
      expect(plugin.defaultColor).toBe('#ff0000');
    });
  });

  describe('activate and deactivate', () => {
    it('activate sets canvas and context', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      expect(plugin.getPageNumber()).toBe(1);
    });

    it('deactivate clears canvas and context', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);
      plugin.deactivate();

      expect(plugin.getPageNumber()).toBe(1);
    });

    it('deactivate removes editor container', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);
      plugin.deactivate();
      plugin.activate(canvas, ctx);
    });
  });

  describe('page number management', () => {
    it('setPageNumber updates current page', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.setPageNumber(3);

      expect(plugin.getPageNumber()).toBe(3);
    });

    it('setPageNumber commits active editor on page change', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);
      plugin.setPageNumber(2);
      plugin.setPageNumber(3);
    });
  });

  describe('pointer events and editor creation', () => {
    it('onPointerDown creates new editor when clicking empty area', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      const event = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        target: canvas,
      });

      plugin.onPointerDown(event);

      expect(store.length).toBe(1);
      expect(store[0]).toBeInstanceOf(FreeTextObject);
    });

    it('onPointerMove updates editor bounds during creation', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      plugin.onPointerDown(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 100, target: canvas })
      );
      plugin.onPointerMove(
        new PointerEvent('pointermove', { clientX: 200, clientY: 150 })
      );

      const obj = store[0] as FreeTextObject;
      expect(obj.bounds.width).toBeGreaterThan(0);
    });

    it('onPointerUp finalizes editor creation', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      plugin.onPointerDown(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 100, target: canvas })
      );
      plugin.onPointerMove(
        new PointerEvent('pointermove', { clientX: 200, clientY: 150 })
      );
      plugin.onPointerUp(
        new PointerEvent('pointerup', { clientX: 200, clientY: 150 })
      );

      expect(store.length).toBe(1);
    });

    it('creating very small editor uses minimum size', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      plugin.onPointerDown(
        new PointerEvent('pointerdown', { clientX: 100, clientY: 100, target: canvas })
      );
      plugin.onPointerUp(
        new PointerEvent('pointerup', { clientX: 100, clientY: 100 })
      );

      const obj = store[0] as FreeTextObject;
      expect(obj.bounds.width).toBeGreaterThanOrEqual(0.05);
      expect(obj.bounds.height).toBeGreaterThanOrEqual(0.02);
    });
  });

  describe('editor content management', () => {
    it('getObjects returns only current page objects', () => {
      const obj1 = new FreeTextObject('obj1', 'Page 1', 10, '#000');
      obj1.pageNumber = 1;
      obj1.bounds = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };

      const obj2 = new FreeTextObject('obj2', 'Page 2', 10, '#000');
      obj2.pageNumber = 2;
      obj2.bounds = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };

      store.push(obj1, obj2);

      const plugin = new FreeTextPlugin(store);
      plugin.setPageNumber(1);

      const objects = plugin.getObjects();
      expect(objects.length).toBe(1);
      expect((objects[0] as FreeTextObject).content).toBe('Page 1');
    });

    it('getAllObjects returns all objects regardless of page', () => {
      const obj1 = new FreeTextObject('obj1', 'Page 1', 10, '#000');
      obj1.pageNumber = 1;

      const obj2 = new FreeTextObject('obj2', 'Page 2', 10, '#000');
      obj2.pageNumber = 2;

      store.push(obj1, obj2);

      const plugin = new FreeTextPlugin(store);
      plugin.setPageNumber(1);

      const allObjects = plugin.getAllObjects();
      expect(allObjects.length).toBe(2);
    });
  });

  describe('getData and setData', () => {
    it('getData returns serialized objects', () => {
      const obj = new FreeTextObject('test1', 'Test', 12, '#ff0000', {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
      });
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      const data = plugin.getData();

      expect(data.length).toBe(1);
      expect(data[0].id).toBe('test1');
      expect(data[0].content).toBe('Test');
    });

    it('setData restores objects from serialized data', () => {
      const data = [
        {
          type: 'freetext' as const,
          id: 'restored1',
          content: 'Restored Content',
          fontSize: 14,
          color: '#0000ff',
          bounds: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
          page: 1,
        },
      ];

      const plugin = new FreeTextPlugin(store);
      plugin.setData(data);

      expect(store.length).toBe(1);
      expect((store[0] as FreeTextObject).id).toBe('restored1');
      expect((store[0] as FreeTextObject).content).toBe('Restored Content');
    });

    it('setData updates existing objects', () => {
      const existingObj = new FreeTextObject('existing', 'Old', 10, '#000');
      store.push(existingObj);

      const data = [
        {
          type: 'freetext' as const,
          id: 'existing',
          content: 'Updated Content',
          fontSize: 12,
          color: '#ff0000',
          bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          page: 1,
        },
      ];

      const plugin = new FreeTextPlugin(store);
      plugin.setData(data);

      expect(store.length).toBe(1);
      expect((store[0] as FreeTextObject).content).toBe('Updated Content');
    });
  });

  describe('validate', () => {
    it('validate returns valid for correct objects', () => {
      const obj = new FreeTextObject('valid1', 'Test', 10, '#000');
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      const result = plugin.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validate detects missing id', () => {
      const obj = new FreeTextObject('', 'Test', 10, '#000');
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      const result = plugin.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('FreeTextObject missing id');
    });

    it('validate detects invalid fontSize', () => {
      const obj = new FreeTextObject('bad-size', 'Test', 0, '#000');
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      const result = plugin.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid fontSize'))).toBe(true);
    });

    it('validate detects missing color', () => {
      const obj = new FreeTextObject('no-color', 'Test', 10, '');
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      const result = plugin.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing color'))).toBe(true);
    });
  });

  describe('active editor management', () => {
    it('getActiveEditorId returns null initially', () => {
      const plugin = new FreeTextPlugin(store);
      expect(plugin.getActiveEditorId()).toBeNull();
    });

    it('setActiveEditor changes active editor', () => {
      const obj = new FreeTextObject('editor1', 'Test', 10, '#000');
      store.push(obj);

      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      const initialId = plugin.getActiveEditorId();
      plugin.setActiveEditor('editor1');
    });

    it('commitAll commits active editor', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);
      plugin.commitAll();
    });
  });

  describe('render', () => {
    it('render does not throw with valid context', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);

      expect(() => plugin.render(ctx)).not.toThrow();
    });

    it('render handles null canvas gracefully', () => {
      const plugin = new FreeTextPlugin(store);

      expect(() => plugin.render(ctx)).not.toThrow();
    });
  });

  describe('initialize and destroy', () => {
    it('initialize sets up container', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.initialize(mockContainer);
    });

    it('destroy cleans up properly', () => {
      const plugin = new FreeTextPlugin(store);
      plugin.activate(canvas, ctx);
      plugin.destroy();

      expect(() => plugin.render(ctx)).not.toThrow();
    });
  });
});