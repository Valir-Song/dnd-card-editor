import test from 'node:test';
import assert from 'node:assert/strict';
import { playVerdict, PRESS_EVENTS, PLAY_KEY } from '../src/editor/play.js';

test('game mode blocks every press that is not on a box or 📖', () => {
  for (const type of PRESS_EVENTS) assert.equal(playVerdict(type, false), 'block', type);
});

test('a box still gets its click, but the window under it is not selected or dragged', () => {
  assert.equal(playVerdict('click', true), 'pass');
  for (const type of ['pointerdown', 'mousedown', 'dblclick']) assert.equal(playVerdict(type, true), 'stop', type);
});

test('touchstart stays free so a finger still scrolls the sheet', () => {
  assert.ok(!(/** @type {readonly string[]} */ (PRESS_EVENTS)).includes('touchstart'));
});

test('the mode is remembered under its own key, apart from the beta', () => {
  assert.equal(PLAY_KEY, 'dnd-card-editor-play');
});
