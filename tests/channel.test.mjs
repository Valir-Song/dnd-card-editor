import test from 'node:test';
import assert from 'node:assert/strict';
import { channelOf, CHANNEL, STORAGE_SUFFIX } from '../src/editor/channel.js';

const page = content => ({querySelector: selector => selector === 'meta[name="editor-channel"]' && content !== null ? {getAttribute: () => content} : null});

test('only a page marked beta is the beta; files and the main app keep the old storage names', () => {
  assert.equal(channelOf(page('beta')), 'beta');
  assert.equal(channelOf(page('stable')), 'stable');
  assert.equal(channelOf(page(null)), 'stable');
  assert.equal(channelOf(undefined), 'stable');
  // Node has no document: the stable names, as every version before 3.11 beta.14 used.
  assert.equal(CHANNEL, 'stable');
  assert.equal(STORAGE_SUFFIX, '');
});
