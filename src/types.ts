export type Direction = '左侧' | '中间' | '右侧';
export interface Detection {
  name: string; label: string; confidence: number; color: string;
  box: [number, number, number, number]; direction: Direction;
}
export interface FrameResult {
  detections: Detection[]; width: number; height: number;
  masks: Uint8Array; elapsed: number; inference: number;
}
export interface TextLine {
  text: string; score: number; direction: Direction;
  box: [number, number, number, number];
}
export interface TextResult {
  lines: TextLine[]; width: number; height: number; elapsed: number;
}
