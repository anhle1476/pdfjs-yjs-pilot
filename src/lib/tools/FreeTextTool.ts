import { AnnotationStore } from '../AnnotationStore';
import { FreeTextObject } from '../models/FreeTextObject';

export interface FreeTextToolOptions {
  defaultFontSize?: number;
  defaultColor?: string;
}

export interface FreeTextToolState {
  activeEditorId: string | null;
  defaultFontSize: number;
  defaultColor: string;
}

/**
 * FreeTextTool — the one tool permitted to own its own DOM input UI.
 *
 * It renders/manages contentEditable editor DOM (editorDiv/contentDiv/
 * overlayDiv + delete button) and the editors bind their OWN blur/keydown/
 * paste/delete listeners to their OWN DOM elements. This is the intentional,
 * documented exception to the "no listeners" rule for the lib.
 *
 * The single behavioural change versus the previous FreeTextPlugin is that
 * the tool does NOT install a pointerdown listener on the PDF canvas to decide
 * when to spawn a new editor. Instead the host app calls `createAt(x, y)`
 * (normalized 0-1 coordinates) when it detects a pointerdown while the
 * 'freetext' tool is active and no existing editor was hit.
 *
 * Persistence goes through the injected AnnotationStore (add/update/remove).
 */
export class FreeTextTool {
  private store: AnnotationStore;
  private currentPageNumber: number = 1;
  private editorContainer: HTMLElement | null = null;
  private activeEditorId: string | null = null;
  private editModeAC: AbortController | null = null;
  private isCommitting: boolean = false;

  public defaultFontSize: number = 10;
  public defaultColor: string = '#000000';

  private internalPadding: number = 2;

  private stateChangeCallbacks: Set<(state: FreeTextToolState) => void> = new Set();

  constructor(store: AnnotationStore, options: FreeTextToolOptions = {}) {
    this.store = store;
    if (options.defaultFontSize) this.defaultFontSize = options.defaultFontSize;
    if (options.defaultColor) this.defaultColor = options.defaultColor;
  }

  /**
   * Activate the tool by attaching an editor container to the supplied page
   * container element (the host passes the page's container; the lib no longer
   * discovers it via canvas.parentElement). Rebuilds editors for the page.
   */
  public activate(pageContainerElement: HTMLElement, pageNumber: number): void {
    this.currentPageNumber = pageNumber;
    this.ensureEditorContainer(pageContainerElement);
    this.rebuildEditorsForCurrentPage();
    this.notify();
  }

  public deactivate(): void {
    this.commitActiveEditor();
    this.removeAllEditors();
    if (this.editorContainer) {
      this.editorContainer.remove();
      this.editorContainer = null;
    }
    this.activeEditorId = null;
    this.editModeAC?.abort();
    this.editModeAC = null;
    this.notify();
  }

  public setPageNumber(pageNumber: number): void {
    if (this.currentPageNumber !== pageNumber) {
      this.commitActiveEditor();
      this.currentPageNumber = pageNumber;
      this.activeEditorId = null;
    }
    this.rebuildEditorsForCurrentPage();
    this.notify();
  }

  public getPageNumber(): number {
    return this.currentPageNumber;
  }

  private ensureEditorContainer(pageContainerElement: HTMLElement): void {
    if (this.editorContainer && this.editorContainer.parentElement === pageContainerElement) {
      return;
    }

    // Re-parent existing container if we're switching page containers.
    if (this.editorContainer) {
      this.editorContainer.remove();
      this.editorContainer = null;
    }

    const existing = pageContainerElement.querySelector('.freetext-editor-container');
    if (existing) existing.remove();

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'freetext-editor-container';
    this.editorContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
    `;
    pageContainerElement.appendChild(this.editorContainer);
  }

  /**
   * Create a new editor at the given normalized (0-1) coordinate. Returns the
   * new editor id.
   */
  public createAt(x: number, y: number): string {
    return this.createEditor(x, y);
  }

  private handleKeyDown(e: KeyboardEvent, editorId: string): void {
    const key = this.getKeyString(e);

    if (key === 'Escape') {
      e.preventDefault();
      this.commitEditor(editorId);
      return;
    }

    if (key === 'ctrl+Enter' || key === 'mac+Enter') {
      e.preventDefault();
      this.commitEditor(editorId);
      return;
    }

    if (key === 'ctrl+s' || key === 'mac+Meta+s') {
      e.preventDefault();
      this.commitEditor(editorId);
      return;
    }
  }

  private getKeyString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('mac');
    parts.push(e.key);
    return parts.join('+');
  }

  private handlePaste(e: ClipboardEvent, contentDiv: HTMLDivElement): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;

    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      contentDiv.textContent = (contentDiv.textContent || '') + text;
      return;
    }

    selection.deleteFromDocument();
    const textNode = document.createTextNode(text);
    selection.getRangeAt(0).insertNode(textNode);
    selection.collapseToEnd();
  }

  private createEditor(x: number, y: number): string {
    if (!this.editorContainer) return '';

    const id = `freetext_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const editorDiv = document.createElement('div');
    editorDiv.className = 'freetext-editor';
    editorDiv.setAttribute('data-editor-id', id);
    editorDiv.style.cssText = `
      position: absolute;
      left: ${x * 100}%;
      top: ${y * 100}%;
    `;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'editor-content';
    contentDiv.contentEditable = 'true';
    contentDiv.setAttribute('role', 'textbox');
    contentDiv.setAttribute('aria-multiline', 'true');
    contentDiv.setAttribute('data-l10n-id', 'pdfjs-free-text2');
    contentDiv.setAttribute('data-placeholder', 'Type something...');
    contentDiv.style.cssText = `
      font-size: ${this.defaultFontSize}px;
      color: ${this.defaultColor};
      padding: ${this.internalPadding}px;
    `;

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'overlay';

    editorDiv.appendChild(contentDiv);
    editorDiv.appendChild(overlayDiv);

    // Delete button — binds its OWN pointerdown to its OWN element.
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.deleteEditor(id);
    });
    editorDiv.appendChild(deleteBtn);

    this.editorContainer.appendChild(editorDiv);

    this.activeEditorId = id;

    const freeTextObj = new FreeTextObject(id, '', this.defaultFontSize, this.defaultColor, {
      x,
      y,
      width: 0.2,
      height: 0.05,
    });
    freeTextObj.pageNumber = this.currentPageNumber;
    this.store.add(freeTextObj);

    // Immediately enable edit mode for the new editor.
    this.enableEditMode(id);
    this.notify();

    return id;
  }

  private enableEditMode(editorId: string): void {
    if (!this.editorContainer) return;

    const editorEl = this.editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
    if (!editorEl) return;

    const contentDiv = editorEl.querySelector('.editor-content') as HTMLDivElement;
    const overlayDiv = editorEl.querySelector('.overlay') as HTMLDivElement;

    if (!contentDiv || !overlayDiv) return;

    this.activeEditorId = editorId;
    this.editModeAC?.abort();
    this.editModeAC = new AbortController();
    const signal = this.editModeAC.signal;

    contentDiv.contentEditable = 'true';
    editorEl.classList.add('editing');
    overlayDiv.classList.remove('enabled');

    setTimeout(() => {
      contentDiv.focus();
    }, 0);

    contentDiv.addEventListener(
      'blur',
      () => {
        if (!this.isCommitting) {
          this.commitEditor(editorId);
        }
      },
      { signal }
    );

    contentDiv.addEventListener(
      'input',
      () => {
        this.onEditorInput(editorId);
      },
      { signal }
    );

    contentDiv.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        this.handleKeyDown(e, editorId);
      },
      { signal }
    );

    contentDiv.addEventListener(
      'paste',
      (e: ClipboardEvent) => {
        this.handlePaste(e, contentDiv);
      },
      { signal }
    );

    this.notify();
  }

  private onEditorInput(editorId: string): void {
    if (!this.editorContainer) return;

    const editorEl = this.editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
    const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement;

    if (!contentDiv) return;

    const obj = this.findObjectById(editorId);
    if (obj) {
      obj.setContent(contentDiv.textContent || '');
      this.store.update(obj.id, obj);
    }

    this.updateEditorDimensions(editorId);
  }

  private updateEditorDimensions(editorId: string): void {
    if (!this.editorContainer) return;

    const editorEl = this.editorContainer.querySelector(`[data-editor-id="${editorId}"]`) as HTMLDivElement | null;
    const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement | null;

    if (!editorEl || !contentDiv) return;

    const obj = this.findObjectById(editorId);
    if (!obj) return;

    editorEl.style.left = `${obj.bounds.x * 100}%`;
    editorEl.style.top = `${obj.bounds.y * 100}%`;
  }

  private deleteEditor(editorId: string): void {
    const obj = this.findObjectById(editorId);
    if (obj) {
      this.removeEditor(editorId);
      this.store.remove(editorId);
      this.notify();
    }
  }

  private commitActiveEditor(): void {
    if (this.activeEditorId && !this.isCommitting) {
      this.commitEditor(this.activeEditorId);
    }
  }

  private commitEditor(editorId: string): void {
    if (!this.editorContainer || this.isCommitting) return;
    this.isCommitting = true;

    try {
      const editorEl = this.editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
      const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement | null;
      const overlayDiv = editorEl?.querySelector('.overlay') as HTMLDivElement | null;

      if (!contentDiv) {
        this.isCommitting = false;
        return;
      }

      const obj = this.findObjectById(editorId);
      if (!obj) {
        this.isCommitting = false;
        return;
      }

      const content = contentDiv.textContent?.trim() || '';

      if (!content) {
        this.removeEditor(editorId);
        this.store.remove(editorId);
        this.isCommitting = false;
        return;
      }

      obj.setContent(content);

      if (contentDiv.contentEditable === 'true') {
        contentDiv.contentEditable = 'false';
      }
      editorEl?.classList.remove('editing');
      overlayDiv?.classList.add('enabled');

      this.store.update(obj.id, obj);
    } finally {
      this.isCommitting = false;
    }
  }

  private removeEditor(editorId: string): void {
    const editorEl = this.editorContainer?.querySelector(`[data-editor-id="${editorId}"]`);
    if (editorEl && editorEl.parentNode) {
      editorEl.remove();
    }

    if (this.activeEditorId === editorId) {
      this.activeEditorId = null;
      this.editModeAC?.abort();
      this.editModeAC = null;
    }
  }

  private removeAllEditors(): void {
    if (!this.editorContainer) return;
    const editors = this.editorContainer.querySelectorAll('.freetext-editor');
    editors.forEach((el) => {
      if (el.parentNode) el.remove();
    });
    this.activeEditorId = null;
    this.editModeAC?.abort();
    this.editModeAC = null;
  }

  private findObjectById(id: string): FreeTextObject | undefined {
    const obj = this.store.getAll().find((o) => o.id === id);
    return obj instanceof FreeTextObject ? obj : undefined;
  }

  private getObjectsForCurrentPage(): FreeTextObject[] {
    return this.store
      .getForPage(this.currentPageNumber)
      .filter((o): o is FreeTextObject => o instanceof FreeTextObject);
  }

  private rebuildEditorsForCurrentPage(): void {
    if (!this.editorContainer) return;

    // Remove ALL editors to ensure clean state for the current page.
    const editors = this.editorContainer.querySelectorAll('.freetext-editor');
    editors.forEach((el) => {
      if (el.parentNode) {
        el.remove();
      }
    });

    const pageObjects = this.getObjectsForCurrentPage();
    for (const obj of pageObjects) {
      this.rebuildEditor(obj);
    }
  }

  private rebuildEditor(obj: FreeTextObject): void {
    if (!this.editorContainer) return;

    const editorDiv = document.createElement('div');
    editorDiv.className = 'freetext-editor';
    editorDiv.setAttribute('data-editor-id', obj.id);
    editorDiv.style.cssText = `
      position: absolute;
      left: ${obj.bounds.x * 100}%;
      top: ${obj.bounds.y * 100}%;
    `;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'editor-content';
    contentDiv.contentEditable = 'false';
    contentDiv.setAttribute('role', 'comment');
    contentDiv.textContent = obj.getContent();
    contentDiv.style.cssText = `
      font-size: ${obj.fontSize}px;
      color: ${obj.color};
      padding: ${this.internalPadding}px;
    `;

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'overlay enabled';

    editorDiv.appendChild(contentDiv);
    editorDiv.appendChild(overlayDiv);

    // Delete button — binds its OWN pointerdown to its OWN element.
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.deleteEditor(obj.id);
    });
    editorDiv.appendChild(deleteBtn);

    this.editorContainer.appendChild(editorDiv);
  }

  public getState(): FreeTextToolState {
    return {
      activeEditorId: this.activeEditorId,
      defaultFontSize: this.defaultFontSize,
      defaultColor: this.defaultColor,
    };
  }

  public onStateChange(cb: (state: FreeTextToolState) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(state);
      } catch (e) {
        console.error('Error in FreeTextTool state change callback:', e);
      }
    }
  }

  public getActiveEditorId(): string | null {
    return this.activeEditorId;
  }
}
