import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const verify = readFileSync('.github/workflows/verify.yml','utf8');
const publish = readFileSync('.github/workflows/publish.yml','utf8');

// Guards for the lessons of ROADMAP 1.7: each of these once turned CI red while the editor was fine.
test('visual reference is the first parent, not the live main',()=>{
  // Several merges in a row move main during a run: fetching it then fails (not a fast-forward)
  // or compares an older merge against a newer look.
  assert.match(verify,/fetch-depth: 2/);
  const visual=verify.split('\n').filter(line=>line.includes('visual_browser_smoke.py'));
  assert.ok(visual.length>=2,'visual steps for both browsers');
  for(const line of visual) assert.match(line,/VISUAL_REF=HEAD\^1 /,line);
  for(const file of [verify,publish,readFileSync('tests/visual_browser_smoke.py','utf8')])
    for(const fetch of file.match(/git['", ]+fetch.*/g)||[])
      assert.match(fetch,/['" ]\+main:/,'a fetch of main must be forced: '+fetch);
});
test('the test job has a time limit and a pinned Ubuntu',()=>{
  assert.match(verify,/timeout-minutes: \d+/);
  // ubuntu-latest became 26.04, where Playwright 1.56 installs no browsers.
  assert.match(verify,/runs-on: ubuntu-\d\d\.\d\d/);
});
test('workflow actions run on a supported Node',()=>{
  // checkout/setup-node v4, setup-python v5 and upload-artifact v4 are Node 20 actions (deprecated on runners).
  const old=/actions\/(checkout|setup-node|upload-artifact)@v[1-4]\b|actions\/setup-python@v[1-5]\b/;
  assert.doesNotMatch(verify,old);
  assert.doesNotMatch(publish,old);
});
