// One object of the layout (a JSON array of these). Coordinates are in mm.
// See README → «Формат макета».
export type Kind = 'header' | 'note' | 'resources' | 'section' | 'card' | 'shape' | 'image' | 'textbox' | 'sheet' | 'hp' | 'character';
// The text fields of an object; each has a plain (title) and a formatted (titleHtml) version.
export type TextField = 'title' | 'subtitle' | 'meta' | 'detail' | 'text';
// A row of tick boxes in a resources box (see src/editor/resources.js).
export type Rest = 'long' | 'short' | 'none';
export interface Pool { label: string; count: number; used: number; rest: Rest; col: 0 | 1 }
// Hit points box (kind 'hp', see src/editor/hp.js).
export interface HitPoints { now: number; max: number; temp: number }
export interface HitDice { count: number; die: number; used: number }
export interface DeathSaves { ok: number; fail: number }
// Character stats (kind 'character', see src/editor/character.js): what the player typed;
// everything else is counted. `fixed` holds the numbers typed over a count (key → number).
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export interface Character {
  level: number;
  scores: Record<Ability, number>;
  saves: Ability[];
  skills: Record<string, 1 | 2>;
  jack: boolean;
  spell: Ability | '';
  fixed: Record<string, number>;
}
export interface Frame { x?: number; y?: number; w?: number; h?: number }
export interface Item {
  id: string;
  kind: Kind;
  page: number;
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
  // Resources box: rows of boxes (spell slots, other resources).
  pools?: Pool[];
  // Hit points box: the numbers, and the optional rows (absent = hidden).
  hp?: HitPoints; hitDice?: HitDice; deathSaves?: DeathSaves;
  // Character stats: one invisible object per layout, edited in the «Персонаж» window.
  character?: Character;
  // Locked in place (see src/editor/lock.js); absent means unlocked.
  locked?: boolean;
  // A card's text layout: the compact one of the first page or the roomy one of the others (4.2).
  // Absent means «as the page it is on»; set when the card changes pages, so it keeps its look.
  cardLook?: 'compact' | 'full';
  // Look of a card or box (see src/editor/themes.js); absent means the default look.
  theme?: string;
  // Background of a page (kind 'sheet', see src/editor/sheet.js); src/fit/opacity are its picture.
  sheet?: string;
  // Frame (see src/editor/borders.js): style id, colour (#rrggbb) and width in mm; absent means none.
  outline?: string; outlineColor?: string; outlineWidth?: number;
  // Card made from the spell reference (see src/editor/spells.js): its id and full text for «📖».
  spellId?: string; spellText?: string;
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
// A new object as the toolbar describes it: editor.js adds id, page, place and layer.
export type NewItem = Partial<Item> & { kind: Kind; w: number; h: number };
// What editor.js hands to its feature modules (each module names the ones it uses, see Deps).
export interface Editor {
  store: Store;
  // The one selected object (null with a group or nothing selected).
  current: () => Item | undefined;
  getSelected: () => string | null;
  // Every selected object; empty while a text inside a card is selected.
  getSelectionIds: () => string[];
  select: (element: HTMLElement | null) => void;
  clearSelection: () => void;
  getPage: () => number;
  addCard: () => void;
  addObject: (item: NewItem, wish?: { x: number; y: number }) => void;
  addObjects: (list: NewItem[], wish?: { x: number; y: number }) => Item[];
  // How many were removed (locked ones stay).
  removeObjects: (ids: string[]) => number;
  syncImageTools: () => void;
  syncBgTools: () => void;
  mm: (value: number) => string;
  pages: HTMLElement[];
}
// Feature-module dependencies: the store and the named helpers of the editor.
export type Deps<K extends keyof Editor = never> = Pick<Editor, 'store' | K>;
