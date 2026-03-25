export class RotateController {
  private currentRotation: number = 0;

  constructor(initialRotation: number = 0) {
    this.currentRotation = this.normalizeRotation(initialRotation);
  }

  public rotateClockwise(): number {
    this.currentRotation = (this.currentRotation + 90) % 360;
    return this.currentRotation;
  }

  public rotateCounterClockwise(): number {
    this.currentRotation = (this.currentRotation - 90 + 360) % 360;
    return this.currentRotation;
  }

  public setRotation(degrees: number): number {
    this.currentRotation = this.normalizeRotation(degrees);
    return this.currentRotation;
  }

  public getRotation(): number {
    return this.currentRotation;
  }

  public normalizeRotation(degrees: number): number {
    degrees = degrees % 360;
    if (degrees < 0) degrees += 360;
    return degrees;
  }

  public isPortrait(): boolean {
    return this.currentRotation === 0 || this.currentRotation === 180;
  }

  public isLandscape(): boolean {
    return this.currentRotation === 90 || this.currentRotation === 270;
  }

  public getRotationLabel(): string {
    const labels: Record<number, string> = {
      0: '0°',
      90: '90°',
      180: '180°',
      270: '270°',
    };
    return labels[this.currentRotation] || `${this.currentRotation}°`;
  }
}
