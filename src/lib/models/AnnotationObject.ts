export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export abstract class AnnotationObject {
  public id: string = '';
  public pageNumber: number = 1;

  abstract hitTest(x: number, y: number): boolean;
  abstract getBounds(): Rect;
  abstract move(dx: number, dy: number): void;
  abstract resize(anchor: string, dx: number, dy: number): void;
  abstract serialize(): any;
  abstract deserialize(data: any): void;
  abstract render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void;
}
