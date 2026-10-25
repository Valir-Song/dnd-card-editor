// Saved layouts (see src/editor/storage.js).
import type { Item } from './layout';

// What is read back: `items` is unchecked (may be damaged or, from a broken
// localStorage entry, the raw text) until normalizeLayout accepts it.
// `formatVersion` (see src/editor/layout.js) is missing in records written before 3.11.0 beta.13 (format 1).
export interface StoredLayout { id: string; name: string; savedAt: string; formatVersion?: unknown; items: unknown }
export interface LayoutRecord { id: string; name: string; savedAt: string; formatVersion?: number; items: Item[] }
// Small per-layout summary, so the list of saves loads without the pictures.
export interface LayoutMeta { id: string; name: string; savedAt: string; count: number; bytes: number }

export type BackendKind = 'indexeddb' | 'localstorage' | 'none';
export interface Backend {
  kind: BackendKind;
  list(): Promise<LayoutMeta[]>;
  load(id: string): Promise<StoredLayout | null>;
  // Must take its copy of `record` synchronously, before the first await:
  // the editor keeps changing the same objects while the write is in flight.
  put(record: LayoutRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SaveState = 'saved' | 'saving' | 'error';
export interface Saver {
  // Ask for the current layout to be written (coalesced, one write at a time).
  request(): void;
  // Resolves once nothing is pending: true if the last write succeeded.
  flush(): Promise<boolean>;
  readonly state: SaveState;
}
