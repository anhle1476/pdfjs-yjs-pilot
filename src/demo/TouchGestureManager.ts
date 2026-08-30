/**
 * Keeps native PDF gestures available while drawing tools are active.
 *
 * CSS `touch-action` cannot express "block one finger, allow two fingers",
 * so this host-level manager selectively prevents one-finger touch moves. The
 * listener is explicitly non-passive because preventDefault() is intentional.
 */
export interface TouchGestureManagerOptions {
  /** True while the active tool owns a one-finger gesture. */
  blocksSingleFingerPan: () => boolean;
  /** Abort an in-progress drawing gesture before native two-finger gestures. */
  cancelActiveGesture?: () => void;
}

export class TouchGestureManager {
  private readonly target: HTMLElement;
  private readonly options: TouchGestureManagerOptions;
  private readonly listenerOptions: AddEventListenerOptions = {
    capture: true,
    passive: false,
  };
  private started = false;

  private readonly onTouchStart = (event: TouchEvent): void => {
    if (!this.options.blocksSingleFingerPan()) return;

    // If a second finger joins, the gesture belongs to the browser's native
    // pan/pinch handling. Do not preventDefault, and discard any partial
    // drawing stroke that began with the first finger.
    if (event.touches.length >= 2) {
      this.options.cancelActiveGesture?.();
    }
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (!this.options.blocksSingleFingerPan()) return;

    // Two or more touches are deliberately left untouched so the browser can
    // pan and pinch-zoom the PDF normally while a drawing tool is active.
    if (event.touches.length >= 2) {
      this.options.cancelActiveGesture?.();
      return;
    }

    if (event.touches.length === 1) {
      event.preventDefault();
    }
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (
      this.options.blocksSingleFingerPan() &&
      event.touches.length >= 2
    ) {
      this.options.cancelActiveGesture?.();
    }
  };

  constructor(target: HTMLElement, options: TouchGestureManagerOptions) {
    this.target = target;
    this.options = options;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.target.addEventListener(
      'touchstart',
      this.onTouchStart,
      this.listenerOptions
    );
    this.target.addEventListener(
      'touchmove',
      this.onTouchMove,
      this.listenerOptions
    );
    this.target.addEventListener(
      'touchend',
      this.onTouchEnd,
      this.listenerOptions
    );
    this.target.addEventListener(
      'touchcancel',
      this.onTouchEnd,
      this.listenerOptions
    );
  }

  public stop(): void {
    if (!this.started) return;
    this.started = false;
    this.target.removeEventListener(
      'touchstart',
      this.onTouchStart,
      this.listenerOptions
    );
    this.target.removeEventListener(
      'touchmove',
      this.onTouchMove,
      this.listenerOptions
    );
    this.target.removeEventListener(
      'touchend',
      this.onTouchEnd,
      this.listenerOptions
    );
    this.target.removeEventListener(
      'touchcancel',
      this.onTouchEnd,
      this.listenerOptions
    );
  }
}
