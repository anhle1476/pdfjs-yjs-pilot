import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  SearchController,
  normalize,
  getOriginalIndex,
  type SearchDocumentProxy,
  type SearchNavigationFacade,
} from '../../../src/lib/services/SearchController';

// ---- Fakes ----

/**
 * Build a fake PDFDocumentProxy that feeds synthetic page text. Each page is
 * given as an array of "items" {str, hasEOL} mirroring pdf.js text content.
 */
function makeFakeDoc(pages: Array<Array<{ str: string; hasEOL?: boolean }>>): SearchDocumentProxy {
  return {
    numPages: pages.length,
    async getPage(pageNumber: number) {
      const items = pages[pageNumber - 1] ?? [];
      return {
        async getTextContent() {
          return { items };
        },
      };
    },
  };
}

function makeNav(initialPage = 1): SearchNavigationFacade & { page: number } {
  const nav = {
    page: initialPage,
    getCurrentPage() {
      return nav.page;
    },
    goToPage(n: number) {
      nav.page = n;
    },
    getTotalPages() {
      return 999;
    },
  };
  return nav;
}

describe('normalize()', () => {
  it('joins hyphenated end-of-line words', () => {
    const { normalized } = normalize('func-\ntion');
    expect(normalized).toBe('function');
  });

  it('joins hyphen-EOL with trailing spaces before the newline', () => {
    const { normalized } = normalize('inter- \nnational');
    expect(normalized).toBe('international');
  });

  it('does NOT join a hyphen that is not at end of line', () => {
    const { normalized } = normalize('well-known');
    expect(normalized).toBe('well-known');
  });

  it('maps curly quotes and dashes to ASCII', () => {
    const { normalized } = normalize('\u2018a\u2019 \u201Cb\u201D \u2014');
    expect(normalized).toBe("'a' \"b\" -");
  });

  it('NFKC-folds ligatures', () => {
    const { normalized } = normalize('\uFB01le'); // ﬁle
    expect(normalized).toBe('file');
  });

  it('produces diffs that map normalized index back to original', () => {
    // "func-\ntion" -> "function". Normalized index of 't' is 4.
    const { normalized, diffs } = normalize('func-\ntion');
    const tIdx = normalized.indexOf('t'); // 4
    // In the original, 't' is at index 6 (after "func-\n").
    expect(getOriginalIndex(diffs, tIdx)).toBe(6);
    // Index 0 maps to 0.
    expect(getOriginalIndex(diffs, 0)).toBe(0);
  });
});

describe('SearchController — match counting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function search(sc: SearchController, q: string, opts = {}) {
    sc.setQuery(q, opts);
    await vi.advanceTimersByTimeAsync(300);
  }

  it('counts matches across pages and reports total', async () => {
    const doc = makeFakeDoc([
      [{ str: 'the cat sat', hasEOL: true }],
      [{ str: 'the dog ran the fox', hasEOL: true }],
      [{ str: 'nothing here' }],
    ]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });

    await search(sc, 'the');
    const state = sc.getState();
    // page1: 1 "the", page2: 2 "the" => total 3
    expect(state.total).toBe(3);
    expect(state.status).toBe('found');
    expect(state.current).toBe(1);
    expect(sc.getSelectedMatch()?.pageNumber).toBe(1);

    sc.destroy();
  });

  it('reports not-found when there are zero matches', async () => {
    const doc = makeFakeDoc([[{ str: 'hello world' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'zzz');
    expect(sc.getState().status).toBe('not-found');
    expect(sc.getState().total).toBe(0);
    sc.destroy();
  });

  it('caseSensitive option distinguishes case', async () => {
    const doc = makeFakeDoc([[{ str: 'The the THE' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });

    await search(sc, 'the', { caseSensitive: false });
    expect(sc.getState().total).toBe(3);

    await search(sc, 'the', { caseSensitive: true });
    expect(sc.getState().total).toBe(1);

    sc.destroy();
  });

  it('entireWord option matches only whole words', async () => {
    const doc = makeFakeDoc([[{ str: 'cat category cat' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });

    await search(sc, 'cat', { entireWord: false });
    expect(sc.getState().total).toBe(3); // cat, cat(egory), cat

    await search(sc, 'cat', { entireWord: true });
    expect(sc.getState().total).toBe(2); // only standalone "cat"

    sc.destroy();
  });

  it('getPageMatches returns per-page start/length in original text', async () => {
    const doc = makeFakeDoc([[{ str: 'abc cat def cat' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'cat');
    const matches = sc.getPageMatches(1);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ matchIndexInPage: 0, start: 4, length: 3 });
    expect(matches[1]).toMatchObject({ matchIndexInPage: 1, start: 12, length: 3 });
    sc.destroy();
  });

  it('maps match offsets through hyphen-EOL join back to original text', async () => {
    // "func-\ntion" normalizes to "function"; a search for "function" should
    // map back to start=0 length=10 (original spans the hyphen + newline).
    const doc = makeFakeDoc([[{ str: 'func-\ntion' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'function');
    const matches = sc.getPageMatches(1);
    expect(matches).toHaveLength(1);
    expect(matches[0].start).toBe(0);
    expect(matches[0].length).toBe(10);
    sc.destroy();
  });
});

describe('SearchController — navigation & wrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function search(sc: SearchController, q: string) {
    sc.setQuery(q);
    await vi.advanceTimersByTimeAsync(300);
  }

  it('findNext advances and jumps to the page of the next match', async () => {
    const doc = makeFakeDoc([
      [{ str: 'the' }], // page1: 1 match
      [{ str: 'the the' }], // page2: 2 matches
    ]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'the');

    // Initial selection: page1 match1 => current 1
    expect(sc.getState().current).toBe(1);
    expect(nav.page).toBe(1);

    sc.findNext(); // -> page2 match1 (current 2), navigate to page 2
    expect(sc.getState().current).toBe(2);
    expect(sc.getSelectedMatch()?.pageNumber).toBe(2);
    expect(nav.page).toBe(2);

    sc.findNext(); // -> page2 match2 (current 3)
    expect(sc.getState().current).toBe(3);
    expect(nav.page).toBe(2);

    sc.destroy();
  });

  it('findNext wraps around to the first match with wrapped status', async () => {
    const doc = makeFakeDoc([[{ str: 'the the' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'the');

    expect(sc.getState().current).toBe(1);
    sc.findNext(); // current 2
    expect(sc.getState().current).toBe(2);
    sc.findNext(); // wrap -> current 1
    expect(sc.getState().current).toBe(1);
    expect(sc.getState().status).toBe('wrapped');

    sc.destroy();
  });

  it('findPrevious wraps backward to the last match', async () => {
    const doc = makeFakeDoc([
      [{ str: 'the' }],
      [{ str: 'the the' }],
    ]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'the'); // selected: page1 match1, current 1

    sc.findPrevious(); // wrap back to last (page2 match2), current 3
    expect(sc.getState().current).toBe(3);
    expect(sc.getState().status).toBe('wrapped');
    expect(nav.page).toBe(2);

    sc.destroy();
  });

  it('initial selection prefers first match at/after current page', async () => {
    const doc = makeFakeDoc([
      [{ str: 'the' }], // page1
      [{ str: 'the' }], // page2
      [{ str: 'the' }], // page3
    ]);
    const nav = makeNav(2); // currently on page 2
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'the');

    // Should select the match on page 2 (current=2), not page 1.
    expect(sc.getSelectedMatch()?.pageNumber).toBe(2);
    expect(sc.getState().current).toBe(2);

    sc.destroy();
  });

  it('clear resets state to idle', async () => {
    const doc = makeFakeDoc([[{ str: 'the' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    await search(sc, 'the');
    expect(sc.getState().status).toBe('found');
    sc.clear();
    expect(sc.getState().status).toBe('idle');
    expect(sc.getState().total).toBe(0);
    expect(sc.getSelectedMatch()).toBeNull();
    sc.destroy();
  });

  it('subscribe notifies on state changes and unsubscribe stops them', async () => {
    const doc = makeFakeDoc([[{ str: 'the the' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    let count = 0;
    const unsub = sc.subscribe(() => {
      count++;
    });
    await search(sc, 'the'); // pending emit + found emit
    expect(count).toBeGreaterThan(0);
    const afterSearch = count;
    unsub();
    sc.findNext();
    expect(count).toBe(afterSearch);
    sc.destroy();
  });

  it('debounces setQuery (250ms)', async () => {
    const doc = makeFakeDoc([[{ str: 'the' }]]);
    const nav = makeNav(1);
    const sc = new SearchController({ navigation: nav, getDocument: () => doc });
    sc.setQuery('the');
    expect(sc.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(100);
    expect(sc.getState().status).toBe('pending'); // not yet
    await vi.advanceTimersByTimeAsync(200);
    expect(sc.getState().status).toBe('found');
    sc.destroy();
  });
});
