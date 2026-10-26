// The «Персонаж» window (top bar button): the hero's numbers in one place, away
// from the sheet. Typing changes the layout through the store (one undo step per
// field, like text); the object that holds the stats appears on the first edit,
// so just opening the window changes nothing. In game mode the window is for
// reading only. Counting lives in character.js.
import { ABILITIES, SKILLS, findCharacter, characterOf, characterStats, newCharacter, setScore, setLevel,
  toggleSave, cycleSkill, setJack, setSpellAbility, setFixed, signed, readNumber, MAX_LEVEL, MAX_SCORE } from './character.js';
import { fillSheet, fillReport } from './fill-sheet.js';

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').Ability} Ability */
/** @typedef {import('./character.js').Value} Value */
/** @typedef {ReturnType<typeof characterStats>} Stats */

const RANKS = ['нет владения', 'владение', 'экспертиза'];

/**
 * @param {import('../types/layout').Deps & {dialog: HTMLDialogElement, button: HTMLElement, makeId: () => string}} deps
 */
export function setupCharacter({dialog, button, store, makeId}) {
  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  /** The field being typed in right now: a redraw during its own edit leaves it alone. @type {HTMLElement | null} */
  let typing = null;
  /** Everything to refresh after a change: each part reads the stats and updates itself. @type {Array<(stats: Stats, c: import('../types/layout').Character) => void>} */
  const parts = [];
  /** @type {Array<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>} */
  const controls = [];

  /**
   * One step of the layout: the stats object is made on the first edit.
   * @param {(item: Item) => void} change @param {HTMLElement | null} [field] typed field (edits merge like typing)
   */
  function edit(change, field = null) {
    if (isPlaying()) return;
    typing = field;
    try {
      store.change(items => {
        let item = findCharacter(items);
        if (!item) { item = newCharacter(makeId()); items.push(item); }
        change(item);
      }, field ? {group: 'character:' + (field.dataset.key || ''), windowMs: 650} : {});
    } finally { typing = null; }
  }
  const isPlaying = () => document.documentElement.dataset.play === 'on';

  /**
   * A counted number that can be typed over; ↺ gives the count back.
   * @param {string} key @param {(stats: Stats) => Value} read @param {boolean} sign
   */
  function numberField(key, read, sign) {
    const input = /** @type {HTMLInputElement} */ (el('input', 'char-value'));
    input.dataset.key = key; input.inputMode = 'numeric'; input.autocomplete = 'off';
    const reset = /** @type {HTMLButtonElement} */ (el('button', 'char-reset', '↺'));
    reset.type = 'button';
    const show = (/** @type {number | null} */ n) => sign ? signed(n) : n === null ? '—' : String(n);
    input.addEventListener('input', () => {
      const text = input.value.trim();
      const number = readNumber(text);
      if (text === '') edit(item => setFixed(item, key, null), input);
      else if (number !== null) edit(item => setFixed(item, key, number), input);
    });
    input.addEventListener('change', () => refresh());
    reset.addEventListener('click', () => edit(item => setFixed(item, key, null)));
    parts.push(stats => {
      const v = read(stats);
      if (input !== typing) input.value = show(v.value);
      input.classList.toggle('fixed', v.fixed);
      input.title = v.fixed ? 'Вписано вручную. Посчитано было бы: ' + show(v.auto) : 'Посчитано. Можно вписать своё число';
      reset.hidden = !v.fixed;
      reset.title = 'Вернуть подсчёт (' + show(v.auto) + ')';
    });
    controls.push(input, reset);
    const box = el('span', 'char-number');
    box.append(input, reset);
    return box;
  }

  /** @param {string} label @param {HTMLElement} control @param {string} [hint] */
  function cell(label, control, hint) {
    const node = el('label', 'char-cell');
    if (hint) node.title = hint;
    node.append(el('span', 'char-cell-name', label), control);
    return node;
  }

  // Ability scores: the modifier big, the score typed under it.
  const abilities = el('div', 'char-abilities');
  for (const ability of ABILITIES) {
    const box = el('label', 'char-ability');
    box.title = ability.name;
    const mod = el('span', 'char-mod');
    const score = /** @type {HTMLInputElement} */ (el('input', 'char-score'));
    score.type = 'number'; score.min = '1'; score.max = String(MAX_SCORE); score.dataset.key = 'score:' + ability.id;
    score.setAttribute('aria-label', ability.name);
    score.addEventListener('input', () => { if (score.value !== '') edit(item => setScore(item, ability.id, score.value), score); });
    score.addEventListener('change', () => refresh());
    parts.push((stats, c) => {
      mod.textContent = signed(stats.mods[ability.id]);
      if (score !== typing) score.value = String(c.scores[ability.id]);
    });
    controls.push(score);
    box.append(el('span', 'char-ab-name', ability.short), mod, score);
    abilities.append(box);
  }

  const level = /** @type {HTMLInputElement} */ (el('input', 'char-value char-level'));
  level.type = 'number'; level.min = '1'; level.max = String(MAX_LEVEL); level.dataset.key = 'level';
  level.addEventListener('input', () => { if (level.value !== '') edit(item => setLevel(item, level.value), level); });
  level.addEventListener('change', () => refresh());
  parts.push((_, c) => { if (level !== typing) level.value = String(c.level); });
  controls.push(level);

  const combat = el('div', 'char-combat');
  combat.append(
    cell('Уровень', level),
    cell('Бонус мастерства', numberField('prof', s => s.prof, true), 'По уровню: +2 на 1–4, +3 на 5–8, +4 на 9–12, +5 на 13–16, +6 на 17–20'),
    cell('КД', numberField('ac', s => s.ac, false), 'Класс доспеха. Посчитано без доспеха: 10 + ЛОВ. В доспехе впиши своё число'),
    cell('Инициатива', numberField('init', s => s.init, true), 'Модификатор ЛОВ'),
    cell('Скорость, фт.', numberField('speed', s => s.speed, false)),
    cell('Пассивная внимательность', numberField('passive', s => s.passive, false), '10 + навык Внимательность'),
  );

  const spellAbility = /** @type {HTMLSelectElement} */ (el('select', 'char-spell-ability'));
  spellAbility.append(new Option('нет', ''), ...ABILITIES.map(a => new Option(a.short, a.id)));
  spellAbility.addEventListener('change', () => edit(item => setSpellAbility(item, /** @type {Ability | ''} */ (spellAbility.value))));
  parts.push((_, c) => { spellAbility.value = c.spell; });
  controls.push(spellAbility);
  const magic = el('div', 'char-combat char-magic');
  magic.append(
    cell('Заклинательная характеристика', spellAbility, 'Барду, колдуну, паладину и чародею — ХАР; волшебнику — ИНТ; жрецу, друиду, следопыту — МДР'),
    cell('СЛ спасброска от заклинаний', numberField('dc', s => s.dc, false), '8 + бонус мастерства + модификатор заклинательной характеристики'),
    cell('Бонус атаки заклинанием', numberField('attack', s => s.attack, true), 'Бонус мастерства + модификатор заклинательной характеристики'),
  );

  /**
   * A save or skill row: the proficiency circle, the name, the number.
   * @param {string} name @param {string} small @param {string} key
   * @param {(stats: Stats) => Value & {rank: number}} read @param {() => void} toggle @param {number} ranks
   */
  function row(name, small, key, read, toggle, ranks) {
    const node = el('div', 'char-row');
    node.dataset.key = key;
    const rank = /** @type {HTMLButtonElement} */ (el('button', 'char-rank'));
    rank.type = 'button';
    rank.addEventListener('click', toggle);
    parts.push(stats => {
      const r = read(stats).rank;
      rank.dataset.rank = String(r);
      rank.setAttribute('aria-label', name + ': ' + RANKS[r]);
      rank.title = RANKS[r] + (ranks > 2 ? ' — щелчок: нет → владение → экспертиза' : ' — щелчок включает и выключает');
    });
    controls.push(rank);
    const label = el('span', 'char-name', name);
    if (small) label.append(' ', el('small', '', small));
    node.append(rank, label, numberField(key, read, true));
    return node;
  }

  const saves = el('section', 'char-list');
  saves.append(el('h3', '', 'Спасброски'));
  for (const ability of ABILITIES) {
    saves.append(row(ability.name, '', 'save:' + ability.id, s => s.saves[ability.id], () => edit(item => toggleSave(item, ability.id)), 2));
  }
  const jack = /** @type {HTMLInputElement} */ (el('input'));
  jack.type = 'checkbox';
  jack.addEventListener('change', () => edit(item => setJack(item, jack.checked)));
  parts.push((_, c) => { jack.checked = c.jack; });
  controls.push(jack);
  const jackLabel = el('label', 'char-jack');
  jackLabel.title = 'Умение барда со 2 уровня: половина бонуса мастерства (вниз) к навыкам без владения';
  jackLabel.append(jack, ' Мастер на все руки');
  saves.append(jackLabel);

  const skills = el('section', 'char-list char-skills');
  skills.append(el('h3', '', 'Навыки'));
  for (const skill of SKILLS) {
    const short = /** @type {{short: string}} */ (ABILITIES.find(a => a.id === skill.ability)).short;
    skills.append(row(skill.name, short, 'skill:' + skill.id, s => s.skills[skill.id], () => edit(item => cycleSkill(item, skill.id)), 3));
  }
  const lists = el('div', 'char-lists');
  lists.append(saves, skills);

  // «Вписать в лист»: the numbers go into the header and the spell texts (fill-sheet.js).
  const fill = el('div', 'char-fill');
  const fillButton = /** @type {HTMLButtonElement} */ (el('button', '', 'Вписать в лист'));
  fillButton.type = 'button'; fillButton.id = 'charFill';
  fillButton.title = 'Поставить эти числа в тексты листа: «КД», «Атака», «Инициатива», «Скорость» в шапке и «СЛ магии» / «Мудрость СЛ …» везде. Остальной текст не меняется';
  const fillResult = el('span', 'char-fill-result');
  fillResult.id = 'charFillResult';
  fillButton.addEventListener('click', () => {
    const item = findCharacter(store.items);
    if (!item || isPlaying()) return;
    const stats = characterStats(characterOf(item));
    let report = '';
    store.change(items => { report = fillReport(fillSheet(items, stats)); });
    fillResult.textContent = report;
  });
  parts.push(() => { fillButton.disabled = isPlaying() || !findCharacter(store.items); });
  fill.append(fillButton, fillResult);

  const head = el('div', 'help-head');
  const title = el('h2', '', 'Персонаж');
  title.id = 'characterTitle';
  const close = /** @type {HTMLButtonElement} */ (el('button', 'help-close', '✕'));
  close.type = 'button'; close.id = 'characterClose';
  close.setAttribute('aria-label', 'Закрыть окно персонажа'); close.title = 'Закрыть (Esc)';
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);
  const hint = el('p', 'char-hint');
  const body = el('div', 'char-body');
  body.append(abilities, combat, magic, fill, lists);
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.replaceChildren(head, hint, body);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  function refresh() {
    const item = findCharacter(store.items);
    const c = characterOf(item || {});
    const stats = characterStats(c);
    for (const part of parts) part(stats, c);
    const playing = isPlaying();
    dialog.classList.toggle('char-readonly', playing);
    for (const control of controls) {
      if (control instanceof HTMLInputElement && control.type !== 'checkbox') control.readOnly = playing;
      else control.disabled = playing;
    }
    hint.textContent = playing
      ? 'Режим игры: здесь только посмотреть. Поменять числа — «К правке».'
      : 'Впиши значения характеристик и уровень, отметь кружками владение (два щелчка — экспертиза). Остальное посчитается само; любое число можно вписать вручную, ↺ вернёт подсчёт.';
  }

  button.addEventListener('click', () => {
    if (dialog.open) return;
    fillResult.textContent = '';
    refresh();
    dialog.showModal();
  });
  // After every draw (an edit here, undo, another layout opened) the window shows the data.
  return {sync: () => { if (dialog.open) refresh(); }};
}
