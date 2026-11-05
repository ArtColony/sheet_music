import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAnnotations, addAnnotation, removeAnnotation, toPostScript, annotationLine } from '../src/index.js';

const lib = readFileSync(new URL('../lib/sm_engrave.ps', import.meta.url), 'utf8');
const ABC = 'X:1\nT:One\nK:C\nCDEF|\n\nX:2\nT:Two\nK:G\nGABc|\n';

test('annotation lines round-trip', () => {
  const a = { page: 1, type: 'text', x: 100.04, y: 200, color: 'blue', text: 'say "ah"' };
  const [p] = parseAnnotations(annotationLine(a));
  assert.equal(p.text, 'say "ah"');
  assert.equal(p.x, 100);
  assert.deepEqual(p.rgb, [0.122, 0.373, 0.749]);
  const [c] = parseAnnotations(annotationLine({ page: 2, type: 'circle', x: 1, y: 2, w: 30, h: 20, color: '#00ff00' }));
  assert.deepEqual([c.page, c.type, c.w, c.h, c.rgb], [2, 'circle', 30, 20, [0, 1, 0]]);
});

test('added to the chosen tune, drawn only there, and removable', () => {
  const src = addAnnotation(ABC, { page: 1, type: 'highlight', x: 50, y: 600, w: 80, h: 30, color: 'yellow' }, { tune: 1 });
  const lines = src.split('\n');
  assert.match(lines[lines.indexOf('GABc|') + 1], /^%%annotation page=1 type=highlight/);
  const t1 = toPostScript(src, { lib, tune: 0 });
  const t2 = toPostScript(src, { lib, tune: 1 });
  assert.equal(t1.annotations.length, 0);
  assert.equal(t2.annotations.length, 1);
  assert.match(t2.ps, /%%Page: 1 1\n50 600 80 30 [\d.]+ [\d.]+ [\d.]+ sm-annot-highlight/); // under the music
  const back = removeAnnotation(src, t2.annotations[0].line, 1);
  assert.equal(back.trimEnd(), ABC.trimEnd());
});

test('MusicXML keeps annotations in comments', () => {
  const xml = readFileSync(new URL('../samples/frere-jacques.musicxml', import.meta.url), 'utf8');
  const src = addAnnotation(xml, { page: 1, type: 'text', x: 72, y: 72, color: 'red', text: 'round -- 4 voices' });
  assert.match(src, /<!-- %%annotation .* -->\n<\/score-partwise>/);
  const r = toPostScript(src, { lib });
  assert.deepEqual(r.warnings, []);
  assert.match(r.ps, /72 72 \(round - - 4 voices\) [\d.]+ [\d.]+ [\d.]+ sm-annot-text/);
});

test('an annotation on a missing page is a warning', () => {
  const r = toPostScript(ABC + '%%annotation page=3 type=text x=1 y=1 text="x"\n', { lib, tune: 1 });
  assert.ok(r.warnings.some((w) => /page 3/.test(w)));
});
