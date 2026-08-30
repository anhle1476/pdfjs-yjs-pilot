// SearchHighlighter — demo-side glue that paints SearchController matches onto
// the pdf.js text-layer spans, replicating pdf.js TextHighlighter minimally.
//
// The lib's SearchController yields per-page matches as {start, length} offsets
// into the ORIGINAL page text, where the page text is the concatenation of each
// text item's `str`, plus a "\n" after any item whose `hasEOL` is true (this is
// exactly how SearchController.ensurePageContent builds the raw text before
// normalize()). The pdf.js TextLayer renders one <span> per text item (EOL
// markers are emitted as `.endOfLine` break spans with no text). So to map a
// char range onto the DOM we:
//
//   1. Re-read the page's text items (getTextContent) to learn each item's
//      string length and hasEOL flag, and thereby the item's start offset in
//      the same coordinate space SearchController used.
//   2. Collect the rendered glyph spans in document order (skipping the
//      break/endOfLine spans that carry no glyphs).
//   3. For a match [start, start+length), find the spans it overlaps and wrap
//      the covered substring(s) in <span class="search-highlight"> (adding
//      `selected` for the current match), while leaving the surrounding text
//      intact so text selection and the --total-scale-factor glyph scaling are
//      preserved (we only ever rewrite the innerHTML of spans we touch, and we
//      keep their exact original text content split across sibling text/inner
//      spans).
//
// Re-application: the host calls highlightPage() again whenever a page's text
// layer is (re)built (zoom / rotation / view-mode / navigation), after clearing
// prior highlight markup via clearPage().

import type { PdfRenderer } from '../lib';
import type { SearchController } from '../lib';

interface SpanRange {
  span: HTMLElement;
  /** start offset of this span's text within the joined page text */
  start: number;
  /** length of this span's text */
  length: number;
  /** the span's rendered text content */
  text: string;
}

export class SearchHighlighter {
  private renderer: PdfRenderer;
  private search: SearchController;
  // Monotonic generation; any clearAll/highlightAll bumps it so in-flight
  // per-page paints from an older generation abort before mutating the DOM.
  private generation = 0;

  constructor(renderer: PdfRenderer, search: SearchController) {
    this.renderer = renderer;
    this.search = search;
  }

  /** Invalidate cached per-page state (e.g. on document reload). */
  public reset(): void {
    this.generation++;
  }

  /** Re-highlight every currently rendered page. */
  public async highlightAll(): Promise<void> {
    const gen = ++this.generation;
    const views = this.renderer.getAllPageViews();
    await Promise.all(views.map((v) => this.highlightPage(v.pageNumber, gen)));
  }

  /** Remove all highlight markup from every currently rendered page. */
  public clearAll(): void {
    this.generation++;
    for (const v of this.renderer.getAllPageViews()) {
      this.clearPage(v.pageNumber);
    }
  }

  /** Remove highlight markup from a single page's text layer. */
  public clearPage(pageNumber: number): void {
    const view = this.renderer.getPageView(pageNumber);
    if (!view) return;
    this.unwrapHighlights(view.textLayer);
  }

  /**
   * Paint the SearchController matches for `pageNumber` onto its text layer.
   * Safe to call repeatedly; it first clears any prior markup.
   */
  public async highlightPage(pageNumber: number, gen?: number): Promise<void> {
    const myGen = gen ?? ++this.generation;
    const view = this.renderer.getPageView(pageNumber);
    if (!view) return;

    // Always clear first so re-application (zoom/nav/rebuild) is idempotent.
    this.unwrapHighlights(view.textLayer);

    // Only paint if this page actually has matches for the current query.
    if (this.search.getPageMatches(pageNumber).length === 0) return;
    const query = this.search.getState().query;
    if (!query) return;

    // Build the page text from the ACTUAL rendered glyph spans (span-space),
    // tracking each span's [start,length) within that concatenation. This is
    // the exact text the user sees, so matching against it (via the controller's
    // matchText, which reuses the same normalize + RegExp) yields offsets that
    // line up with the spans perfectly — no drift from ligatures, stray spaces,
    // or empty items in the item-based page text.
    const spanRanges = this.collectSpanRangesFromDom(view.textLayer);
    if (spanRanges.length === 0) return;

    // A newer generation (clearAll/highlightAll) superseded us — bail before
    // touching the DOM (kept for symmetry; this path has no async gap now).
    if (myGen !== this.generation) return;
    const liveView = this.renderer.getPageView(pageNumber);
    if (!liveView || liveView.textLayer !== view.textLayer) return;

    const pageText = spanRanges.map((s) => s.text).join('');
    const domMatches = this.search.matchText(pageText);
    if (domMatches.length === 0) return;

    // Which match on this page is the selected one? matchText enumerates
    // matches in the same document order the controller does, so the selected
    // match's index-in-page maps 1:1.
    const selected = this.search.getSelectedMatch();
    const selectedIndex =
      selected && selected.pageNumber === pageNumber
        ? selected.matchIndexInPage
        : -1;

    domMatches.forEach((match, i) => {
      this.applyMatch(spanRanges, match, i === selectedIndex);
    });
  }

  /**
   * Scroll the currently selected match into view within the viewer container,
   * if it is on the given page and currently highlighted.
   */
  public scrollSelectedIntoView(): void {
    const selected = this.search.getSelectedMatch();
    if (!selected) return;
    const view = this.renderer.getPageView(selected.pageNumber);
    if (!view) return;
    const el = view.textLayer.querySelector<HTMLElement>(
      '.search-highlight.selected'
    );
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }
  }

  // ----- internals -----

  /**
   * Collect the rendered glyph spans (document order, skipping structural
   * break/markedContent spans) and record each span's [start,length) within the
   * concatenation of their text content, plus the text itself. This IS the text
   * the user sees, so offsets computed by matching against the joined text line
   * up with the spans exactly.
   */
  private collectSpanRangesFromDom(textLayer: HTMLElement): SpanRange[] {
    const ranges: SpanRange[] = [];
    let offset = 0;
    for (const child of Array.from(textLayer.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.tagName !== 'SPAN') continue;
      if (
        child.classList.contains('endOfLine') ||
        child.classList.contains('markedContent')
      ) {
        continue;
      }
      const text = child.textContent ?? '';
      ranges.push({ span: child, start: offset, length: text.length, text });
      offset += text.length;
    }
    return ranges;
  }


  /** Wrap the covered substring(s) of a single match across the spans. */
  private applyMatch(
    spanRanges: SpanRange[],
    match: { start: number; length: number },
    isSelected: boolean
  ): void {
    const matchStart = match.start;
    const matchEnd = match.start + match.length;
    if (match.length <= 0) return;

    for (const sr of spanRanges) {
      const spanStart = sr.start;
      const spanEnd = sr.start + sr.length;
      // Overlap of [matchStart, matchEnd) with [spanStart, spanEnd).
      const from = Math.max(matchStart, spanStart);
      const to = Math.min(matchEnd, spanEnd);
      if (from >= to) continue;

      const localFrom = from - spanStart;
      const localTo = to - spanStart;
      this.wrapSpanRange(sr.span, localFrom, localTo, isSelected);
    }
  }

  /**
   * Wrap chars [from, to) of `span`'s text content in a highlight span while
   * preserving the surrounding text as sibling text nodes. Re-entrant: a span
   * may already contain prior highlight markup from an earlier match, so we
   * operate on the concatenated text and rebuild, re-applying any existing
   * highlight ranges we can detect. To keep it simple and correct, we track
   * applied ranges via data attributes on the span and rebuild from scratch.
   */
  private wrapSpanRange(
    span: HTMLElement,
    from: number,
    to: number,
    isSelected: boolean
  ): void {
    // Accumulate highlight ranges on the span, then render once. Ranges are
    // stored as JSON on a data attribute so multiple matches on the same span
    // (and re-entrant calls) compose correctly.
    const key = '__searchRanges';
    const store = (span as unknown as Record<string, unknown>)[key] as
      | Array<{ from: number; to: number; selected: boolean }>
      | undefined;
    const ranges = store ?? [];
    ranges.push({ from, to, selected: isSelected });
    (span as unknown as Record<string, unknown>)[key] = ranges;

    // Original (un-highlighted) text is captured once.
    const origKey = '__searchOrigText';
    let orig = (span as unknown as Record<string, unknown>)[origKey] as
      | string
      | undefined;
    if (orig === undefined) {
      orig = span.textContent ?? '';
      (span as unknown as Record<string, unknown>)[origKey] = orig;
    }

    this.renderSpan(span, orig, ranges);
  }

  /** Render `orig` text into `span`, wrapping the given ranges. */
  private renderSpan(
    span: HTMLElement,
    orig: string,
    ranges: Array<{ from: number; to: number; selected: boolean }>
  ): void {
    // Build a boolean/selected map per char, then emit runs.
    const len = orig.length;
    const hl = new Array<0 | 1 | 2>(len).fill(0); // 0 none, 1 highlight, 2 selected
    for (const r of ranges) {
      const a = Math.max(0, r.from);
      const b = Math.min(len, r.to);
      for (let i = a; i < b; i++) {
        if (r.selected) hl[i] = 2;
        else if (hl[i] === 0) hl[i] = 1;
      }
    }

    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < len) {
      const state = hl[i];
      let j = i + 1;
      while (j < len && hl[j] === state) j++;
      const text = orig.slice(i, j);
      if (state === 0) {
        frag.appendChild(document.createTextNode(text));
      } else {
        const mark = document.createElement('span');
        mark.className =
          state === 2 ? 'search-highlight selected' : 'search-highlight';
        mark.textContent = text;
        frag.appendChild(mark);
      }
      i = j;
    }

    span.textContent = '';
    span.appendChild(frag);
  }

  /** Strip any highlight markup, restoring each touched span's original text. */
  private unwrapHighlights(textLayer: HTMLElement): void {
    const origKey = '__searchOrigText';
    const rangesKey = '__searchRanges';
    // Any span that carries our original-text record must be restored.
    const spans = textLayer.querySelectorAll<HTMLElement>('span');
    for (const span of Array.from(spans)) {
      const rec = (span as unknown as Record<string, unknown>)[origKey] as
        | string
        | undefined;
      if (rec !== undefined) {
        span.textContent = rec;
        delete (span as unknown as Record<string, unknown>)[origKey];
        delete (span as unknown as Record<string, unknown>)[rangesKey];
      }
    }
  }
}
