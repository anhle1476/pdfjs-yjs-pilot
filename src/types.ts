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

export type AnnotationType = 'ink' | 'text' | 'highlight';

export interface Annotation {
  id: string;
  type: AnnotationType;
  page: number;
  position: Point;
  data: InkData | TextData | HighlightData;
  color: string;
  createdAt: number;
}

export type ToolType = 'ink' | 'text' | 'highlight' | null;

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
