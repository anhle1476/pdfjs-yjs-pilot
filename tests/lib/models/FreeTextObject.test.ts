import { describe, expect, it } from 'vitest';
import { FreeTextObject } from '../../../src/lib/models/FreeTextObject';

// Ported from tests/FreeTextPlugin.test.ts (the FreeTextObject describe block).
// The model is unchanged by the lib refactor — only the import path moved to
// src/lib/models/FreeTextObject. FreeTextPlugin/DOM behaviour is ported
// separately in tests/lib/tools/FreeTextTool.test.ts.
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
    expect(obj.bounds).toEqual({ x: 0.2, y: 0.4, width: 0.3, height: 0.4 });
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
    const original = new FreeTextObject('test-cycle', 'Test Content', 14, '#123456', {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    });
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
