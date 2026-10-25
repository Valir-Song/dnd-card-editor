// Line icons for the toolbar ribbon, drawn on a 24×24 grid with round strokes.
// They live in the code (not as files) so the editor stays one offline HTML file.
// Keys are toolbar control ids; a few extra keys serve the top bar.

/** @type {Record<string, string>} */
export const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  saveFile: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  saveFileAs: '<path d="m6 9 6 6 6-6"/>',
  snap: '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4M12 15l4 4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  d20: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 2 7 13h10zM7 13l-4 4M17 13l4 4M7 13l5 9 5-9"/>',

  add: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  delete: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlockPage: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',

  themePage: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  bgUploadLabel: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  bgRemove: '<path d="M18 6 6 18M6 6l12 12"/>',
  resetImage: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',

  addTextBox: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>',
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>',
  bulletList: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  orderedList: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  clearFormatting: '<path d="M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5"/>',

  rect: '<rect x="3" y="5" width="18" height="14" rx="1.5"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  line: '<path d="M4 20 20 4"/>',
  uploadLabel: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',

  addBadge: '<circle cx="11" cy="13" r="8"/><path d="M19 2v6M16 5h6"/>',
  removeBadge: '<circle cx="11" cy="13" r="8"/><path d="M16 5h6"/>',

  front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  forward: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  backward: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M20 8v10a2 2 0 0 1-2 2H8"/>',

  alignLeft: '<path d="M4 2v20"/><rect x="8" y="5" width="12" height="5" rx="1"/><rect x="8" y="14" width="7" height="5" rx="1"/>',
  alignCenter: '<path d="M12 2v20"/><rect x="5" y="5" width="14" height="5" rx="1"/><rect x="8" y="14" width="8" height="5" rx="1"/>',
  alignRight: '<path d="M20 2v20"/><rect x="4" y="5" width="12" height="5" rx="1"/><rect x="9" y="14" width="7" height="5" rx="1"/>',
  alignTop: '<path d="M2 4h20"/><rect x="5" y="8" width="5" height="12" rx="1"/><rect x="14" y="8" width="5" height="7" rx="1"/>',
  alignMiddle: '<path d="M2 12h20"/><rect x="5" y="5" width="5" height="14" rx="1"/><rect x="14" y="8" width="5" height="8" rx="1"/>',
  alignBottom: '<path d="M2 20h20"/><rect x="5" y="4" width="5" height="12" rx="1"/><rect x="14" y="9" width="5" height="7" rx="1"/>',
  distributeX: '<path d="M3 3v18M21 3v18"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  distributeY: '<path d="M3 3h18M3 21h18"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
  sameWidth: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  sameHeight: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',

  save: '<path d="M20 6 9 17l-5-5"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  json: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  importLabel: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  newSheet: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  openFile: '<path d="M6 14 7.5 11.1A2 2 0 0 1 9.3 10H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.4 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"/>',
  layouts: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  compressImages: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  resetStorage: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};

// An inline <svg> for a key of ICONS (null when there is no icon for it).
/** @param {string} name @returns {SVGSVGElement | null} */
export function icon(name) {
  const body = ICONS[name];
  if (!body) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'rb-ico');
  svg.innerHTML = body;
  return svg;
}
