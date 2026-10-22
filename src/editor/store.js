// The single way the layout changes. Every edit — buttons, sliders, gestures,
// text, import — ends the same way, in the same order: update the screen,
// record an undo step, save to the browser. If the screen cannot be updated,
// nothing is recorded or saved. Undo/redo itself restores snapshots through
// replace() + render(), without recording a new step.
/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').CommitOptions} CommitOptions */
/**
 * @param {object} deps
 * @param {() => Item[]} deps.get
 * @param {(items: Item[]) => void} deps.set
 * @param {{commit: (options: CommitOptions) => unknown}} deps.history
 * @param {() => boolean} deps.save
 * @param {() => void} deps.render
 * @param {(item: Item) => void} [deps.mark]
 * @returns {import('../types/layout').Store}
 */
export function createStore({get, set, history, save, render, mark = () => {}}) {
  // `group`/`windowMs` merge rapid edits (a slider, typing) into one undo step.
  /** @param {CommitOptions} options @param {boolean} redraw */
  function finish({group = null, windowMs} = {}, redraw) {
    if (redraw) render();
    history.commit({group, windowMs});
    return save();
  }
  return {
    get items() { return get(); },
    find: id => get().find(item => item.id === id),
    // mutate(items) edits in place or returns a new array to replace the layout.
    /** @param {(items: Item[]) => Item[] | void} mutate @param {CommitOptions} [options] */
    change(mutate, options) {
      const result = mutate(get());
      if (Array.isArray(result)) set(result);
      return finish(options, true);
    },
    // The data was already edited (a finished gesture): redraw, record, save.
    commit: (/** @type {CommitOptions} */ options = {}) => finish(options, true),
    // The edit is already on screen (Tiptap typing, a slider restyling the node):
    // remember that, so the next redraw keeps the element instead of rebuilding it.
    /** @param {Item | Item[]} items @param {CommitOptions} [options] */
    shown(items, options) {
      for (const item of [].concat(items)) mark(item);
      return finish(options, false);
    },
    // Replace data without an undo step (startup recovery, undo/redo itself).
    replace(/** @type {Item[]} */ next) { set(next); },
    render: () => render()
  };
}
