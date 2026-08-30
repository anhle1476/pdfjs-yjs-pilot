export class ZoomController {
  private currentScale: number = 1;
  private minScale: number = 0.1;
  private maxScale: number = 10;
  private scaleStep: number = 0.25;

  constructor(options?: {
    minScale?: number;
    maxScale?: number;
    defaultScale?: number;
    scaleStep?: number;
  }) {
    if (options?.minScale !== undefined) this.minScale = options.minScale;
    if (options?.maxScale !== undefined) this.maxScale = options.maxScale;
    if (options?.defaultScale !== undefined) this.currentScale = options.defaultScale;
    if (options?.scaleStep !== undefined) this.scaleStep = options.scaleStep;
  }

  public zoomIn(): number {
    return this.setScale(this.currentScale + this.scaleStep);
  }

  public zoomOut(): number {
    return this.setScale(this.currentScale - this.scaleStep);
  }

  public setScale(scale: number): number {
    this.currentScale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    return this.currentScale;
  }

  public fitToWidth(containerWidth: number, pageWidth: number): number {
    if (pageWidth <= 0) return this.currentScale;
    return this.setScale(containerWidth / pageWidth);
  }

  public fitToHeight(containerHeight: number, pageHeight: number): number {
    if (pageHeight <= 0) return this.currentScale;
    return this.setScale(containerHeight / pageHeight);
  }

  public fitToPage(
    containerWidth: number,
    containerHeight: number,
    pageWidth: number,
    pageHeight: number
  ): number {
    if (pageWidth <= 0 || pageHeight <= 0) return this.currentScale;
    const scaleW = containerWidth / pageWidth;
    const scaleH = containerHeight / pageHeight;
    return this.setScale(Math.min(scaleW, scaleH));
  }

  public getScale(): number {
    return this.currentScale;
  }

  public getZoomPercent(): number {
    return Math.round(this.currentScale * 100);
  }

  public getMinScale(): number {
    return this.minScale;
  }

  public getMaxScale(): number {
    return this.maxScale;
  }

  public getScaleStep(): number {
    return this.scaleStep;
  }

  public canZoomIn(): boolean {
    return this.currentScale < this.maxScale;
  }

  public canZoomOut(): boolean {
    return this.currentScale > this.minScale;
  }
}
