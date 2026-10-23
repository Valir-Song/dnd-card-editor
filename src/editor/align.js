// «Выравнивание» tab: line the selection up along its own edges or centre lines
// (one object: along the sheet's 5 mm frame), spread it with equal gaps, give
// it the width or height of the first selected one. Works on page objects and
// on the selected text frames of a card. Locked objects count — the others
// align to them — but never move. Each button is one undo step.
import { bbox, alignBoxes, distributeBoxes, matchSize } from './geometry.js';

/** @typedef {import('../types/geometry').Box} Box */
/** @typedef {{boxes: Box[], fixed: boolean[], area: Box, commit: (next: Box[]) => void}} Targets */

/** @type {Array<[string, 'left'|'center'|'right'|'top'|'middle'|'bottom']>} */
const ALIGN = [['alignLeft', 'left'], ['alignCenter', 'center'], ['alignRight', 'right'],
  ['alignTop', 'top'], ['alignMiddle', 'middle'], ['alignBottom', 'bottom']];

/**
 * New boxes for one button, or null when it has nothing to do.
 * @param {Targets} targets
 * @param {{align?: 'left'|'center'|'right'|'top'|'middle'|'bottom', distribute?: 'x'|'y', match?: 'w'|'h'}} action
 * @returns {Box[] | null}
 */
export function arrange({boxes, fixed, area}, action) {
  if (action.align) return alignBoxes(boxes, action.align, boxes.length === 1 ? area : bbox(boxes));
  if (action.distribute) {
    // Locked objects keep their place and are left out of the spacing.
    const free = boxes.map((box, i) => i).filter(i => !fixed[i]);
    if (free.length < 3) return null;
    const spread = distributeBoxes(free.map(i => boxes[i]), action.distribute), next = boxes.slice();
    free.forEach((i, k) => { next[i] = spread[k]; });
    return next;
  }
  if (action.match && boxes.length > 1) return matchSize(boxes, boxes[0], action.match);
  return null;
}

/**
 * @param {{canvas: {arrangeTargets: () => Targets | null, getIds: () => string[]},
 *   innerCanvas: {arrangeTargets: () => Targets | null, hasSelection: () => boolean, count: () => number}}} deps
 */
export function setupAlign({canvas, innerCanvas}) {
  const button = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
  /** @param {Parameters<typeof arrange>[1]} action */
  function run(action) {
    const targets = innerCanvas.hasSelection() ? innerCanvas.arrangeTargets() : canvas.arrangeTargets();
    const next = targets && arrange(targets, action);
    if (targets && next) targets.commit(next);
  }
  for (const [id, mode] of ALIGN) button(id).addEventListener('click', () => run({align: mode}));
  button('distributeX').addEventListener('click', () => run({distribute: 'x'}));
  button('distributeY').addEventListener('click', () => run({distribute: 'y'}));
  button('sameWidth').addEventListener('click', () => run({match: 'w'}));
  button('sameHeight').addEventListener('click', () => run({match: 'h'}));
  // Buttons that cannot act on the current selection are greyed out.
  function sync() {
    const count = innerCanvas.hasSelection() ? innerCanvas.count() : canvas.getIds().length;
    for (const [id] of ALIGN) button(id).disabled = count < 1;
    button('distributeX').disabled = button('distributeY').disabled = count < 3;
    button('sameWidth').disabled = button('sameHeight').disabled = count < 2;
  }
  sync();
  return {sync};
}
