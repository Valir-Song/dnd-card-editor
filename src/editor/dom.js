// The element an event came from. Handlers here are attached to inputs and
// the document, so it is typed as an input (value, files, isContentEditable).
/** @param {Event} event @returns {HTMLInputElement} */
export const target = event => /** @type {HTMLInputElement} */ (event.target);
