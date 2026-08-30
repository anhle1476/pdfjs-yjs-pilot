// OutlineController — framework-free port of the pdf.js outline (Table of
// Contents) handling. It has NO UI dependency, installs NO listeners, and does
// not import any demo code. It depends only on:
//
//   - a document provider yielding a PDFDocumentProxy-like object with
//     getOutline() / getDestination() / getPageIndex(), and
//   - a navigation facade (goToPage) to jump to a resolved destination.
//
// Destination resolution mirrors pdf.js:
//   - if dest is a string -> explicitDest = await doc.getDestination(dest)
//   - else use the dest array directly
//   - destRef = explicitDest[0]
//   - if destRef is an object (a ref) -> pageNumber = (await
//     doc.getPageIndex(destRef)) + 1
//   - if destRef is an integer -> pageNumber = destRef + 1
//
// The sample PDF (tracemonkey) has no outline, so an empty outline is handled
// gracefully (load() returns []).

/** A raw outline node as returned by pdf.js doc.getOutline(). */
export interface RawOutlineNode {
  title: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray | number[] | null;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: RawOutlineNode[];
}

/** Minimal document surface required for outline handling. */
export interface OutlineDocumentProxy {
  getOutline(): Promise<RawOutlineNode[] | null>;
  getDestination(dest: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

/** Navigation facade — matches PdfRenderer's public surface. */
export interface OutlineNavigationFacade {
  goToPage(pageNumber: number): void;
}

/** A normalized outline item exposed to the host. */
export interface OutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  color: [number, number, number] | null;
  hasChildren: boolean;
  items: OutlineItem[];
  dest: string | unknown[] | null;
  url: string | null;
  /** Stable id for this item (path-based). */
  _id: string;
}

export interface OutlineControllerDeps {
  getDocument: () => OutlineDocumentProxy | null;
  navigation: OutlineNavigationFacade;
}

function toColorTuple(
  color: Uint8ClampedArray | number[] | null | undefined
): [number, number, number] | null {
  if (!color || color.length < 3) return null;
  return [color[0], color[1], color[2]];
}

export class OutlineController {
  private getDocument: () => OutlineDocumentProxy | null;
  private nav: OutlineNavigationFacade;

  private items: OutlineItem[] = [];
  private loaded = false;

  constructor(deps: OutlineControllerDeps) {
    this.getDocument = deps.getDocument;
    this.nav = deps.navigation;
  }

  /** Load and normalize the outline. Returns [] when there is no outline. */
  public async load(): Promise<OutlineItem[]> {
    const doc = this.getDocument();
    if (!doc) {
      this.items = [];
      this.loaded = true;
      return this.items;
    }

    let raw: RawOutlineNode[] | null = null;
    try {
      raw = await doc.getOutline();
    } catch {
      raw = null;
    }

    this.items = raw && raw.length > 0 ? this.normalizeNodes(raw, '') : [];
    this.loaded = true;
    return this.items;
  }

  private normalizeNodes(nodes: RawOutlineNode[], parentId: string): OutlineItem[] {
    return nodes.map((node, index) => {
      const id = parentId ? `${parentId}.${index}` : `${index}`;
      const children =
        node.items && node.items.length > 0
          ? this.normalizeNodes(node.items, id)
          : [];
      return {
        title: node.title ?? '',
        bold: !!node.bold,
        italic: !!node.italic,
        color: toColorTuple(node.color),
        hasChildren: children.length > 0,
        items: children,
        dest: node.dest ?? null,
        url: node.url ?? null,
        _id: id,
      };
    });
  }

  /** True if a non-empty outline was loaded. */
  public hasOutline(): boolean {
    return this.loaded && this.items.length > 0;
  }

  /** The normalized outline (empty until load() resolves). */
  public getItems(): OutlineItem[] {
    return this.items;
  }

  /**
   * Resolve the 1-based page number for an outline item's destination, or null
   * if it cannot be resolved (e.g. external URL, missing dest).
   */
  public async resolvePageNumber(item: OutlineItem): Promise<number | null> {
    const doc = this.getDocument();
    if (!doc) return null;

    const dest = item.dest;
    if (dest == null) return null;

    let explicitDest: unknown[] | null;
    try {
      if (typeof dest === 'string') {
        explicitDest = await doc.getDestination(dest);
      } else if (Array.isArray(dest)) {
        explicitDest = dest;
      } else {
        return null;
      }
    } catch {
      return null;
    }

    if (!explicitDest || explicitDest.length === 0) return null;

    const destRef = explicitDest[0];

    if (destRef !== null && typeof destRef === 'object') {
      try {
        const pageIndex = await doc.getPageIndex(destRef);
        return pageIndex + 1;
      } catch {
        return null;
      }
    }

    if (typeof destRef === 'number' && Number.isInteger(destRef)) {
      return destRef + 1;
    }

    return null;
  }

  /** Resolve the item's destination and navigate to that page. */
  public async goTo(item: OutlineItem): Promise<void> {
    const pageNumber = await this.resolvePageNumber(item);
    if (pageNumber !== null) {
      this.nav.goToPage(pageNumber);
    }
  }
}
