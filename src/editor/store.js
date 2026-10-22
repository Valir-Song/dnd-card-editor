// The single way the layout changes. Every edit — buttons, sliders, gestures,
// text, import — ends the same way, in the same order: update the screen,
// record an undo step, save to the browser. If the screen cannot be updated,
// nothing is recorded or saved. Undo/redo itself restores snapshots through
// replace() + render(), without recording a new step.
export function createStore({get, set, history, save, render, mark = () => {}}) {
  // `group`/`windowMs` merge rapid edits (a slider, typing) into one undo step.
  function finish({group = null, windowMs} = {}, redraw) {
    if (redraw) render();
    history.commit({group, windowMs});
    return save();
  }
  return {
    get items() { return get(); },
    find: id => get().find(item => item.id === id),
    // mutate(items) edits in place or returns a new array to replace the layout.
    change(mutate, options) {
      const result = mutate(get());
      if (Array.isArray(result)) set(result);
      return finish(options, true);
    },
    // The data was already edited (a finished gesture): redraw, record, save.
    commit: options => finish(options, true),
    // The edit is already on screen (Tiptap typing, a slider restyling the node):
    // remember that, so the next redraw keeps the element instead of rebuilding it.
    shown(items, options) {
      for (const item of [].concat(items)) mark(item);
      return finish(options, false);
    },
    // Replace data without an undo step (startup recovery, undo/redo itself).
    replace(next) { set(next); },
    render: () => render()
  };
}
