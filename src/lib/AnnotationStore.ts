import * as Y from 'yjs';
import { AnnotationObject } from './models/AnnotationObject';
import { InkObject } from './models/InkObject';
import { HighlightObject } from './models/HighlightObject';
import { FreeTextObject } from './models/FreeTextObject';

/**
 * AnnotationStore — a thin CRUD layer over an externally-owned Y.Array.
 *
 * The store NEVER creates its own Y.Doc and NEVER imports any network
 * provider (y-websocket etc). The host app owns the Y.Doc / provider and
 * simply hands the shared Y.Array of annotations to this store. All mutations
 * are wrapped in a transaction on the owning doc (if present) so remote peers
 * receive a single atomic update.
 *
 * Data format: each element in the Y.Array is a plain serialized annotation
 * object (the shape produced by `AnnotationObject.serialize()`), keyed by a
 * `type` discriminator ('ink' | 'highlight' | 'freetext'). This matches the
 * format the previous immer-yjs-based sync layer used, so existing documents
 * remain compatible.
 */
export class AnnotationStore {
  private yAnnotations: Y.Array<any>;

  constructor(yAnnotations: Y.Array<any>) {
    this.yAnnotations = yAnnotations;
  }

  /**
   * Deserialize a single plain record into the matching model instance.
   */
  private deserializeRecord(record: any): AnnotationObject | null {
    if (!record || typeof record !== 'object') return null;
    switch (record.type) {
      case 'ink': {
        const obj = new InkObject();
        obj.deserialize(record);
        return obj;
      }
      case 'highlight': {
        const obj = new HighlightObject();
        obj.deserialize(record);
        return obj;
      }
      case 'freetext': {
        const obj = new FreeTextObject();
        obj.deserialize(record);
        return obj;
      }
      default:
        return null;
    }
  }

  /**
   * Read all annotations and deserialize them into model instances.
   */
  public getAll(): AnnotationObject[] {
    const result: AnnotationObject[] = [];
    for (const record of this.yAnnotations.toArray()) {
      const obj = this.deserializeRecord(record);
      if (obj) result.push(obj);
    }
    return result;
  }

  /**
   * Read all annotations belonging to a given page.
   */
  public getForPage(pageNumber: number): AnnotationObject[] {
    return this.getAll().filter((obj) => obj.pageNumber === pageNumber);
  }

  private transact(fn: () => void): void {
    const doc = this.yAnnotations.doc;
    if (doc) {
      doc.transact(fn);
    } else {
      fn();
    }
  }

  private indexOfId(id: string): number {
    const arr = this.yAnnotations.toArray();
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return i;
    }
    return -1;
  }

  /**
   * Add a new annotation (pushes its serialized form onto the Y.Array).
   */
  public add(obj: AnnotationObject): void {
    const record = obj.serialize();
    this.transact(() => {
      this.yAnnotations.push([record]);
    });
  }

  /**
   * Replace an existing annotation (matched by id) with the serialized form
   * of the supplied object.
   */
  public update(id: string, obj: AnnotationObject): void {
    const record = obj.serialize();
    this.transact(() => {
      const index = this.indexOfId(id);
      if (index === -1) return;
      this.yAnnotations.delete(index, 1);
      this.yAnnotations.insert(index, [record]);
    });
  }

  /**
   * Remove an annotation by id.
   */
  public remove(id: string): void {
    this.transact(() => {
      const index = this.indexOfId(id);
      if (index === -1) return;
      this.yAnnotations.delete(index, 1);
    });
  }

  /**
   * Subscribe to changes on the underlying Y.Array. Returns an unsubscribe
   * function. Uses Yjs' native observe/unobserve.
   */
  public subscribe(callback: () => void): () => void {
    const handler = () => callback();
    this.yAnnotations.observe(handler);
    return () => {
      this.yAnnotations.unobserve(handler);
    };
  }

  /**
   * Expose the raw Y.Array for advanced host-side use.
   */
  public getYArray(): Y.Array<any> {
    return this.yAnnotations;
  }
}
