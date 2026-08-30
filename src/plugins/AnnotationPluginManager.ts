import { IToolPlugin, AnnotationObject } from './IToolPlugin';
import { Annotation } from '../types';
import { sync } from '../sync';

/**
 * A plugin that additionally exposes the page-number setter used by the
 * manager. The lifecycle callbacks (onRenderNeeded / onObject*) are assigned
 * by the manager via a structural cast, so they are intentionally NOT part of
 * this interface: concrete plugins declare those callbacks with narrower
 * object parameter types (InkObject, HighlightObject, FreeTextObject) which are
 * not assignable through property-typed fields. Wiring them dynamically keeps
 * this manager generic across all IToolPlugin implementations.
 */
export interface ManagedToolPlugin extends IToolPlugin {
  setPageNumber(page: number): void;
}

/**
 * Shape of the lifecycle callbacks the manager assigns onto a plugin.
 * Kept internal; callbacks are attached via a cast to sidestep the parameter
 * contravariance of the plugins' narrower callback signatures.
 */
interface PluginCallbackSink {
  onRenderNeeded?: () => void;
  onObjectCreated?: (obj: AnnotationObject) => void;
  onObjectUpdated?: (obj: AnnotationObject) => void;
  onObjectDeleted?: (obj: AnnotationObject) => void;
}

/**
 * Configuration for a single plugin registered with the manager.
 *
 * `needsContext` controls whether `activate` is called with the 2D context
 * (Highlight/FreeText) or with the canvas only (Ink). This preserves the
 * original per-plugin activation signature.
 *
 * `beforeActivate` runs right before `activate`, letting callers reproduce
 * plugin-specific setup (e.g. deactivate-before-activate, setting highlight
 * mode) without the manager needing to know plugin internals.
 */
export interface PluginRegistration {
  plugin: ManagedToolPlugin;
  /** Pass the CanvasRenderingContext2D to activate(). Defaults to true. */
  needsContext?: boolean;
  /** Optional hook invoked before activate() (e.g. deactivate, set mode). */
  beforeActivate?: (plugin: ManagedToolPlugin) => void;
}

/**
 * Centralizes the wiring for annotation tool plugins so PdfPilot doesn't have
 * to repeat near-identical activate/onRenderNeeded/onObject* blocks per plugin.
 *
 * Behavior is intentionally identical to the previous inline logic in
 * PdfPilot.ts: sync callbacks push/update/splice serialized annotations into
 * the Yjs draft keyed by object id.
 */
export class AnnotationPluginManager {
  private registrations: PluginRegistration[];
  private renderCallback: () => void;

  /**
   * @param registrations Plugins in the order they should be activated.
   * @param renderCallback Invoked whenever any plugin requests a re-render
   *        (wired to every plugin's onRenderNeeded).
   */
  constructor(registrations: PluginRegistration[], renderCallback: () => void) {
    this.registrations = registrations;
    this.renderCallback = renderCallback;
  }

  /**
   * Activate every registered plugin against the given canvas/ctx and wire the
   * shared render + Yjs sync callbacks. Order follows the registration order.
   */
  public activateAll(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, page: number): void {
    for (const reg of this.registrations) {
      const { plugin, needsContext = true, beforeActivate } = reg;

      plugin.setPageNumber(page);

      if (beforeActivate) {
        beforeActivate(plugin);
      }

      if (needsContext) {
        plugin.activate(canvas, ctx);
      } else {
        // Ink-style plugin whose activate() only accepts a canvas.
        (plugin.activate as (c: HTMLCanvasElement) => void)(canvas);
      }

      this.wirePlugin(plugin);
    }
  }

  /**
   * Wire onRenderNeeded + onObject* callbacks for a single plugin.
   * onObjectUpdated/onObjectDeleted are only meaningful for plugins that
   * declare them (e.g. FreeText); wiring them on others is harmless because
   * such plugins never invoke them.
   */
  private wirePlugin(plugin: ManagedToolPlugin): void {
    // Cast to the callback sink: concrete plugins declare these callbacks with
    // narrower object parameter types, so we assign structurally here.
    const sink = plugin as unknown as PluginCallbackSink;

    sink.onRenderNeeded = () => this.renderCallback();

    sink.onObjectCreated = (obj: AnnotationObject) => {
      sync.update((draft: unknown) => {
        const annotations = draft as Annotation[];
        // Guard against duplicate ids (original FreeText behavior); harmless
        // for Ink/Highlight which always create fresh ids.
        if (!annotations.some((a) => a.id === obj.id)) {
          annotations.push(obj.serialize());
        }
      });
    };

    sink.onObjectUpdated = (obj: AnnotationObject) => {
      sync.update((draft: unknown) => {
        const annotations = draft as Annotation[];
        const idx = annotations.findIndex((a) => a.id === obj.id);
        if (idx !== -1) {
          annotations[idx] = obj.serialize();
        }
      });
    };

    sink.onObjectDeleted = (obj: AnnotationObject) => {
      sync.update((draft: unknown) => {
        const annotations = draft as Annotation[];
        const idx = annotations.findIndex((a) => a.id === obj.id);
        if (idx !== -1) {
          annotations.splice(idx, 1);
        }
      });
    };
  }

  /** Set the current page number on all registered plugins. */
  public setPageNumberAll(page: number): void {
    for (const reg of this.registrations) {
      reg.plugin.setPageNumber(page);
    }
  }

  /** Deactivate all registered plugins. */
  public deactivateAll(): void {
    for (const reg of this.registrations) {
      reg.plugin.deactivate();
    }
  }

  /** Render all registered plugins in registration order. */
  public renderAll(ctx: CanvasRenderingContext2D): void {
    for (const reg of this.registrations) {
      reg.plugin.render(ctx);
    }
  }
}
