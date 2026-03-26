import { IToolPlugin, AnnotationObject } from './IToolPlugin';
import { FreeTextObject, FreeTextObjectData } from '../models/FreeTextObject';

export interface FreeTextEditorElement {
  id: string;
  div: HTMLDivElement;
  editorDiv: HTMLDivElement;
  overlayDiv: HTMLDivElement;
  content: string;
  fontSize: number;
  color: string;
  bounds: { x: number; y: number; width: number; height: number };
  isEditing: boolean;
  isDraggable: boolean;
}

export interface FreeTextPluginOptions {
  defaultFontSize?: number;
  defaultColor?: string;
  container?: HTMLElement;
}

export class FreeTextPlugin implements IToolPlugin {
  private _canvas: HTMLCanvasElement | null = null;
  private _store: AnnotationObject[];
  private _currentPageNumber: number = 1;
  private _editorContainer: HTMLElement | null = null;
  private _activeEditorId: string | null = null;
  private _editModeAC: AbortController | null = null;
  private _isCommitting: boolean = false;

  public defaultFontSize: number = 10;
  public defaultColor: string = '#000000';
  public onRenderNeeded?: () => void;
  public onObjectCreated?: (obj: FreeTextObject) => void;
  public onObjectUpdated?: (obj: FreeTextObject) => void;
  public onObjectDeleted?: (obj: FreeTextObject) => void;

  private _internalPadding: number = 2;
  private _isCreating: boolean = false;
  private _creationStart: { x: number; y: number } | null = null;

  private _keyboardShortcuts: Map<string, (id: string) => void> = new Map();

  constructor(sharedStore: AnnotationObject[], options: FreeTextPluginOptions = {}) {
    this._store = sharedStore;
    if (options.defaultFontSize) this.defaultFontSize = options.defaultFontSize;
    if (options.defaultColor) this.defaultColor = options.defaultColor;
  }

  activate(canvas: HTMLCanvasElement, _context: CanvasRenderingContext2D): void {
    this._canvas = canvas;
    this._ensureEditorContainer();
    this._setupKeyboardShortcuts();
    this._rebuildEditorsForCurrentPage();
  }

  deactivate(): void {
    this._commitActiveEditor();
    this._removeAllEditors();
    if (this._editorContainer) {
      this._editorContainer.remove();
      this._editorContainer = null;
    }
    this._canvas = null;
    this._activeEditorId = null;
    this._editModeAC?.abort();
    this._editModeAC = null;
  }

  setPageNumber(page: number): void {
    if (this._currentPageNumber !== page) {
      this._commitActiveEditor();
      this._currentPageNumber = page;
      this._activeEditorId = null; // Clear active editor on page change
    }
    // Rebuild anyway to reflect sync changes on the same page
    this._rebuildEditorsForCurrentPage();
  }

  getPageNumber(): number {
    return this._currentPageNumber;
  }

  private _ensureEditorContainer(): void {
    if (this._editorContainer) {
      // If we already have a container but the canvas changed (e.g. view mode switch),
      // we need to re-attach it to the new canvas's parent
      if (this._canvas && this._editorContainer.parentElement !== this._canvas.parentElement) {
        const parent = this._canvas.parentElement;
        if (parent) {
          const existing = parent.querySelector('.freetext-editor-container');
          if (existing && existing !== this._editorContainer) existing.remove();
          parent.appendChild(this._editorContainer);
        }
      }
      return;
    }

    if (!this._canvas) return;

    this._editorContainer = document.createElement('div');
    this._editorContainer.className = 'freetext-editor-container';
    this._editorContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
    `;

    const parent = this._canvas.parentElement;
    if (parent) {
      const existing = parent.querySelector('.freetext-editor-container');
      if (existing) existing.remove();
      parent.appendChild(this._editorContainer);
      this._editorContainer.style.pointerEvents = 'none';
    }
  }

  private _setupKeyboardShortcuts(): void {
    this._keyboardShortcuts.set('Escape', () => this._commitActiveEditor());
    this._keyboardShortcuts.set('ctrl+Enter', () => this._commitActiveEditor());
    this._keyboardShortcuts.set('mac+Enter', () => this._commitActiveEditor());
  }

  private _getCanvasPoint(e: PointerEvent): { x: number; y: number } {
    if (!this._canvas) return { x: 0, y: 0 };
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private _getNormalizedPoint(e: PointerEvent): { x: number; y: number } {
    if (!this._canvas) return { x: 0, y: 0 };
    const point = this._getCanvasPoint(e);
    return {
      x: point.x / this._canvas.width,
      y: point.y / this._canvas.height,
    };
  }

  onPointerDown(evt: PointerEvent): void {
    if (!this._canvas || !this._editorContainer) return;

    const target = evt.target as HTMLElement | null;
    
    // Check if clicked on delete button
    if (target && target.classList.contains('delete-btn')) {
      // Prevent other handlers from firing
      evt.preventDefault();
      evt.stopPropagation();
      
      const editorEl = target.closest('.freetext-editor');
      if (editorEl) {
        const editorId = editorEl.getAttribute('data-editor-id');
        if (editorId) {
          this._deleteEditor(editorId);
        }
      }
      return;
    }
    
    if (!target) {
      this._commitActiveEditor();
      const point = this._getNormalizedPoint(evt);
      this._createEditor(point.x, point.y);
      return;
    }

    const existingEditor = target.closest('.freetext-editor');

    if (existingEditor) {
      const editorId = existingEditor.getAttribute('data-editor-id');
      if (editorId && editorId !== this._activeEditorId) {
        this._commitActiveEditor();
        this._enableEditMode(editorId);
      }
      return;
    }

    // Only create a new editor if we clicked on the canvas itself or the editor container
    // This prevents creating new editors when clicking on UI elements outside
    if (target === this._canvas || target === this._editorContainer) {
      this._commitActiveEditor();
      const point = this._getNormalizedPoint(evt);
      this._createEditor(point.x, point.y);
    }
  }

  onPointerMove(evt: PointerEvent): void {
    // Freetext doesn't need drag-to-create anymore
  }

  onPointerUp(evt: PointerEvent): void {
    // Freetext doesn't need drag-to-create anymore
  }

  private _calculateBounds(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): { x: number; y: number; width: number; height: number } {
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return { x: minX, y: minY, width: Math.max(width, 0.05), height: Math.max(height, 0.02) };
  }

  private _createEditor(x: number, y: number): string {
    if (!this._editorContainer) return '';

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
      padding: ${this._internalPadding}px;
    `;

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'overlay';

    editorDiv.appendChild(contentDiv);
    editorDiv.appendChild(overlayDiv);
    
    // Add delete button
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    // Use pointerdown to ensure it fires before other blur events
    deleteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._deleteEditor(id);
    });
    editorDiv.appendChild(deleteBtn);
    
    this._editorContainer.appendChild(editorDiv);

    this._activeEditorId = id;

    const freeTextObj = new FreeTextObject(id, '', this.defaultFontSize, this.defaultColor, {
      x,
      y,
      width: 0.2, // Default width
      height: 0.05, // Default height
    });
    freeTextObj.pageNumber = this._currentPageNumber;
    this._store.push(freeTextObj);

    if (this.onObjectCreated) {
      this.onObjectCreated(freeTextObj);
    }

    // Immediately enable edit mode for the new editor
    this._enableEditMode(id);

    return id;
  }

  private _enableEditMode(editorId: string): void {
    if (!this._editorContainer) return;

    const editorEl = this._editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
    if (!editorEl) return;

    const contentDiv = editorEl.querySelector('.editor-content') as HTMLDivElement;
    const overlayDiv = editorEl.querySelector('.overlay') as HTMLDivElement;

    if (!contentDiv || !overlayDiv) return;

    this._activeEditorId = editorId;
    this._editModeAC?.abort();
    this._editModeAC = new AbortController();
    const signal = this._editModeAC.signal;

    contentDiv.contentEditable = 'true';
    editorEl.classList.add('editing');
    overlayDiv.classList.remove('enabled');
    
    // Use setTimeout to ensure the element is focusable
    setTimeout(() => {
      contentDiv.focus();
    }, 0);

    contentDiv.addEventListener(
      'blur',
      () => {
        if (!this._isCommitting) {
          this._commitEditor(editorId);
        }
      },
      { signal }
    );

    contentDiv.addEventListener(
      'input',
      () => {
        this._onEditorInput(editorId);
      },
      { signal }
    );

    contentDiv.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        this._handleKeyDown(e, editorId);
      },
      { signal }
    );

    contentDiv.addEventListener(
      'paste',
      (e: ClipboardEvent) => {
        this._handlePaste(e, contentDiv);
      },
      { signal }
    );
  }

  private _handleKeyDown(e: KeyboardEvent, editorId: string): void {
    const key = this._getKeyString(e);

    if (key === 'Escape') {
      e.preventDefault();
      this._commitEditor(editorId);
      return;
    }

    if (key === 'ctrl+Enter' || key === 'mac+Enter') {
      e.preventDefault();
      this._commitEditor(editorId);
      return;
    }

    if (key === 'ctrl+s' || key === 'mac+Meta+s') {
      e.preventDefault();
      this._commitEditor(editorId);
      return;
    }
  }

  private _getKeyString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('mac');
    parts.push(e.key);
    return parts.join('+');
  }

  private _handlePaste(e: ClipboardEvent, contentDiv: HTMLDivElement): void {
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

  private _onEditorInput(editorId: string): void {
    if (!this._editorContainer) return;

    const editorEl = this._editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
    const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement;

    if (!contentDiv) return;

    const obj = this._findObjectById(editorId);
    if (obj && obj instanceof FreeTextObject) {
      obj.setContent(contentDiv.textContent || '');
      if (this.onObjectUpdated) {
        this.onObjectUpdated(obj);
      }
    }

    this._updateEditorDimensions(editorId);
  }

  private _updateEditorDimensions(editorId: string): void {
    if (!this._editorContainer || !this._canvas) return;

    const editorEl = this._editorContainer.querySelector(`[data-editor-id="${editorId}"]`) as HTMLDivElement | null;
    const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement | null;

    if (!editorEl || !contentDiv || !this._canvas) return;

    const obj = this._findObjectById(editorId);
    if (!obj) return;

    editorEl.style.left = `${obj.bounds.x * 100}%`;
    editorEl.style.top = `${obj.bounds.y * 100}%`;
  }

  private _deleteEditor(editorId: string): void {
    const obj = this._findObjectById(editorId);
    if (obj) {
      this._removeEditor(editorId);
      const idx = this._store.findIndex((o) => o.id === editorId);
      if (idx !== -1) {
        this._store.splice(idx, 1);
        if (this.onObjectDeleted) {
          this.onObjectDeleted(obj);
        }
      }
    }
  }

  private _commitActiveEditor(): void {
    if (this._activeEditorId && !this._isCommitting) {
      this._commitEditor(this._activeEditorId);
    }
  }

  private _commitEditor(editorId: string): void {
    if (!this._editorContainer || this._isCommitting) return;
    this._isCommitting = true;

    try {
      const editorEl = this._editorContainer.querySelector(`[data-editor-id="${editorId}"]`);
      const contentDiv = editorEl?.querySelector('.editor-content') as HTMLDivElement | null;
      const overlayDiv = editorEl?.querySelector('.overlay') as HTMLDivElement | null;

      if (!contentDiv) {
        this._isCommitting = false;
        return;
      }

      const obj = this._findObjectById(editorId);
      if (!obj || !(obj instanceof FreeTextObject)) {
        this._isCommitting = false;
        return;
      }

      const content = contentDiv.textContent?.trim() || '';

      if (!content) {
        this._removeEditor(editorId);
        const idx = this._store.findIndex((o) => o.id === editorId);
        if (idx !== -1) {
          this._store.splice(idx, 1);
          if (this.onObjectDeleted) this.onObjectDeleted(obj);
        }
        this._isCommitting = false;
        return;
      }

      obj.setContent(content);

      if (contentDiv.contentEditable === 'true') {
        contentDiv.contentEditable = 'false';
      }
      editorEl?.classList.remove('editing');
      overlayDiv?.classList.add('enabled');

      if (this.onObjectUpdated) {
        this.onObjectUpdated(obj);
      }
    } finally {
      this._isCommitting = false;
    }
  }

  private _removeEditor(editorId: string): void {
    const editorEl = this._editorContainer?.querySelector(`[data-editor-id="${editorId}"]`);
    if (editorEl && editorEl.parentNode) {
      editorEl.remove();
    }

    if (this._activeEditorId === editorId) {
      this._activeEditorId = null;
      this._editModeAC?.abort();
      this._editModeAC = null;
    }
  }

  private _removeAllEditors(): void {
    if (!this._editorContainer) return;
    const editors = this._editorContainer.querySelectorAll('.freetext-editor');
    editors.forEach((el) => {
      if (el.parentNode) el.remove();
    });
    this._activeEditorId = null;
    this._editModeAC?.abort();
    this._editModeAC = null;
  }

  private _updateEditorBounds(editorId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this._editorContainer) return;

    const editorEl = this._editorContainer.querySelector(`[data-editor-id="${editorId}"]`) as HTMLDivElement | null;
    if (!editorEl) return;

    const obj = this._findObjectById(editorId);
    if (obj) {
      obj.bounds = { ...bounds };
      if (this.onObjectUpdated) {
        this.onObjectUpdated(obj);
      }
    }

    editorEl.style.left = `${bounds.x * 100}%`;
    editorEl.style.top = `${bounds.y * 100}%`;

    if (this.onRenderNeeded) {
      this.onRenderNeeded();
    }
  }

  private _findObjectById(id: string): FreeTextObject | undefined {
    const obj = this._store.find((o) => o.id === id);
    return obj instanceof FreeTextObject ? obj : undefined;
  }

  private _rebuildEditorsForCurrentPage(): void {
    if (!this._editorContainer) return;

    // Remove ALL editors to ensure clean state for the current page
    const editors = this._editorContainer.querySelectorAll('.freetext-editor');
    editors.forEach((el) => {
      if (el.parentNode) {
        el.remove();
      }
    });

    const pageObjects = this.getObjects();
    for (const obj of pageObjects) {
      if (obj instanceof FreeTextObject) {
        this._rebuildEditor(obj);
      }
    }
  }

  private _rebuildEditor(obj: FreeTextObject): void {
    if (!this._editorContainer) return;

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
      padding: ${this._internalPadding}px;
    `;

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'overlay enabled';

    editorDiv.appendChild(contentDiv);
    editorDiv.appendChild(overlayDiv);
    
    // Add delete button
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    // Use pointerdown to ensure it fires before other blur events
    deleteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._deleteEditor(obj.id);
    });
    editorDiv.appendChild(deleteBtn);
    
    this._editorContainer.appendChild(editorDiv);
  }

  render(_ctx: CanvasRenderingContext2D): void {
  }

  getObjects(): AnnotationObject[] {
    return this._store.filter(
      (obj) => obj instanceof FreeTextObject && obj.pageNumber === this._currentPageNumber
    );
  }

  getAllObjects(): AnnotationObject[] {
    return this._store;
  }

  initialize(container: HTMLElement): void {
    this._editorContainer = container;
    this._setupKeyboardShortcuts();
  }

  destroy(): void {
    this.deactivate();
  }

  getData(): FreeTextObjectData[] {
    return this._store
      .filter((obj) => obj instanceof FreeTextObject)
      .map((obj) => (obj as FreeTextObject).serialize());
  }

  setData(data: FreeTextObjectData[]): void {
    for (const item of data) {
      const obj = new FreeTextObject();
      obj.deserialize(item);
      const existingIdx = this._store.findIndex((o) => o.id === item.id);
      if (existingIdx !== -1) {
        this._store[existingIdx] = obj;
      } else {
        this._store.push(obj);
      }
    }
    this._rebuildEditorsForCurrentPage();
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const textObjects = this._store.filter((obj) => obj instanceof FreeTextObject);

    for (const obj of textObjects) {
      const freeTextObj = obj as FreeTextObject;
      if (!freeTextObj.id) {
        errors.push('FreeTextObject missing id');
      }
      if (freeTextObj.fontSize <= 0) {
        errors.push(`FreeTextObject ${freeTextObj.id}: invalid fontSize`);
      }
      if (!freeTextObj.color) {
        errors.push(`FreeTextObject ${freeTextObj.id}: missing color`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getActiveEditorId(): string | null {
    return this._activeEditorId;
  }

  setActiveEditor(editorId: string | null): void {
    if (this._activeEditorId && this._activeEditorId !== editorId) {
      this._commitEditor(this._activeEditorId);
    }
    if (editorId) {
      this._enableEditMode(editorId);
    }
  }

  commitAll(): void {
    this._commitActiveEditor();
  }
}