import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, stepZoom, wheelZoom, fitWidthZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEPS } from '../src/editor/zoom.js';

test('zoom stays a whole percent within 50–200; garbage is 100', () => {
  assert.equal(clampZoom(120.4), 120);
  assert.equal(clampZoom(10), ZOOM_MIN);
  assert.equal(clampZoom('500'), ZOOM_MAX);
  for (const bad of [null, 'abc', NaN, -3, 0, Infinity]) assert.equal(clampZoom(bad), 100, String(bad));
});

test('buttons walk the steps, from a step or from between steps', () => {
  assert.equal(stepZoom(100, 1), 110);
  assert.equal(stepZoom(100, -1), 90);
  assert.equal(stepZoom(124, 1), 125);
  assert.equal(stepZoom(124, -1), 110);
  assert.equal(stepZoom(200, 1), 200);
  assert.equal(stepZoom(50, -1), 50);
  let zoom = ZOOM_MIN, seen = [zoom];
  while (zoom < ZOOM_MAX) seen.push(zoom = stepZoom(zoom, 1));
  assert.deepEqual(seen, ZOOM_STEPS);
});

test('Ctrl+wheel: down shrinks, up grows, one notch is a moderate step, limits hold', () => {
  assert.ok(wheelZoom(100, 100) < 100 && wheelZoom(100, 100) >= 80);
  assert.ok(wheelZoom(100, -100) > 100 && wheelZoom(100, -100) <= 125);
  assert.equal(wheelZoom(100, 100000), wheelZoom(100, 100), 'a huge delta is one notch');
  assert.equal(wheelZoom(200, -100), 200);
  assert.equal(wheelZoom(50, 100), 50);
  assert.ok(Math.abs(wheelZoom(100, 4) - 100) <= 1, 'touchpad pinch moves a little');
});

test('«по ширине»: a page with the side padding fills the window', () => {
  const page = 210 / 25.4 * 96;
  assert.equal(fitWidthZoom(page + 48), 100);
  assert.equal(fitWidthZoom(1280), 152);
  assert.equal(fitWidthZoom(400), 50);
  assert.equal(fitWidthZoom(5000), 200);
});
