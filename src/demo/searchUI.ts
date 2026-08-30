// Search + Table-of-Contents (outline) UI for the demo.
//
// Pure DOM, framework-free. It only reads state from and invokes callbacks
// against the lib controllers via the options object supplied by main.ts. The
// controllers themselves (SearchController / OutlineController) live in src/lib
// and own no UI.

import type { SearchState, OutlineItem } from '../lib';

export interface SearchUiOptions {
  /** Update the active search query (debounced inside SearchController). */
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClear: () => void;
  /** Current search state (counter, status). */
  getSearchState: () => SearchState;

  /** Load + return the outline items (may be empty). */
  loadOutline: () => Promise<OutlineItem[]>;
  hasOutline: () => boolean;
  onOutlineItemClick: (item: OutlineItem) => void;
}

let searchInput: HTMLInputElement | null = null;
let counterEl: HTMLElement | null = null;
let prevBtn: HTMLButtonElement | null = null;
let nextBtn: HTMLButtonElement | null = null;
let tocPanel: HTMLElement | null = null;
let tocToggleBtn: HTMLButtonElement | null = null;
let opts: SearchUiOptions | null = null;

/**
 * Build the search toolbar + TOC toggle/panel and mount them into #app. Returns
 * nothing; call updateSearchUi() to reflect controller state.
 */
export function createSearchUi(options: SearchUiOptions): void {
  opts = options;

  const app = document.getElementById('app');
  if (!app) return;

  // Avoid duplicate bars on hot-reload / re-init.
  document.getElementById('search-bar')?.remove();
  document.getElementById('toc-panel')?.remove();

  // ----- Search bar (top of the viewer) -----
  const bar = document.createElement('div');
  bar.id = 'search-bar';
  bar.className = 'search-bar';

  // TOC toggle button lives at the left of the search bar.
  tocToggleBtn = document.createElement('button');
  tocToggleBtn.id = 'toc-toggle';
  tocToggleBtn.className = 'search-btn toc-toggle-btn';
  tocToggleBtn.textContent = '☰ Contents';
  tocToggleBtn.title = 'Table of Contents';
  tocToggleBtn.addEventListener('click', () => toggleToc());
  bar.appendChild(tocToggleBtn);

  searchInput = document.createElement('input');
  searchInput.id = 'search-input';
  searchInput.type = 'text';
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Find in document…';
  searchInput.setAttribute('aria-label', 'Find in document');
  searchInput.addEventListener('input', () => {
    opts?.onQueryChange(searchInput!.value);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) opts?.onFindPrevious();
      else opts?.onFindNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      searchInput!.value = '';
      opts?.onClear();
    }
  });
  bar.appendChild(searchInput);

  counterEl = document.createElement('span');
  counterEl.id = 'search-counter';
  counterEl.className = 'search-counter';
  counterEl.textContent = '0/0';
  bar.appendChild(counterEl);

  prevBtn = document.createElement('button');
  prevBtn.id = 'search-prev';
  prevBtn.className = 'search-btn';
  prevBtn.textContent = '▲';
  prevBtn.title = 'Previous match (Shift+Enter)';
  prevBtn.addEventListener('click', () => opts?.onFindPrevious());
  bar.appendChild(prevBtn);

  nextBtn = document.createElement('button');
  nextBtn.id = 'search-next';
  nextBtn.className = 'search-btn';
  nextBtn.textContent = '▼';
  nextBtn.title = 'Next match (Enter)';
  nextBtn.addEventListener('click', () => opts?.onFindNext());
  bar.appendChild(nextBtn);

  app.appendChild(bar);

  // ----- TOC side panel -----
  tocPanel = document.createElement('div');
  tocPanel.id = 'toc-panel';
  tocPanel.className = 'toc-panel';
  tocPanel.hidden = true;

  const tocHeader = document.createElement('div');
  tocHeader.className = 'toc-header';
  const tocTitle = document.createElement('span');
  tocTitle.textContent = 'Table of Contents';
  tocHeader.appendChild(tocTitle);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-btn toc-close-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', () => toggleToc(false));
  tocHeader.appendChild(closeBtn);
  tocPanel.appendChild(tocHeader);

  const tocBody = document.createElement('div');
  tocBody.className = 'toc-body';
  tocBody.id = 'toc-body';
  tocPanel.appendChild(tocBody);

  app.appendChild(tocPanel);

  // Global keyboard: Ctrl+F / Cmd+F focuses this search bar instead of the
  // browser's native find dialog.
  installFindKeyHandler();

  updateSearchUi();
}

let findKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function installFindKeyHandler(): void {
  if (findKeyHandler) {
    window.removeEventListener('keydown', findKeyHandler, true);
  }
  findKeyHandler = (e: KeyboardEvent) => {
    const isFind =
      (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F');
    if (!isFind) return;
    e.preventDefault();
    e.stopPropagation();
    focusSearch();
  };
  // Capture phase so we intercept before the browser opens native find.
  window.addEventListener('keydown', findKeyHandler, true);
}

export function focusSearch(): void {
  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }
}

/** Reflect the current SearchController state onto the counter + buttons. */
export function updateSearchUi(): void {
  if (!opts || !counterEl || !prevBtn || !nextBtn) return;
  const state = opts.getSearchState();
  counterEl.textContent = `${state.current}/${state.total}`;
  counterEl.classList.toggle('not-found', state.status === 'not-found');
  const disabled = state.total === 0;
  prevBtn.disabled = disabled;
  nextBtn.disabled = disabled;
}

function toggleToc(force?: boolean): void {
  if (!tocPanel) return;
  const show = force ?? tocPanel.hidden;
  tocPanel.hidden = !show;
  tocToggleBtn?.classList.toggle('active', show);
  if (show) void renderToc();
}

async function renderToc(): Promise<void> {
  if (!opts) return;
  const body = document.getElementById('toc-body');
  if (!body) return;

  body.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'toc-empty';
  loading.textContent = 'Loading…';
  body.appendChild(loading);

  const items = await opts.loadOutline();

  body.innerHTML = '';
  if (!opts.hasOutline() || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.id = 'toc-empty';
    empty.textContent = 'No table of contents';
    body.appendChild(empty);
    return;
  }

  const tree = buildTree(items);
  body.appendChild(tree);
}

function buildTree(items: OutlineItem[]): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'toc-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'toc-item';

    const link = document.createElement('button');
    link.className = 'toc-link';
    link.textContent = item.title || '(untitled)';
    link.dataset.id = item._id;
    if (item.bold) link.style.fontWeight = 'bold';
    if (item.italic) link.style.fontStyle = 'italic';
    if (item.color) {
      link.style.color = `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`;
    }
    link.addEventListener('click', () => opts?.onOutlineItemClick(item));
    li.appendChild(link);

    if (item.hasChildren && item.items.length > 0) {
      li.appendChild(buildTree(item.items));
    }

    ul.appendChild(li);
  }
  return ul;
}
