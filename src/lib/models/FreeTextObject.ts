import { AnnotationObject, Rect } from './AnnotationObject';

export interface FreeTextObjectData {
  type: 'freetext';
  id: string;
  content: string;
  fontSize: number;
  color: string;
  bounds: Rect;
  page: number;
}

export class FreeTextObject extends AnnotationObject {
  public id: string;
  public content: string;
  public fontSize: number;
  public color: string;
  public bounds: Rect;
  public pageNumber: number = 1;

  constructor(
    id: string = '',
    content: string = '',
    fontSize: number = 10,
    color: string = '#000000',
    bounds?: Rect
  ) {
    super();
    this.id = id;
    this.content = content;
    this.fontSize = fontSize;
    this.color = color;
    this.bounds = bounds || { x: 0, y: 0, width: 0, height: 0 };
  }

  hitTest(x: number, y: number): boolean {
    const margin = 0.005;
    const bounds = this.bounds;
    return !(
      x < bounds.x - margin ||
      x > bounds.x + bounds.width + margin ||
      y < bounds.y - margin ||
      y > bounds.y + bounds.height + margin
    );
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  move(dx: number, dy: number): void {
    this.bounds.x += dx;
    this.bounds.y += dy;
  }

  resize(anchor: string, dx: number, dy: number): void {
    if (anchor.includes('e')) this.bounds.width += dx;
    if (anchor.includes('s')) this.bounds.height += dy;
    if (anchor.includes('w')) {
      this.bounds.x += dx;
      this.bounds.width -= dx;
    }
    if (anchor.includes('n')) {
      this.bounds.y += dy;
      this.bounds.height -= dy;
    }
  }

  serialize(): any {
    return {
      type: 'freetext',
      id: this.id,
      content: this.content,
      fontSize: this.fontSize,
      color: this.color,
      bounds: { ...this.bounds },
      page: this.pageNumber,
    };
  }

  deserialize(data: any): void {
    this.id = data.id;
    this.content = data.content;
    this.fontSize = data.fontSize;
    this.color = data.color;
    this.bounds = { ...data.bounds };
    this.pageNumber = data.page ?? 1;
  }

  render(_ctx: CanvasRenderingContext2D, _canvasWidth: number, _canvasHeight: number): void {
  }

  setContent(content: string): void {
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }

  isEmpty(): boolean {
    return !this.content || this.content.trim() === '';
  }
}
