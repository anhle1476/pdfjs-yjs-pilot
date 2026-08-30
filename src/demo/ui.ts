// Demo sidebar/toolbar UI. Copied from the previous src/ui.ts almost verbatim;
// it is pure DOM and only invokes the callbacks supplied by main.ts (which now
// drive DemoApp instead of the old PdfPilot).

export interface SidebarOptions {
  onDraw: () => void;
  onText: () => void;
  onHighlight: () => void;
  onClear: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitPage: () => void;
  onRotateCW: () => void;
  onViewModeChange: (mode: 'scroll' | 'single') => void;
  getPageInfo: () => { current: number; total: number };
  getZoomPercent: () => number;
  getViewMode: () => 'scroll' | 'single';
}

let currentOptions: SidebarOptions | null = null;
let pageInfoEl: HTMLElement | null = null;
let zoomInfoEl: HTMLElement | null = null;
let viewModeInfoEl: HTMLElement | null = null;

export function createSidebar(options: SidebarOptions): void {
  currentOptions = options;

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = 'PDF Pilot';
  sidebar.appendChild(title);

  pageInfoEl = document.createElement('div');
  pageInfoEl.className = 'page-info';
  pageInfoEl.textContent = `Page ${options.getPageInfo().current} of ${options.getPageInfo().total}`;
  sidebar.appendChild(pageInfoEl);

  const navSection = document.createElement('div');
  navSection.className = 'sidebar-section';

  const navTitle = document.createElement('h3');
  navTitle.textContent = 'Navigation';
  navSection.appendChild(navTitle);

  const navButtons = [
    { id: 'prev-page', label: '◀ Prev', handler: options.onPrevPage },
    { id: 'next-page', label: 'Next ▶', handler: options.onNextPage },
  ];

  const navBtnGroup = document.createElement('div');
  navBtnGroup.className = 'btn-group';

  navButtons.forEach((btn) => {
    const button = document.createElement('button');
    button.id = btn.id;
    button.textContent = btn.label;
    button.className = 'nav-btn';
    button.addEventListener('click', () => {
      btn.handler();
      updatePageInfo();
    });
    navBtnGroup.appendChild(button);
  });

  navSection.appendChild(navBtnGroup);
  sidebar.appendChild(navSection);

  const viewModeSection = document.createElement('div');
  viewModeSection.className = 'sidebar-section';

  const viewModeTitle = document.createElement('h3');
  viewModeTitle.textContent = 'View Mode';
  viewModeSection.appendChild(viewModeTitle);

  viewModeInfoEl = document.createElement('div');
  viewModeInfoEl.className = 'view-mode-info';
  viewModeInfoEl.textContent = options.getViewMode().toUpperCase();
  viewModeSection.appendChild(viewModeInfoEl);

  const viewModeButtons = [
    { id: 'view-scroll', label: 'Scroll', mode: 'scroll' as const },
    { id: 'view-single', label: 'Single', mode: 'single' as const },
  ];

  const viewModeBtnGroup = document.createElement('div');
  viewModeBtnGroup.className = 'btn-group';

  viewModeButtons.forEach((btn) => {
    const button = document.createElement('button');
    button.id = btn.id;
    button.textContent = btn.label;
    button.className = 'view-mode-btn';
    button.dataset.mode = btn.mode;
    if (options.getViewMode() === btn.mode) {
      button.classList.add('active');
    }
    button.addEventListener('click', () => {
      options.onViewModeChange(btn.mode);
      updateViewModeInfo();
    });
    viewModeBtnGroup.appendChild(button);
  });

  viewModeSection.appendChild(viewModeBtnGroup);
  sidebar.appendChild(viewModeSection);

  const zoomSection = document.createElement('div');
  zoomSection.className = 'sidebar-section';

  const zoomTitle = document.createElement('h3');
  zoomTitle.textContent = 'Zoom';
  zoomSection.appendChild(zoomTitle);

  zoomInfoEl = document.createElement('div');
  zoomInfoEl.className = 'zoom-info';
  zoomInfoEl.textContent = `${options.getZoomPercent()}%`;
  zoomSection.appendChild(zoomInfoEl);

  const zoomButtons = [
    { id: 'zoom-out', label: '−', handler: options.onZoomOut },
    { id: 'zoom-in', label: '+', handler: options.onZoomIn },
    { id: 'fit-page', label: 'Fit Page', handler: options.onFitPage },
  ];

  const zoomBtnGroup = document.createElement('div');
  zoomBtnGroup.className = 'btn-group';

  zoomButtons.forEach((btn) => {
    const button = document.createElement('button');
    button.id = btn.id;
    button.textContent = btn.label;
    button.className = 'zoom-btn';
    button.addEventListener('click', () => {
      btn.handler();
      updateZoomInfo();
    });
    zoomBtnGroup.appendChild(button);
  });

  zoomSection.appendChild(zoomBtnGroup);
  sidebar.appendChild(zoomSection);

  const rotateSection = document.createElement('div');
  rotateSection.className = 'sidebar-section';

  const rotateTitle = document.createElement('h3');
  rotateTitle.textContent = 'Rotate';
  rotateSection.appendChild(rotateTitle);

  const rotateBtn = document.createElement('button');
  rotateBtn.id = 'rotate-cw';
  rotateBtn.textContent = '↻ Rotate';
  rotateBtn.className = 'rotate-btn';
  rotateBtn.addEventListener('click', () => {
    options.onRotateCW();
  });
  rotateSection.appendChild(rotateBtn);
  sidebar.appendChild(rotateSection);

  const divider = document.createElement('hr');
  sidebar.appendChild(divider);

  const toolsSection = document.createElement('div');
  toolsSection.className = 'sidebar-section';

  const toolsTitle = document.createElement('h3');
  toolsTitle.textContent = 'Annotation Tools';
  toolsSection.appendChild(toolsTitle);

  const tools = [
    { id: 'draw', label: '✏️ Draw', handler: options.onDraw },
    { id: 'freetext', label: '📝 Text', handler: options.onText },
    { id: 'highlight', label: '🖍️ Highlight', handler: options.onHighlight },
  ];

  tools.forEach((tool) => {
    const button = document.createElement('button');
    button.textContent = tool.label;
    button.className = 'tool-btn';
    button.dataset.tool = tool.id;
    button.addEventListener('click', () => {
      tool.handler();
    });
    toolsSection.appendChild(button);
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = '🗑️ Clear All';
  clearBtn.className = 'tool-btn clear-btn';
  clearBtn.addEventListener('click', () => {
    options.onClear();
  });
  toolsSection.appendChild(clearBtn);

  sidebar.appendChild(toolsSection);
}

export function setActiveTool(tool: string | null): void {
  const buttons = document.querySelectorAll('.tool-btn');
  buttons.forEach((btn) => {
    const button = btn as HTMLButtonElement;
    if (button.dataset.tool === tool) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
}

export function updatePageInfo(): void {
  if (pageInfoEl && currentOptions) {
    const info = currentOptions.getPageInfo();
    pageInfoEl.textContent = `Page ${info.current} of ${info.total}`;
  }
}

export function updateZoomInfo(): void {
  if (zoomInfoEl && currentOptions) {
    zoomInfoEl.textContent = `${currentOptions.getZoomPercent()}%`;
  }
}

export function updateViewModeInfo(): void {
  if (viewModeInfoEl && currentOptions) {
    const mode = currentOptions.getViewMode();
    viewModeInfoEl.textContent = mode.toUpperCase();

    const buttons = document.querySelectorAll('.view-mode-btn');
    buttons.forEach((btn) => {
      const button = btn as HTMLButtonElement;
      if (button.dataset.mode === mode) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }
}
