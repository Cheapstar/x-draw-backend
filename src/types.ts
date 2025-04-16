// Core position and selection types
export type Point = {
  x: number;
  y: number;
};

export type SelectedPosition =
  | "inside"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "start"
  | "end"
  | "middle"
  | "b"
  | "t"
  | "l"
  | "r"
  | null;

// Tool and action enums for better type safety
export type TOOL =
  | "rectangle"
  | "line"
  | "move"
  | "select"
  | "freehand"
  | "text"
  | "pan"
  | "eraser"
  | "laser"
  | "insert-image";

export type Action =
  | "drawing"
  | "selecting"
  | "moving"
  | "resizing"
  | "writing"
  | "panning"
  | "erasing"
  | "none";

export enum Shapes {
  Rectangle = "rectangle",
  Line = "line",
  Text = "text",
  Freehand = "freehand",
  Ellipse = "ellipse",
  Arrow = "arrow",
}

// Base element properties shared by all shapes
export interface BaseElement {
  id: string;
  type: string;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  status?: string;
  selectedPosition?: SelectedPosition;
  offsetX?: number[];
  offsetY?: number[];
  isSelected?: boolean;
  height?: number;
  width?: number;
}

export interface BoundingElement {
  type: Shapes;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  padding: number;
  height?: number;
  width?: number;
  selectedPosition?: SelectedPosition;
  strokeWidth?: number;
  offsetX?: number[];
  offsetY?: number[];
  isSelected?: boolean;
  stroke?: number[][];
}

// Common properties for elements with x1, y1, x2, y2 coordinates
export interface GeometricElement extends BaseElement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Rectangle specific properties
export interface RectangleElement extends GeometricElement {
  type: "rectangle";
  x2: number;
  y2: number;
}

// Line specific properties
export interface LineElement extends GeometricElement {
  type: "line";
  x2: number;
  y2: number;
  angle?: number /* This will store the tan(Q) value 
                                if(angle < 0) => obtuse 
                                elseif(angle) => Infinity
                                else => acute */;
  isCurved: boolean;
  controlPoint?: Point;
}

// Text specific properties
export interface TextElement extends GeometricElement {
  type: "text";
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  height: number;
  width: number;
  x2: number;
  y2: number;
  breaks: number[];
}

// Freehand specific properties
export interface FreehandElement extends BaseElement {
  type: "freehand";
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  stroke: number[][];
  originalStroke: number[][];
}

export interface ImageElement extends BaseElement {
  type: "image";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  height: number;
  width: number;
  url: string;
  aspectRatio: number;
}

// Union type of all possible elements
export type Element =
  | RectangleElement
  | LineElement
  | TextElement
  | FreehandElement
  | ImageElement;
