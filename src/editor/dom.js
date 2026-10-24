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
