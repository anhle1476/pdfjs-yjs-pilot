export interface Point {
  x: number;
  y: number;
}

export interface InkPath {
  line: number[];
  points: number[];
}

export interface InkData {
  paths: InkPath[];
  strokeWidth: number;
  rect?: [number, number, number, number];
}

export interface TextData {
  content: string;
  fontSize: number;
}

export interface HighlightData {
  width: number;
  height: number;
}

export interface FreeTextData {
  content: string;
  fontSize: number;
  color: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type AnnotationType = 'ink' | 'text' | 'highlight' | 'freetext';

export interface Annotation {
  id: string;
  type: AnnotationType;
  page: number;
  position: Point;
  data: InkData | TextData | HighlightData | FreeTextData;
  color: string;
  createdAt: number;
}

export type ToolType = 'ink' | 'text' | 'highlight' | 'freetext' | null;

export interface ToolState {
  activeTool: ToolType;
  color: string;
  strokeWidth: number;
  fontSize: number;
}

export interface AppState {
  annotations: Annotation[];
  toolState: ToolState;
}
