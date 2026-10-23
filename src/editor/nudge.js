// Arrow keys move the selection: 1 mm per press; with Shift to the next grid
// line, or 5 mm without a grid. Selected text frames of a card move inside it.
// In text, inputs, toolbar tabs and dialogs the keys keep their usual meaning;
// Esc leaves a text (its frame stays selected), so the arrows then move it.

/** @type {Record<string, [number, number]>} */
const DIRECTIONS = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

/** Step in mm for one press. @param {boolean} shift @param {number} grid 0 = no grid */
export const nudgeStep = (shift, grid) => !shift ? 1 : grid > 0 ? grid : 5;

/** Is the focus somewhere the arrow keys belong to (text, a field, a tab, a dialog)? */
function keysTaken() {
  const focus = document.activeElement;
  if (document.querySelector('dialog[open]')) return true;
  return focus instanceof HTMLElement && (focus.isContentEditable || !!focus.closest('input, textarea, select, [role="tab"]'));
}

/**
 * @param {{canvas: {nudge: (dx: number, dy: number, options?: {grid?: number}) => boolean},
 *   innerCanvas: {nudge: (dx: number, dy: number) => boolean, hasSelection: () => boolean},
 *   snapping: {get: () => import('../types/geometry').SnapSettings}}} deps
 */
export function setupNudge({canvas, innerCanvas, snapping}) {
  document.addEventListener('keydown', event => {
    const focus = document.activeElement;
    if (event.key === 'Escape' && focus instanceof HTMLElement && focus.isContentEditable && focus.closest('.page')) {
      focus.blur();
      getSelection()?.removeAllRanges();
      return;
    }
    const direction = DIRECTIONS[event.key];
    if (!direction || event.ctrlKey || event.metaKey || event.altKey || keysTaken()) return;
    const settings = snapping.get(), grid = settings.enabled ? settings.gridMm : 0;
    const step = nudgeStep(event.shiftKey, grid);
    const [dx, dy] = [direction[0] * step, direction[1] * step];
    const handled = innerCanvas.hasSelection()
      ? innerCanvas.nudge(dx, dy)
      : canvas.nudge(dx, dy, {grid: event.shiftKey ? grid : 0});
    // With something selected the page must not scroll, even if nothing could move.
    if (handled) event.preventDefault();
  });
}
