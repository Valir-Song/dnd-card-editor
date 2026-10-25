// Game mode («Игра», ROADMAP 5.1): at the table the sheet is for ticking, not
// for editing. Texts, badges and objects ignore presses, so a stray tap on a
// tablet moves or retypes nothing; resource boxes and 📖 still work. The ribbon
// shows only what a game needs. This browser remembers the mode for next time.
import { STORAGE_SUFFIX } from './channel.js';
import { icon } from './icons.js';
import { setLabel, target } from './dom.js';

export const PLAY_KEY = 'dnd-card-editor-play' + STORAGE_SUFFIX;
/** What stays pressable on the sheet in game mode. */
export const PLAY_TARGETS = '.pool-cell, .spell-info';
/** Events the sheet sees from a press; touchstart stays free so the page still scrolls. */
export const PRESS_EVENTS = /** @type {const} */ (['pointerdown', 'mousedown', 'click', 'dblclick']);

/**
 * What game mode does with a press on the sheet.
 * 'stop': no editor gesture sees it (the pressed button still gets its click);
 * 'block': neither does the browser (no caret, no text selection).
 * @param {string} type @param {boolean} playable it is on something pressable in the game
 * @returns {'pass' | 'stop' | 'block'}
 */
export function playVerdict(type, playable) {
  if (!playable) return 'block';
  // A press on a box must not select or drag the resources window under it.
  return type === 'click' ? 'pass' : 'stop';
}

/** @param {boolean | null} on @returns {boolean | null} the saved choice, null when unknown */
function remember(on) {
  try {
    if (on === null) return localStorage.getItem(PLAY_KEY) === 'on';
    if (on) localStorage.setItem(PLAY_KEY, 'on'); else localStorage.removeItem(PLAY_KEY);
  } catch { /* private window: the mode just is not remembered */ }
  return null;
}

/**
 * The «Игра» button in the top bar and the game panel of the ribbon.
 * @param {{clearSelection: () => void}} deps
 */
export function setupPlay({clearSelection}) {
  const root = document.documentElement;
  const stage = /** @type {HTMLElement} */ (document.querySelector('.stage'));
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('play'));
  const content = document.querySelector('.toolbar-content');
  const panel = document.createElement('div');
  panel.className = 'toolbar-panel play-panel'; panel.id = 'panel-play';
  /** @param {string} id @param {string} text @param {string} title @param {string} iconId @param {() => void} run */
  const big = (id, text, title, iconId, run) => {
    const node = document.createElement('button');
    node.type = 'button'; node.id = id; node.title = title; node.className = 'rb-large';
    const label = document.createElement('span'); label.className = 'rb-label'; label.textContent = text;
    const svg = icon(iconId);
    node.append(...(svg ? [svg] : []), label);
    node.addEventListener('click', run);
    return node;
  };
  const rest = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id)).click();
  const group = document.createElement('div'); group.className = 'rb-group';
  const body = document.createElement('div'); body.className = 'rb-body rb-big';
  body.append(
    big('playShortRest', 'Короткий отдых', 'Вернуть все ячейки с пометкой КО', 'shortRest', () => rest('shortRest')),
    big('playLongRest', 'Длинный отдых', 'Вернуть все ячейки с пометками КО и ДО', 'longRest', () => rest('longRest')),
  );
  const caption = document.createElement('div'); caption.className = 'rb-name'; caption.textContent = 'Отдых';
  group.append(body, caption);
  const hint = document.createElement('p'); hint.className = 'play-hint';
  hint.textContent = 'Режим игры: лист защищён от случайных правок. Нажимай квадратики ресурсов и 📖. Ctrl+Z отменит лишнее нажатие.';
  const exit = big('playExit', 'К правке', 'Выйти из режима игры: снова можно менять тексты и двигать объекты', 'edit', () => set(false));
  panel.append(group, hint, exit);
  content?.append(panel);

  const isOn = () => root.dataset.play === 'on';
  /** @param {boolean} on */
  function set(on) {
    if (on) {
      clearSelection();
      // Text that held the caret would still take keys.
      const focus = document.activeElement;
      if (focus instanceof HTMLElement && stage.contains(focus)) focus.blur();
      root.dataset.play = 'on';
    } else delete root.dataset.play;
    setLabel(button, on ? 'Правка' : 'Игра');
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Выйти из режима игры и снова править лист' : 'Режим игры: лист защищён от правок, нажимаются только квадратики ресурсов и 📖';
    remember(on);
  }
  button.addEventListener('click', () => set(!isOn()));

  // Capture phase on the stage runs before the gesture layer and the text editors on each page.
  for (const type of PRESS_EVENTS) stage.addEventListener(type, event => {
    if (!isOn()) return;
    const verdict = playVerdict(type, !!target(event).closest?.(PLAY_TARGETS));
    if (verdict === 'pass') return;
    event.stopPropagation();
    if (verdict === 'block') event.preventDefault();
  }, true);
  // Tab can still reach a text; it must not take keys (nor keep the selection its focus made).
  stage.addEventListener('focusin', event => {
    const node = target(event);
    if (!isOn() || !node.isContentEditable) return;
    node.blur();
    clearSelection();
  });
  // Pasting objects or a picture, or cutting them, is editing too.
  for (const type of ['paste', 'cut', 'drop']) window.addEventListener(type, event => {
    if (!isOn() || target(event).closest?.('input, textarea')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);

  set(!!remember(null));
  return {isOn, set};
}
