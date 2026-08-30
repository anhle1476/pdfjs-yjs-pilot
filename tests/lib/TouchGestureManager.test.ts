import { describe, expect, it } from 'vitest';
import { TouchGestureManager } from '../../src/demo/TouchGestureManager';

function makeTouchEvent(type: string, touchCount: number): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const touches = Array.from({ length: touchCount }, (_, index) => ({
    identifier: index,
  }));
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
}

describe('TouchGestureManager', () => {
  it('prevents one-finger moves while a drawing tool is active', () => {
    const target = document.createElement('div');
    const manager = new TouchGestureManager(target, {
      blocksSingleFingerPan: () => true,
    });
    manager.start();

    const event = makeTouchEvent('touchmove', 1);
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    manager.stop();
  });

  it('leaves two-finger pan/pinch moves unprevented and cancels the partial gesture', () => {
    const target = document.createElement('div');
    let cancellations = 0;
    const manager = new TouchGestureManager(target, {
      blocksSingleFingerPan: () => true,
      cancelActiveGesture: () => cancellations++,
    });
    manager.start();

    const start = makeTouchEvent('touchstart', 2);
    target.dispatchEvent(start);
    const move = makeTouchEvent('touchmove', 2);
    target.dispatchEvent(move);

    expect(start.defaultPrevented).toBe(false);
    expect(move.defaultPrevented).toBe(false);
    expect(cancellations).toBe(2);
    manager.stop();
  });

  it('keeps the default touch behavior when select or no tool is active', () => {
    const target = document.createElement('div');
    let active = false;
    const manager = new TouchGestureManager(target, {
      blocksSingleFingerPan: () => active,
    });
    manager.start();

    const selectMove = makeTouchEvent('touchmove', 1);
    target.dispatchEvent(selectMove);
    expect(selectMove.defaultPrevented).toBe(false);

    active = true;
    const drawingMove = makeTouchEvent('touchmove', 1);
    target.dispatchEvent(drawingMove);
    expect(drawingMove.defaultPrevented).toBe(true);

    manager.stop();
    const stoppedMove = makeTouchEvent('touchmove', 1);
    target.dispatchEvent(stoppedMove);
    expect(stoppedMove.defaultPrevented).toBe(false);
  });
});
