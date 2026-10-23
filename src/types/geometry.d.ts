// Millimetre geometry shared by gestures, snapping and their tests.
export interface Box { x: number; y: number; w: number; h: number }
export type Point = [number, number];
// Which edges a resize moves: -1 left/top, 1 right/bottom, 0 none.
export type Dir = [-1 | 0 | 1, -1 | 0 | 1];
// Candidate snap lines (mm) on each axis.
export interface Lines { x: number[]; y: number[] }
export interface Snap { offset: number; line: number | null }
export interface SnapSettings { enabled: boolean; gridMm: number }
// An equal gap to highlight: from..to along `axis`, drawn at `at` across it (mm).
export interface GapMark { axis: 'x' | 'y'; from: number; to: number; at: number }
