// Which copy of the editor this is. The hosted app (scripts/site.mjs) marks its page with
// <meta name="editor-channel">; a downloaded or standalone file has none and counts as stable.
// The beta lives on the same site as the main app, so it keeps its saves apart: a beta under
// test must never touch the layouts the main app opens before a game.

/** @param {Document | undefined} doc @returns {'stable' | 'beta'} */
export function channelOf(doc) {
  const meta = doc ? doc.querySelector('meta[name="editor-channel"]') : null;
  return meta && meta.getAttribute('content') === 'beta' ? 'beta' : 'stable';
}

export const CHANNEL = channelOf(globalThis.document);
/** Added to storage names: '' keeps the names every earlier version used. */
export const STORAGE_SUFFIX = CHANNEL === 'beta' ? '-beta' : '';
/** The installed app from the site (either channel): its documents are layout files (.dnd); a file from disk keeps saving HTML. */
export const HOSTED = !!globalThis.document?.querySelector('meta[name="editor-channel"]');
