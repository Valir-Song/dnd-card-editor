// The element an event came from. Handlers here are attached to inputs and
// the document, so it is typed as an input (value, files, isContentEditable).
/** @param {Event} event @returns {HTMLInputElement} */
export const target = event => /** @type {HTMLInputElement} */ (event.target);

// Hand a generated file to the browser's downloads.
/** @param {string} name @param {string} content @param {string} type */
export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// Rename a toolbar button: the ribbon keeps its text in .rb-label next to an
// icon (toolbar-tabs.js), and setting textContent would drop the icon.
/** @param {HTMLElement} button @param {string} text */
export function setLabel(button, text) {
  const label = button.querySelector('.rb-label');
  (label || button).textContent = text;
}

/**
 * Object.entries that keeps the key type of a record (TypeScript widens it to string).
 * @template {string} K
 * @template V
 * @param {Record<K, V>} object
 * @returns {[K, V][]}
 */
export const entries = object => /** @type {[K, V][]} */ (Object.entries(object));

// What to tell the user about a caught error (anything can be thrown).
/** @param {unknown} error */
export const errorText = error => error instanceof Error ? error.message : String(error);
