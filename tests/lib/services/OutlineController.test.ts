import { describe, expect, it } from 'vitest';
import {
  OutlineController,
  type OutlineDocumentProxy,
  type OutlineNavigationFacade,
  type RawOutlineNode,
} from '../../../src/lib/services/OutlineController';

function makeNav(): OutlineNavigationFacade & { page: number } {
  const nav = {
    page: 1,
    goToPage(n: number) {
      nav.page = n;
    },
  };
  return nav;
}

/** A fake doc where named destinations resolve to a ref, and getPageIndex maps
 * refs -> 0-based page index. */
function makeFakeDoc(opts: {
  outline: RawOutlineNode[] | null;
  destinations?: Record<string, unknown[]>;
  pageIndexForRef?: (ref: unknown) => number;
}): OutlineDocumentProxy {
  return {
    async getOutline() {
      return opts.outline;
    },
    async getDestination(dest: string) {
      return opts.destinations?.[dest] ?? null;
    },
    async getPageIndex(ref: unknown) {
      if (opts.pageIndexForRef) return opts.pageIndexForRef(ref);
      throw new Error('no page index');
    },
  };
}

describe('OutlineController — empty outline', () => {
  it('load() returns [] and hasOutline() is false when getOutline() is empty', async () => {
    const doc = makeFakeDoc({ outline: [] });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const items = await oc.load();
    expect(items).toEqual([]);
    expect(oc.hasOutline()).toBe(false);
  });

  it('handles getOutline() returning null', async () => {
    const doc = makeFakeDoc({ outline: null });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const items = await oc.load();
    expect(items).toEqual([]);
    expect(oc.hasOutline()).toBe(false);
  });

  it('handles a null document gracefully', async () => {
    const oc = new OutlineController({ getDocument: () => null, navigation: makeNav() });
    const items = await oc.load();
    expect(items).toEqual([]);
    expect(oc.hasOutline()).toBe(false);
  });
});

describe('OutlineController — normalization', () => {
  it('normalizes nodes with style, color, nesting, and stable ids', async () => {
    const outline: RawOutlineNode[] = [
      {
        title: 'Chapter 1',
        bold: true,
        italic: false,
        color: new Uint8ClampedArray([255, 0, 0]),
        dest: 'ch1',
        items: [
          { title: 'Section 1.1', dest: [{ num: 5, gen: 0 }, { name: 'XYZ' }] },
        ],
      },
      { title: 'External', url: 'https://example.com', dest: null },
    ];
    const doc = makeFakeDoc({ outline });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const items = await oc.load();

    expect(oc.hasOutline()).toBe(true);
    expect(items).toHaveLength(2);

    expect(items[0]).toMatchObject({
      title: 'Chapter 1',
      bold: true,
      italic: false,
      color: [255, 0, 0],
      hasChildren: true,
      _id: '0',
      url: null,
    });
    expect(items[0].items[0]).toMatchObject({
      title: 'Section 1.1',
      hasChildren: false,
      _id: '0.0',
    });
    expect(items[1]).toMatchObject({
      title: 'External',
      url: 'https://example.com',
      color: null,
      dest: null,
      _id: '1',
    });
  });
});

describe('OutlineController — dest -> page resolution', () => {
  it('resolves a named (string) destination via getDestination + getPageIndex', async () => {
    const ref = { num: 10, gen: 0 };
    const doc = makeFakeDoc({
      outline: [{ title: 'Ch', dest: 'named-dest' }],
      destinations: { 'named-dest': [ref, { name: 'Fit' }] },
      pageIndexForRef: (r) => (r === ref ? 4 : -1), // 0-based -> page 5
    });
    const nav = makeNav();
    const oc = new OutlineController({ getDocument: () => doc, navigation: nav });
    const [item] = await oc.load();

    const page = await oc.resolvePageNumber(item);
    expect(page).toBe(5); // pageIndex 4 + 1

    await oc.goTo(item);
    expect(nav.page).toBe(5);
  });

  it('resolves an explicit array destination with an object ref', async () => {
    const ref = { num: 2, gen: 0 };
    const doc = makeFakeDoc({
      outline: [{ title: 'Ch', dest: [ref, { name: 'XYZ' }] }],
      pageIndexForRef: (r) => (r === ref ? 0 : -1), // page 1
    });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const [item] = await oc.load();
    expect(await oc.resolvePageNumber(item)).toBe(1);
  });

  it('resolves an explicit array destination with an integer ref', async () => {
    const doc = makeFakeDoc({
      outline: [{ title: 'Ch', dest: [7, { name: 'Fit' }] }],
    });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const [item] = await oc.load();
    expect(await oc.resolvePageNumber(item)).toBe(8); // integer 7 + 1
  });

  it('returns null for a null dest (e.g. external URL item)', async () => {
    const doc = makeFakeDoc({
      outline: [{ title: 'Ext', dest: null, url: 'https://x.com' }],
    });
    const nav = makeNav();
    const oc = new OutlineController({ getDocument: () => doc, navigation: nav });
    const [item] = await oc.load();
    expect(await oc.resolvePageNumber(item)).toBeNull();

    await oc.goTo(item); // should NOT navigate
    expect(nav.page).toBe(1);
  });

  it('returns null when a named destination cannot be found', async () => {
    const doc = makeFakeDoc({
      outline: [{ title: 'Ch', dest: 'missing' }],
      destinations: {},
    });
    const oc = new OutlineController({ getDocument: () => doc, navigation: makeNav() });
    const [item] = await oc.load();
    expect(await oc.resolvePageNumber(item)).toBeNull();
  });
});
