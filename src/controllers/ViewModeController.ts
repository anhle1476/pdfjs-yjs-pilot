export type ViewMode = 'scroll' | 'single';

export class ViewModeController {
  private currentMode: ViewMode = 'scroll';

  public getMode(): ViewMode {
    return this.currentMode;
  }

  public setMode(mode: ViewMode): ViewMode {
    this.currentMode = mode;
    return this.currentMode;
  }

  public isScrollMode(): boolean {
    return this.currentMode === 'scroll';
  }

  public isSingleMode(): boolean {
    return this.currentMode === 'single';
  }

  public toggleScrollMode(): boolean {
    this.currentMode = 'scroll';
    return true;
  }

  public toggleSingleMode(): boolean {
    this.currentMode = 'single';
    return true;
  }

  public getVisiblePageCount(): number {
    switch (this.currentMode) {
      case 'single':
        return 1;
      case 'scroll':
      default:
        return -1;
    }
  }

  public getPagesToRender(currentPage: number, totalPages: number): number[] {
    switch (this.currentMode) {
      case 'single':
        return [currentPage];

      case 'scroll':
      default:
        const pages: number[] = [];
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
        return pages;
    }
  }
}