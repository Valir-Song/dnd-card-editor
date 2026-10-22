import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, MAX_SIDE } from '../src/editor/images.js';

test('pictures shrink to the long-side limit and keep their proportions', () => {
  assert.deepEqual(fitWithin(4000, 3000), {width: MAX_SIDE, height: 1200});
  assert.deepEqual(fitWithin(1000, 5000), {width: 320, height: MAX_SIDE});
});

test('small pictures are never enlarged', () => {
  assert.deepEqual(fitWithin(800, 600), {width: 800, height: 600});
  assert.deepEqual(fitWithin(1, 10000), {width: 1, height: MAX_SIDE});
});
