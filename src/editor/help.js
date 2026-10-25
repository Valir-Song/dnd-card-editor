// «Справка» (3.11 beta.16): the editing guide in a dialog instead of one long
// paragraph under the pages. The text lives in index.html (#helpDialog), so it
// stays in a downloaded file; F1 or the top bar button opens it, Esc closes it.

/** @param {{dialog: HTMLDialogElement, button: HTMLElement}} deps */
export function setupHelp({ dialog, button }) {
  const open = () => { if (!dialog.open) dialog.showModal(); };
  button.addEventListener('click', open);
  dialog.querySelector('#helpClose')?.addEventListener('click', () => dialog.close());
  // A click on the backdrop (outside the box) closes it too.
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'F1') return;
    event.preventDefault();
    open();
  });
}
