// SearchController — framework-free port of the pdf.js PDFFindController find
// algorithm. It has NO UI dependency, installs NO listeners, and does not
// import any demo code. It depends only on two injected facades:
//
//   - a navigation facade (getCurrentPage / goToPage / getTotalPages) so it can
//     jump to the page of a match, and
//   - a document provider that yields the PDFDocumentProxy (or something that
//     can produce per-page text) lazily.
//
// The algorithm mirrors pdf.js: per-page text extraction via
// getTextContent({disableNormalization:true}), a normalize() pass, per-page
// RegExp matching (flags by caseSensitive + entireWord), an offset/selected
// cursor with wrap-around, and a debounced query (FIND_TIMEOUT = 250ms).

/** Minimal shape of a pdf.js text content item we depend on. */
export interface SearchTextItem {
  str: string;
  hasEOL?: boolean;
}

/** Minimal shape of a pdf.js page proxy we depend on. */
export interface SearchPageProxy {
  getTextContent(options?: {
    disableNormalization?: boolean;
  }): Promise<{ items: Array<SearchTextItem | { type?: string }> }>;
}

/** Minimal shape of a pdf.js document proxy we depend on. */
export interface SearchDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<SearchPageProxy>;
}

/** Navigation facade — matches PdfRenderer's public surface. */
export interface SearchNavigationFacade {
  getCurrentPage(): number;
  goToPage(pageNumber: number): void;
  getTotalPages(): number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  entireWord?: boolean;
}

export type SearchStatus = 'idle' | 'pending' | 'found' | 'not-found' | 'wrapped';

export interface SearchState {
  query: string;
  status: SearchStatus;
  /** 1-based index of the currently selected match across the whole doc. */
  current: number;
  /** Grand total number of matches across the whole doc. */
  total: number;
  options: Required<SearchOptions>;
}

export interface SelectedMatch {
  pageNumber: number;
  matchIndexInPage: number;
  /** Start offset of the match in the *original* (un-normalized) page text. */
  start: number;
  /** Length of the match in the *original* page text. */
  length: number;
}

export interface PageMatch {
  matchIndexInPage: number;
  /** Start offset in original page text. */
  start: number;
  /** Length in original page text. */
  length: number;
  /** Start offset in the NORMALIZED (NFKC) page text. */
  normStart: number;
  /** Length in the NORMALIZED (NFKC) page text. */
  normLength: number;
}

export interface SearchControllerDeps {
  navigation: SearchNavigationFacade;
  /** Lazily yields the document; may return null before load completes. */
  getDocument: () => SearchDocumentProxy | null;
  /** Debounce for setQuery in ms. Defaults to 250 (pdf.js FIND_TIMEOUT). */
  findTimeout?: number;
}

const FIND_TIMEOUT = 250;

// ---- normalize() — faithful reduced version of pdf.js normalize() ----
//
// pdf.js normalize maps curly quotes/dashes, NFKC-folds ligatures, joins
// hyphenated end-of-line words, and optionally folds diacritics, returning
// [normalizedText, diffs, hasDiacritics] where diffs map normalized indices
// back to original ones. Here we implement:
//   - NFKC normalization (folds ligatures like ﬁ -> fi, full-width forms, …),
//   - curly-quote / dash mapping to ASCII,
//   - hyphenated end-of-line join (word-\n -> word),
//   - a diffs array so match offsets can be mapped back to the ORIGINAL text.
//
// diffs is a sorted list of { normIndex, delta } where `delta` is the running
// difference (originalIndex - normalizedIndex) that applies at and after
// normIndex. getOriginalIndex(normIndex) resolves original positions.

const CHAR_MAP: Record<string, string> = {
  '\u2018': "'", // ‘
  '\u2019': "'", // ’
  '\u201A': "'", // ‚
  '\u201B': "'", // ‛
  '\u201C': '"', // “
  '\u201D': '"', // ”
  '\u201E': '"', // „
  '\u201F': '"', // ‟
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u2012': '-', // figure dash
  '\u2013': '-', // en dash
  '\u2014': '-', // em dash
  '\u2015': '-', // horizontal bar
  '\u00A0': ' ', // nbsp
};

interface Diff {
  /** Index in normalized string at which `delta` starts to apply. */
  normIndex: number;
  /** originalIndex - normalizedIndex for positions >= normIndex. */
  delta: number;
}

export interface NormalizeResult {
  normalized: string;
  diffs: Diff[];
}

/**
 * Faithful reduced normalize(). Produces normalized text plus a diffs table for
 * mapping normalized offsets back to original offsets.
 */
export function normalize(text: string): NormalizeResult {
  const diffs: Diff[] = [];
  let normalized = '';
  let origIndex = 0; // index into original `text`
  let normIndex = 0; // index into `normalized`
  let runningDelta = 0;
  let lastDelta: number | null = null;

  const pushDelta = (atNorm: number, delta: number) => {
    if (delta !== lastDelta) {
      diffs.push({ normIndex: atNorm, delta });
      lastDelta = delta;
    }
  };

  const chars = Array.from(text); // handle surrogate pairs
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const origLen = ch.length; // code units in original

    // Hyphenated end-of-line join: "-\n" (optionally with spaces) collapses to
    // nothing so "func-\ntion" -> "function".
    if (ch === '-' || CHAR_MAP[ch] === '-') {
      // Look ahead for optional spaces then a newline.
      let j = i + 1;
      let consumed = origLen;
      while (j < chars.length && (chars[j] === ' ' || chars[j] === '\t')) {
        consumed += chars[j].length;
        j++;
      }
      if (j < chars.length && (chars[j] === '\n' || chars[j] === '\r')) {
        // Consume the newline(s) too.
        consumed += chars[j].length;
        j++;
        if (j < chars.length && chars[j] === '\n' && chars[j - 1] === '\r') {
          consumed += chars[j].length;
          j++;
        }
        // Emit nothing; advance runningDelta by everything we consumed.
        origIndex += consumed;
        runningDelta = origIndex - normIndex;
        pushDelta(normIndex, runningDelta);
        i = j - 1;
        continue;
      }
    }

    // Map curly quotes / dashes / nbsp to ASCII.
    let mapped = CHAR_MAP[ch] ?? ch;

    // NFKC fold (ligatures, full-width forms, etc.). May expand to multiple
    // chars (e.g. ﬁ -> fi).
    mapped = mapped.normalize('NFKC');

    normalized += mapped;
    origIndex += origLen;
    normIndex += mapped.length;
    runningDelta = origIndex - normIndex;
    pushDelta(normIndex, runningDelta);
  }

  return { normalized, diffs };
}

/** Map a normalized-string index back to the original-string index. */
export function getOriginalIndex(diffs: Diff[], normIndex: number): number {
  // Find the last diff whose normIndex <= our normIndex.
  let delta = 0;
  for (const d of diffs) {
    if (d.normIndex <= normIndex) {
      delta = d.delta;
    } else {
      break;
    }
  }
  return normIndex + delta;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface PageMatchInternal {
  /** normalized start index */
  normStart: number;
  /** normalized length */
  normLength: number;
  /** original start index */
  start: number;
  /** original length */
  length: number;
}

export class SearchController {
  private nav: SearchNavigationFacade;
  private getDocument: () => SearchDocumentProxy | null;
  private findTimeout: number;

  private query = '';
  private options: Required<SearchOptions> = {
    caseSensitive: false,
    entireWord: false,
  };
  private status: SearchStatus = 'idle';

  // Per-page normalized text + diffs cache (lazy).
  private pageContents = new Map<number, NormalizeResult>();
  // Per-page match results for the current query.
  private pageMatches = new Map<number, PageMatchInternal[]>();

  // Cursor: selected match position.
  private selected: { pageIdx: number; matchIdx: number } | null = null;

  private subscribers = new Set<(state: SearchState) => void>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private searchToken = 0;
  private destroyed = false;

  constructor(deps: SearchControllerDeps) {
    this.nav = deps.navigation;
    this.getDocument = deps.getDocument;
    this.findTimeout = deps.findTimeout ?? FIND_TIMEOUT;
  }

  // ---- public API ----

  public setQuery(query: string, options: SearchOptions = {}): void {
    if (this.destroyed) return;
    this.query = query;
    this.options = {
      caseSensitive: options.caseSensitive ?? false,
      entireWord: options.entireWord ?? false,
    };

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (query.length === 0) {
      this.clear();
      return;
    }

    this.status = 'pending';
    this.emit();

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSearch();
    }, this.findTimeout);
  }

  public findNext(): void {
    void this.advance(+1);
  }

  public findPrevious(): void {
    void this.advance(-1);
  }

  public clear(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.query = '';
    this.status = 'idle';
    this.pageMatches.clear();
    this.selected = null;
    // Note: pageContents cache is retained; it only depends on the document,
    // not the query.
    this.emit();
  }

  public getState(): SearchState {
    return {
      query: this.query,
      status: this.status,
      current: this.getCurrentOrdinal(),
      total: this.getTotal(),
      options: { ...this.options },
    };
  }

  public getSelectedMatch(): SelectedMatch | null {
    if (!this.selected) return null;
    const { pageIdx, matchIdx } = this.selected;
    const pageNumber = pageIdx + 1;
    const matches = this.pageMatches.get(pageNumber);
    if (!matches || !matches[matchIdx]) return null;
    const m = matches[matchIdx];
    return {
      pageNumber,
      matchIndexInPage: matchIdx,
      start: m.start,
      length: m.length,
    };
  }

  public getPageMatches(pageNumber: number): PageMatch[] {
    const matches = this.pageMatches.get(pageNumber);
    if (!matches) return [];
    return matches.map((m, i) => ({
      matchIndexInPage: i,
      start: m.start,
      length: m.length,
      normStart: m.normStart,
      normLength: m.normLength,
    }));
  }

  public subscribe(cb: (state: SearchState) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.subscribers.clear();
    this.pageContents.clear();
    this.pageMatches.clear();
    this.selected = null;
  }

  // ---- internals ----

  private emit(): void {
    const state = this.getState();
    for (const cb of this.subscribers) {
      cb(state);
    }
  }

  private buildRegExp(): RegExp | null {
    if (!this.query) return null;
    let pattern = escapeRegExp(this.query.normalize('NFKC'));
    if (this.options.entireWord) {
      // \b-style boundaries. Use lookarounds so we don't consume chars.
      pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
    }
    let flags = 'gu';
    if (!this.options.caseSensitive) flags += 'i';
    try {
      return new RegExp(pattern, flags);
    } catch {
      // Fallback without unicode property escapes if unsupported.
      let fb = escapeRegExp(this.query);
      if (this.options.entireWord) fb = `\\b${fb}\\b`;
      let fbFlags = 'g';
      if (!this.options.caseSensitive) fbFlags += 'i';
      return new RegExp(fb, fbFlags);
    }
  }

  /**
   * Run the current query against an arbitrary text string and return matches
   * as offsets into THAT string. Lets a DOM-side highlighter locate matches
   * directly in the exact text the text-layer rendered, avoiding any drift
   * between the item-based page text used internally and the rendered spans
   * (pdf.js may NFKC-normalize glyphs or add stray spaces per span). Uses the
   * same normalize() + query RegExp as the page search.
   */
  public matchText(text: string): Array<{ start: number; length: number }> {
    const re = this.buildRegExp();
    if (!re) return [];
    const { normalized, diffs } = normalize(text);
    const out: Array<{ start: number; length: number }> = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      const normStart = m.index;
      const normEnd = m.index + m[0].length;
      const start = getOriginalIndex(diffs, normStart);
      const end =
        m[0].length > 0
          ? getOriginalIndex(diffs, normEnd - 1) + 1
          : getOriginalIndex(diffs, normEnd);
      out.push({ start, length: Math.max(0, end - start) });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  private async ensurePageContent(pageNumber: number): Promise<NormalizeResult | null> {
    const cached = this.pageContents.get(pageNumber);
    if (cached) return cached;

    const doc = this.getDocument();
    if (!doc) return null;

    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent({ disableNormalization: true });

    let raw = '';
    for (const item of content.items) {
      const it = item as SearchTextItem;
      if (typeof it.str === 'string') {
        raw += it.str;
        if (it.hasEOL) raw += '\n';
      }
    }

    const result = normalize(raw);
    this.pageContents.set(pageNumber, result);
    return result;
  }

  private async runSearch(): Promise<void> {
    const token = ++this.searchToken;
    const doc = this.getDocument();
    this.pageMatches.clear();
    this.selected = null;

    if (!doc || !this.query) {
      this.status = this.query ? 'not-found' : 'idle';
      this.emit();
      return;
    }

    const re = this.buildRegExp();
    if (!re) {
      this.status = 'not-found';
      this.emit();
      return;
    }

    const numPages = doc.numPages;
    for (let p = 1; p <= numPages; p++) {
      const content = await this.ensurePageContent(p);
      if (token !== this.searchToken || this.destroyed) return; // superseded
      if (!content) continue;

      const matches = this.matchPage(content, re);
      if (matches.length > 0) {
        this.pageMatches.set(p, matches);
      }
    }

    if (token !== this.searchToken) return;

    const total = this.getTotal();
    if (total === 0) {
      this.status = 'not-found';
      this.selected = null;
      this.emit();
      return;
    }

    // Select the first match at/after the current page, else the first overall.
    this.selectInitial();
    this.status = 'found';
    this.emit();
    this.navigateToSelected();
  }

  private matchPage(content: NormalizeResult, re: RegExp): PageMatchInternal[] {
    const results: PageMatchInternal[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content.normalized)) !== null) {
      const normStart = m.index;
      const normEnd = m.index + m[0].length;
      const start = getOriginalIndex(content.diffs, normStart);
      // Map the END using the match's LAST normalized char (normEnd - 1) then
      // +1, rather than normEnd directly. A deletion in the diffs table (e.g. a
      // hyphenated end-of-line join that removed "-\n") takes effect exactly at
      // a normIndex boundary; querying getOriginalIndex(normEnd) at that
      // boundary would pick up the post-deletion delta and stretch the match to
      // swallow the removed characters (so "Trace" would highlight "Trace-").
      // Anchoring on the last matched char avoids that.
      const end =
        m[0].length > 0
          ? getOriginalIndex(content.diffs, normEnd - 1) + 1
          : getOriginalIndex(content.diffs, normEnd);
      results.push({ normStart, normLength: m[0].length, start, length: Math.max(0, end - start) });
      if (m[0].length === 0) {
        re.lastIndex++; // avoid infinite loop on zero-length matches
      }
    }
    return results;
  }

  private selectInitial(): void {
    const currentPage = this.nav.getCurrentPage();
    const pagesWithMatches = this.sortedMatchPages();
    // First page >= currentPage that has matches.
    let pageNumber =
      pagesWithMatches.find((p) => p >= currentPage) ?? pagesWithMatches[0];
    if (pageNumber === undefined) {
      this.selected = null;
      return;
    }
    this.selected = { pageIdx: pageNumber - 1, matchIdx: 0 };
  }

  private sortedMatchPages(): number[] {
    return Array.from(this.pageMatches.keys()).sort((a, b) => a - b);
  }

  private async advance(dir: 1 | -1): Promise<void> {
    if (this.destroyed) return;

    // If no active results yet but there's a query, run search first.
    if (this.pageMatches.size === 0) {
      if (this.query) {
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        await this.runSearch();
      }
      if (this.pageMatches.size === 0) return;
      // runSearch already selected + navigated to the initial match.
      return;
    }

    if (!this.selected) {
      this.selectInitial();
      this.emit();
      this.navigateToSelected();
      return;
    }

    const pages = this.sortedMatchPages();
    let { pageIdx, matchIdx } = this.selected;
    const pageNumber = pageIdx + 1;
    let pos = pages.indexOf(pageNumber);
    if (pos === -1) pos = 0;

    let wrapped = false;
    const matches = this.pageMatches.get(pages[pos])!;

    if (dir === 1) {
      if (matchIdx + 1 < matches.length) {
        matchIdx++;
      } else {
        pos++;
        if (pos >= pages.length) {
          pos = 0;
          wrapped = true;
        }
        matchIdx = 0;
      }
    } else {
      if (matchIdx - 1 >= 0) {
        matchIdx--;
      } else {
        pos--;
        if (pos < 0) {
          pos = pages.length - 1;
          wrapped = true;
        }
        matchIdx = this.pageMatches.get(pages[pos])!.length - 1;
      }
    }

    this.selected = { pageIdx: pages[pos] - 1, matchIdx };
    this.status = wrapped ? 'wrapped' : 'found';
    this.emit();
    this.navigateToSelected();
  }

  private navigateToSelected(): void {
    if (!this.selected) return;
    const targetPage = this.selected.pageIdx + 1;
    if (targetPage !== this.nav.getCurrentPage()) {
      this.nav.goToPage(targetPage);
    }
  }

  private getTotal(): number {
    let total = 0;
    for (const matches of this.pageMatches.values()) {
      total += matches.length;
    }
    return total;
  }

  private getCurrentOrdinal(): number {
    if (!this.selected) return 0;
    const pages = this.sortedMatchPages();
    const selectedPage = this.selected.pageIdx + 1;
    let ordinal = 0;
    for (const p of pages) {
      if (p < selectedPage) {
        ordinal += this.pageMatches.get(p)!.length;
      } else if (p === selectedPage) {
        ordinal += this.selected.matchIdx + 1;
        break;
      }
    }
    return ordinal;
  }
}
