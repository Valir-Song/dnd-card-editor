// One object of the layout (a JSON array of these). Coordinates are in mm.
// See README → «Формат макета».
export type Kind = 'header' | 'note' | 'resources' | 'section' | 'card' | 'shape' | 'image' | 'textbox' | 'sheet';
export interface Frame { x?: number; y?: number; w?: number; h?: number }
export interface Item {
  id: string;
  kind: Kind;
  page: 1 | 2;
  x: number; y: number; w: number; h: number;
  z?: number;
  title?: string; subtitle?: string; meta?: string; detail?: string; text?: string;
  titleHtml?: string; subtitleHtml?: string; metaHtml?: string; detailHtml?: string; textHtml?: string;
  textFrames?: Record<string, Frame>;
  level?: string; badgeX?: number; badgeY?: number; badgeCustomPosition?: boolean;
  // Badges (see src/editor/badges.js): colour of the main one, and more badges.
  badgeColor?: string; badges?: Array<{text: string; x: number; y: number; color?: string}>;
  bg?: string; bgImage?: string; bgFit?: string;
  bgOpacity?: number; bgZoom?: number; bgX?: number; bgY?: number; bgShade?: number;
  shape?: 'rect' | 'circle' | 'line';
  src?: string; fit?: string; opacity?: number; brightness?: number; contrast?: number; rotation?: number;
  roles?: string;
  // Locked in place (see src/editor/lock.js); absent means unlocked.
  locked?: boolean;
  // Look of a card or box (see src/editor/themes.js); absent means the default look.
  theme?: string;
  // Background of a page (kind 'sheet', see src/editor/sheet.js); src/fit/opacity are its picture.
  sheet?: string;
  // Text box (kind 'textbox').
  autoHeight?: boolean; bgTransparent?: boolean; borderVisible?: boolean; borderColor?: string;
  fontFamily?: string; fontSize?: number; textAlign?: string; textColor?: string; textWeight?: string;
}
// Options that merge rapid edits (a slider, typing) into one undo step.
export interface CommitOptions { group?: string | null; windowMs?: number }
// The store every feature module receives (see src/editor/store.js).
export interface Store {
  readonly items: Item[];
  find(id: string): Item | undefined;
  // Edit (in place, or return a new array), then redraw, record and save.
  change(mutate: (items: Item[]) => Item[] | void, options?: CommitOptions): boolean;
  // The data was already edited (a finished gesture): redraw, record, save.
  commit(options?: CommitOptions): boolean;
  // The edit is already on screen: remember that, record and save.
  shown(items: Item | Item[], options?: CommitOptions): boolean;
  replace(items: Item[]): void;
  render(): void;
}
// Feature-module dependencies: the store is typed; other helpers are left open.
export type Deps = { store: Store; current?: () => Item | undefined; [dependency: string]: any };
