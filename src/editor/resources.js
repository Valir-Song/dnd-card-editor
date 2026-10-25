// Resources («Ресурсы»): rows of tick boxes on a `resources` box — spell slots
// («1 круг») and anything else that is spent and comes back (Вдохновение, Лютня).
// Each row is {label, count, used, rest, col}: `used` boxes are filled, `rest`
// says which rest brings them back, `col` puts the row in the left or right
// column. Until 3.11 the boxes were typed as «□» into the text (`detail`);
// format 3 turns such text into rows (see migrateResources and layout.js).

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').Pool} Pool */
/** @typedef {import('../types/layout').Rest} Rest */

export const MAX_CELLS = 20;
/** @type {Rest[]} the order a click on the rest mark goes through */
export const RESTS = ['long', 'short', 'none'];
/** @type {Record<Rest, string>} */
export const REST_MARK = {long: 'ДО', short: 'КО', none: ''};
/** @type {Record<Rest, string>} */
export const REST_TITLE = {
  long: 'Восстанавливается после длинного отдыха',
  short: 'Восстанавливается после короткого (и длинного) отдыха',
  none: 'Отдых не восстанавливает'
};
const EMPTY_BOX = '□☐▢◻';
const FILLED_BOX = '■☑☒▣◼';
// «Название: □ □ ■» — a label, a colon, then boxes (filled ones are spent).
const ROW = new RegExp('([^:\\n]*?)\\s*:\\s*((?:[' + EMPTY_BOX + FILLED_BOX + ']\\s*)+)', 'g');

/** @param {unknown} value @returns {Rest} */
const restOf = value => RESTS.includes(/** @type {Rest} */ (value)) ? /** @type {Rest} */ (value) : 'long';
/** @param {unknown} value @param {number} max */
const whole = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value)) || 0));

/**
 * The rows of an item, repaired: odd values from a hand-edited file become sensible ones.
 * @param {Item} item @returns {Pool[]}
 */
export function poolsOf(item) {
  if (!Array.isArray(item.pools)) return [];
  return item.pools.filter(pool => pool && typeof pool === 'object').map(pool => {
    const count = whole(pool.count, MAX_CELLS);
    return {label: String(pool.label ?? ''), count, used: whole(pool.used, count), rest: restOf(pool.rest), col: pool.col === 1 ? 1 : 0};
  });
}

/** «Ячейки 2» or «Ячейки 2 круга» (the old wordings) becomes «2 круг». @param {string} label */
const tidyLabel = label => label.trim().replace(/^ячейки\s+([1-9])(\s+круга?)?$/i, '$1 круг');

/**
 * Rows typed as text: every «label: □ □ □» becomes a row (the first on a line
 * goes left, the next right); whatever is not such a row stays as text.
 * @param {string} text
 * @returns {{pools: Pool[], rest: string}}
 */
export function parsePools(text) {
  /** @type {Pool[]} */
  const pools = [];
  const left = [];
  for (const line of text.split('\n')) {
    let col = 0;
    const rest = line.replace(ROW, (match, label, boxes) => {
      const marks = [...boxes].filter(ch => (EMPTY_BOX + FILLED_BOX).includes(ch));
      const count = Math.min(MAX_CELLS, marks.length);
      const used = Math.min(count, marks.filter(ch => FILLED_BOX.includes(ch)).length);
      pools.push({label: tidyLabel(label), count, used, rest: 'long', col: /** @type {0 | 1} */ (Math.min(col++, 1))});
      return ' ';
    });
    if (rest.trim()) left.push(rest.trim());
  }
  return {pools, rest: left.join('\n')};
}

/**
 * Format 2 → 3: a resources box whose text holds «□» rows gets real rows.
 * Text that is not a row stays (plain: its formatting is dropped with the boxes).
 * @param {Record<string, any>} item @returns {boolean} changed
 */
export function migrateResources(item) {
  if (item.kind !== 'resources' || item.pools !== undefined || typeof item.detail !== 'string') return false;
  const {pools, rest} = parsePools(item.detail);
  if (!pools.length) return false;
  item.pools = pools;
  delete item.detailHtml;
  if (rest) item.detail = rest; else delete item.detail;
  return true;
}

// ---- edits (each changes the item in place) ----

/** @param {Item} item @param {(pools: Pool[]) => void} change */
function edit(item, change) {
  const pools = poolsOf(item);
  change(pools);
  item.pools = pools;
}

/**
 * A new row: «N круг» goes left after the last circle, any other resource right.
 * @param {Item} item @param {'spell' | 'extra'} type @returns {number} its index
 */
export function addPool(item, type) {
  let index = 0;
  edit(item, pools => {
    if (type === 'spell') {
      const circles = pools.map(pool => Number(/^([1-9]) круг/.exec(pool.label)?.[1] || 0));
      const next = Math.min(9, Math.max(0, ...circles) + 1);
      const last = circles.reduce((found, n, i) => n ? i : found, -1);
      index = last + 1;
      pools.splice(index, 0, {label: next + ' круг', count: 2, used: 0, rest: 'long', col: 0});
    } else {
      index = pools.length;
      pools.push({label: 'Ресурс', count: 1, used: 0, rest: 'long', col: 1});
    }
  });
  return index;
}

/** @param {Item} item @param {number} index @param {number} delta */
export function changeCount(item, index, delta) {
  edit(item, pools => {
    const pool = pools[index];
    if (!pool) return;
    pool.count = whole(pool.count + delta, MAX_CELLS);
    pool.used = Math.min(pool.used, pool.count);
  });
}

/**
 * A click on box `cell`: an empty one fills up to it, a filled one empties from it.
 * @param {Item} item @param {number} index @param {number} cell
 */
export function toggleCell(item, index, cell) {
  edit(item, pools => {
    const pool = pools[index];
    if (pool) pool.used = cell < pool.used ? cell : Math.min(pool.count, cell + 1);
  });
}

/** @param {Item} item @param {number} index */
export function cycleRest(item, index) {
  edit(item, pools => {
    const pool = pools[index];
    if (pool) pool.rest = RESTS[(RESTS.indexOf(pool.rest) + 1) % RESTS.length];
  });
}

/** @param {Item} item @param {number} index */
export function switchColumn(item, index) {
  edit(item, pools => { const pool = pools[index]; if (pool) pool.col = pool.col ? 0 : 1; });
}

/** @param {Item} item @param {number} index */
export function removePool(item, index) {
  edit(item, pools => { pools.splice(index, 1); });
  if (!poolsOf(item).length) delete item.pools;
}

/** @param {Item} item @param {number} index @param {string} label */
export function setPoolLabel(item, index, label) {
  const pool = Array.isArray(item.pools) ? item.pools[index] : undefined;
  if (pool) pool.label = label;
}

/**
 * A rest: a short one brings back «КО» rows, a long one «КО» and «ДО».
 * @param {Item[]} items @param {'short' | 'long'} kind
 * @returns {Item[]} the boxes that changed
 */
export function takeRest(items, kind) {
  const back = kind === 'short' ? ['short'] : ['short', 'long'];
  return items.filter(item => {
    if (item.kind !== 'resources') return false;
    const pools = poolsOf(item);
    if (!pools.some(pool => pool.used && back.includes(pool.rest))) return false;
    for (const pool of pools) if (back.includes(pool.rest)) pool.used = 0;
    item.pools = pools;
    return true;
  });
}

/** A new resources box, ready to fill in. @returns {import('../types/layout').NewItem} */
export const newResources = () => ({
  kind: 'resources', w: 82, h: 24, title: 'РЕСУРСЫ',
  pools: [
    {label: '1 круг', count: 2, used: 0, rest: 'long', col: 0},
    {label: 'Ресурс', count: 1, used: 0, rest: 'long', col: 1}
  ]
});

// ---- on the sheet ----

/**
 * @typedef {{toggle: (index: number, cell: number) => void, count: (index: number, delta: number) => void,
 *   rest: (index: number) => void, column: (index: number) => void, remove: (index: number) => void,
 *   label: (index: number, text: string) => void}} PoolActions
 */

/** @param {string} className @param {string} text @param {string} title @param {() => void} run */
function button(className, text, title, run) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = className; node.textContent = text; node.title = title;
  node.addEventListener('click', event => { event.stopPropagation(); run(); });
  return node;
}

/**
 * The rows of a resources box, in two columns. Each column lines its boxes up
 * after the longest name; a long row wraps its boxes under its own first box.
 * @param {Item} item @param {PoolActions} act @returns {HTMLElement}
 */
export function buildPools(item, act) {
  const root = document.createElement('div');
  root.className = 'pools';
  const columns = [0, 1].map(col => {
    const column = document.createElement('div');
    column.className = 'pool-col'; column.dataset.col = String(col);
    root.append(column);
    return column;
  });
  poolsOf(item).forEach((pool, index) => {
    const row = document.createElement('div');
    row.className = 'pool'; row.dataset.index = String(index);
    const name = document.createElement('span');
    name.className = 'pool-name';
    const label = document.createElement('span');
    label.className = 'pool-label'; label.textContent = pool.label; label.spellcheck = false;
    try { label.contentEditable = 'plaintext-only'; } catch { label.contentEditable = 'true'; } // older Firefox
    label.title = 'Название — щёлкни, чтобы изменить';
    label.addEventListener('input', () => act.label(index, (label.textContent ?? '').replace(/\n/g, ' ')));
    label.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); label.blur(); } });
    name.append(label);
    if (pool.rest !== 'none') {
      const mark = button('pool-rest', REST_MARK[pool.rest], REST_TITLE[pool.rest] + ' (щёлкни, чтобы сменить)', () => act.rest(index));
      name.append(mark);
    }
    const cells = document.createElement('span');
    cells.className = 'pool-cells';
    for (let cell = 0; cell < pool.count; cell++)
      cells.append(button('pool-cell' + (cell < pool.used ? ' used' : ''), '', cell < pool.used ? 'Потрачено — щёлкни, чтобы вернуть' : 'Щёлкни, когда потратишь', () => act.toggle(index, cell)));
    const tools = document.createElement('span');
    tools.className = 'pool-tools';
    tools.append(
      button('', '−', 'Убрать ячейку', () => act.count(index, -1)),
      button('', '+', 'Добавить ячейку', () => act.count(index, 1)),
      button('', pool.rest === 'none' ? '—' : REST_MARK[pool.rest], 'Когда восстанавливается: ' + REST_TITLE[pool.rest].toLowerCase() + '. Щёлкни, чтобы сменить', () => act.rest(index)),
      button('', pool.col ? '⇠' : '⇢', 'В другую колонку', () => act.column(index)),
      button('', '✕', 'Удалить строку', () => act.remove(index))
    );
    row.append(name, cells, tools);
    columns[pool.col].append(row);
  });
  return root;
}

/**
 * The resources tools on the ribbon: a new box, new rows on the selected boxes, rests.
 * @param {import('../types/layout').Deps<'addObject' | 'current' | 'getSelectionIds'>} deps
 */
export function setupResources({store, addObject, current, getSelectionIds}) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
  const targets = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()]).filter(item => item?.kind === 'resources'));
  };
  byId('addResources').addEventListener('click', () => addObject(newResources()));
  for (const [id, type] of /** @type {const} */ ([['addSpellRow', 'spell'], ['addExtraRow', 'extra']]))
    byId(id).addEventListener('click', () => {
      const list = targets();
      if (list.length) store.change(() => { for (const item of list) addPool(item, type); });
    });
  for (const [id, kind] of /** @type {const} */ ([['shortRest', 'short'], ['longRest', 'long']]))
    byId(id).addEventListener('click', () => {
      // Every resources box on the sheet: a rest is for the whole character.
      store.change(items => { takeRest(items, kind); });
    });
  function sync() {
    const none = !targets().length;
    byId('addSpellRow').disabled = none;
    byId('addExtraRow').disabled = none;
  }
  sync();
  return {sync};
}
