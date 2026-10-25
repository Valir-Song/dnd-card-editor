// Hit points («Хиты», ROADMAP 5.1): a box with the current, maximum and
// temporary hit points, − and + for one point, an amount with «Урон» and
// «Лечение», and two optional rows — hit dice (boxes like the resources ones)
// and death saves (three successes, three failures). Damage takes temporary
// hit points first; a long rest brings everything back (2024 rules: half the
// hit dice). All of it is kept on a `kind: 'hp'` object (format unchanged:
// an editor before 3.11 beta.21 does not know the kind and will not open it).

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').HitPoints} HitPoints */
/** @typedef {import('../types/layout').HitDice} HitDice */
/** @typedef {import('../types/layout').DeathSaves} DeathSaves */

export const MAX_HP = 999;
export const MAX_DICE = 20;
export const DICE = [6, 8, 10, 12];
export const SAVES = 3;

/** @param {unknown} value @param {number} max */
const whole = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value)) || 0));

/** The hit points of an item, repaired. @param {Item} item @returns {HitPoints} */
export function hpOf(item) {
  const hp = item.hp && typeof item.hp === 'object' ? item.hp : /** @type {Partial<HitPoints>} */ ({});
  const max = whole(hp.max, MAX_HP);
  return {now: whole(hp.now, max), max, temp: whole(hp.temp, MAX_HP)};
}

/** The hit dice row, repaired; null when the row is hidden. @param {Item} item @returns {HitDice | null} */
export function diceOf(item) {
  const dice = item.hitDice;
  if (!dice || typeof dice !== 'object') return null;
  const count = whole(dice.count, MAX_DICE);
  return {count, die: DICE.includes(Number(dice.die)) ? Number(dice.die) : 8, used: whole(dice.used, count)};
}

/** The death saves row, repaired; null when the row is hidden. @param {Item} item @returns {DeathSaves | null} */
export function savesOf(item) {
  const saves = item.deathSaves;
  if (!saves || typeof saves !== 'object') return null;
  return {ok: whole(saves.ok, SAVES), fail: whole(saves.fail, SAVES)};
}

// ---- edits (each changes the item in place) ----

/** @param {Item} item @param {(hp: HitPoints) => void} change */
function editHp(item, change) {
  const hp = hpOf(item);
  change(hp);
  hp.now = Math.min(hp.now, hp.max);
  item.hp = hp;
}

/**
 * Damage: temporary hit points go first, the current ones never drop below 0.
 * @param {Item} item @param {number} amount
 */
export function damage(item, amount) {
  const n = whole(amount, MAX_HP * 2);
  editHp(item, hp => {
    const fromTemp = Math.min(hp.temp, n);
    hp.temp -= fromTemp;
    hp.now = Math.max(0, hp.now - (n - fromTemp));
  });
}

/**
 * Healing up to the maximum. Back from 0 hit points, the death saves start over.
 * @param {Item} item @param {number} amount
 */
export function heal(item, amount) {
  const n = whole(amount, MAX_HP);
  if (!n) return;
  const was = hpOf(item).now;
  editHp(item, hp => { hp.now = Math.min(hp.max, hp.now + n); });
  if (!was && hpOf(item).now) clearSaves(item);
}

/** − and +: one point of the current hit points. @param {Item} item @param {-1 | 1} delta */
export function step(item, delta) {
  if (delta > 0) heal(item, 1); else damage(item, 1);
}

/**
 * A number typed in place: the current, maximum or temporary hit points.
 * A new maximum on a fresh box (current = old maximum) carries the current along.
 * @param {Item} item @param {'now' | 'max' | 'temp'} key @param {unknown} value
 */
export function setHp(item, key, value) {
  editHp(item, hp => {
    const n = whole(value, MAX_HP);
    if (key === 'max' && hp.now === hp.max) hp.now = n;
    hp[key] = n;
  });
}

/** Show or hide the hit dice row. @param {Item} item @param {boolean} [show] */
export function toggleDice(item, show = !diceOf(item)) {
  if (show) item.hitDice = diceOf(item) || {count: 1, die: 8, used: 0};
  else delete item.hitDice;
}

/** Show or hide the death saves row. @param {Item} item @param {boolean} [show] */
export function toggleSaves(item, show = !savesOf(item)) {
  if (show) item.deathSaves = savesOf(item) || {ok: 0, fail: 0};
  else delete item.deathSaves;
}

/** @param {Item} item @param {Partial<HitDice>} change */
export function setDice(item, change) {
  const dice = diceOf(item);
  if (!dice) return;
  const next = {...dice, ...change};
  next.count = whole(next.count, MAX_DICE);
  next.used = whole(next.used, next.count);
  item.hitDice = {count: next.count, die: DICE.includes(Number(next.die)) ? Number(next.die) : 8, used: next.used};
}

/**
 * A click on die `cell`: an empty one is spent up to it, a spent one comes back from it
 * (like the resources boxes).
 * @param {Item} item @param {number} cell
 */
export function toggleDie(item, cell) {
  const dice = diceOf(item);
  if (dice) setDice(item, {used: cell < dice.used ? cell : cell + 1});
}

/** @param {Item} item @param {'ok' | 'fail'} kind @param {number} cell */
export function toggleSave(item, kind, cell) {
  const saves = savesOf(item);
  if (!saves) return;
  saves[kind] = cell < saves[kind] ? cell : Math.min(SAVES, cell + 1);
  item.deathSaves = saves;
}

/** @param {Item} item */
function clearSaves(item) {
  if (savesOf(item)) item.deathSaves = {ok: 0, fail: 0};
}

/**
 * A rest for every hit points box. A long one: hit points to the maximum, no
 * temporary ones, death saves start over, half the hit dice (at least one) back.
 * A short one changes nothing here: the player spends hit dice and heals by hand.
 * @param {Item[]} items @param {'short' | 'long'} kind
 * @returns {Item[]} the boxes that changed
 */
export function hpRest(items, kind) {
  if (kind !== 'long') return [];
  return items.filter(item => {
    if (item.kind !== 'hp') return false;
    const before = JSON.stringify([item.hp, item.hitDice, item.deathSaves]);
    editHp(item, hp => { hp.now = hp.max; hp.temp = 0; });
    clearSaves(item);
    const dice = diceOf(item);
    if (dice) setDice(item, {used: Math.max(0, dice.used - Math.max(1, Math.floor(dice.count / 2)))});
    return JSON.stringify([item.hp, item.hitDice, item.deathSaves]) !== before;
  });
}

/** A new hit points box. @returns {import('../types/layout').NewItem} */
export const newHp = () => ({
  kind: 'hp', w: 62, h: 30, title: 'ХИТЫ',
  hp: {now: 10, max: 10, temp: 0},
  hitDice: {count: 1, die: 8, used: 0},
  deathSaves: {ok: 0, fail: 0}
});

// ---- on the sheet ----

/**
 * @typedef {{step: (delta: -1 | 1) => void, damage: (amount: number) => void, heal: (amount: number) => void,
 *   set: (key: 'now' | 'max' | 'temp', value: number) => void, die: (cell: number) => void,
 *   dice: (change: Partial<HitDice>) => void, save: (kind: 'ok' | 'fail', cell: number) => void,
 *   hide: (row: 'dice' | 'saves') => void}} HpActions
 */

/**
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag @param {string} className @param {string} [text] @returns {HTMLElementTagNameMap[T]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} className @param {string} text @param {string} title @param {() => void} run */
function button(className, text, title, run) {
  const node = el('button', className, text);
  node.type = 'button'; node.title = title;
  node.addEventListener('click', event => { event.stopPropagation(); run(); });
  return node;
}

/** @param {string} className @param {number} value @param {string} title @param {(value: number) => void} done */
function number(className, value, title, done) {
  const node = el('input', className);
  node.type = 'number'; node.min = '0'; node.max = String(MAX_HP); node.value = String(value); node.title = title;
  node.inputMode = 'numeric';
  node.addEventListener('change', () => done(Number(node.value)));
  node.addEventListener('keydown', event => { if (event.key === 'Enter') node.blur(); });
  return node;
}

/**
 * The body of a hit points box. Controls a player uses at the table carry
 * `hp-play`: game mode (play.js) leaves only those pressable.
 * @param {Item} item @param {HpActions} act @returns {HTMLElement}
 */
export function buildHp(item, act) {
  const hp = hpOf(item);
  const root = el('div', 'hp-body');
  const main = el('div', 'hp-main');
  main.append(
    button('hp-step hp-play', '−', 'Минус один хит', () => act.step(-1)),
    number('hp-now hp-play', hp.now, 'Сколько хитов сейчас', value => act.set('now', value)),
    el('span', 'hp-of', '/'),
    number('hp-max', hp.max, 'Максимум хитов', value => act.set('max', value)),
    button('hp-step hp-play', '+', 'Плюс один хит', () => act.step(1))
  );
  const temp = el('label', 'hp-temp', 'врем.');
  temp.title = 'Временные хиты: урон снимает их первыми';
  temp.append(number('hp-temp-value hp-play', hp.temp, 'Временные хиты', value => act.set('temp', value)));
  main.append(temp);
  const change = el('div', 'hp-change');
  const amount = number('hp-amount hp-play', 0, 'Сколько урона или лечения', () => {});
  amount.value = ''; amount.placeholder = '0';
  const take = (/** @type {(n: number) => void} */ run) => () => { const n = Number(amount.value); if (n > 0) run(n); };
  change.append(amount,
    button('hp-damage hp-play', 'Урон', 'Отнять столько хитов (сначала временные)', take(act.damage)),
    button('hp-heal hp-play', 'Лечение', 'Добавить столько хитов (не больше максимума)', take(act.heal)));
  root.append(main, change);
  const dice = diceOf(item);
  if (dice) {
    const row = el('div', 'hp-row hp-dice');
    const die = el('select', 'hp-die');
    die.title = 'Кость хитов';
    for (const size of DICE) { const option = el('option', '', 'd' + size); option.value = String(size); die.append(option); }
    die.value = String(dice.die);
    die.addEventListener('change', () => act.dice({die: Number(die.value)}));
    const cells = el('span', 'hp-cells');
    for (let cell = 0; cell < dice.count; cell++)
      cells.append(button('hp-cell hp-play' + (cell < dice.used ? ' used' : ''), '', cell < dice.used ? 'Потрачена — щёлкни, чтобы вернуть' : 'Щёлкни, когда потратишь', () => act.die(cell)));
    const tools = el('span', 'hp-tools');
    tools.append(
      button('', '−', 'Убрать кость', () => act.dice({count: dice.count - 1})),
      button('', '+', 'Добавить кость', () => act.dice({count: dice.count + 1})),
      button('', '✕', 'Скрыть кости хитов', () => act.hide('dice')));
    row.append(el('span', 'hp-label', 'Кости хитов'), die, cells, tools);
    root.append(row);
  }
  const saves = savesOf(item);
  if (saves) {
    const row = el('div', 'hp-row hp-saves');
    row.append(el('span', 'hp-label', 'Спасброски от смерти'));
    for (const [kind, mark, name] of /** @type {const} */ ([['ok', '✓', 'Успех'], ['fail', '✗', 'Провал']])) {
      const group = el('span', 'hp-save ' + kind);
      group.append(el('span', 'hp-mark', mark));
      for (let cell = 0; cell < SAVES; cell++)
        group.append(button('hp-dot hp-play' + (cell < saves[kind] ? ' used' : ''), '', name + ' ' + (cell + 1), () => act.save(kind, cell)));
      row.append(group);
    }
    const tools = el('span', 'hp-tools');
    tools.append(button('', '✕', 'Скрыть спасброски', () => act.hide('saves')));
    row.append(tools);
    root.append(row);
  }
  return root;
}

/**
 * The «Хиты» tools on the ribbon: a new box; the two optional rows of the selected boxes.
 * @param {import('../types/layout').Deps<'addObject' | 'current' | 'getSelectionIds'>} deps
 */
export function setupHp({store, addObject, current, getSelectionIds}) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
  const targets = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()]).filter(item => item?.kind === 'hp'));
  };
  byId('addHp').addEventListener('click', () => addObject(newHp()));
  for (const [id, toggle, has] of /** @type {const} */ ([['hpDice', toggleDice, diceOf], ['hpSaves', toggleSaves, savesOf]]))
    byId(id).addEventListener('click', () => {
      const list = targets();
      if (!list.length) return;
      // One click shows the row everywhere, or hides it when every box has it.
      const show = !list.every(item => has(item));
      store.change(() => { for (const item of list) toggle(item, show); });
    });
  function sync() {
    const none = !targets().length;
    byId('hpDice').disabled = none;
    byId('hpSaves').disabled = none;
  }
  sync();
  return {sync};
}
