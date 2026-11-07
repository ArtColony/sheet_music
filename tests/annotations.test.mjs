import { test } from 'node:test';
import assert from 'node:assert/strict';
// Reader's annotations: the editor writes %%annotation lines into the source
// (src/index.js), PostScript reads them back (sm-score-meta, through psMeta)
// and draws them.
import { readFileSync, existsSync } from 'node:fs';
import { addAnnotation, removeAnnotation, annotationLine } from '../src/index.js';
import { psEngineDoc, psMeta } from '../bin/sheet.mjs';
import { noPscat as skip } from './pscat-run.mjs';

const WASM = new URL('../vendor/pscat-npm/node.js', import.meta.url);
// the options literal selfContainedPS hands sm-abc-engrave
const optionsOf = (ps) => /^\/sm-abc-options (.*) def$/m.exec(ps)[1];
const ABC = 'X:1\nT:One\nK:C\nCDEF|\n\nX:2\nT:Two\nK:G\nGABc|\n';

// the marks PostScript reads from tune `tune` of a source
const marks = (src, tune = 0) => psMeta(src, { tune }).annotations;

test('annotation lines round-trip', { skip }, () => {
  const a = { page: 1, type: 'text', x: 100.04, y: 200, color: 'blue', text: 'say "ah"' };
  const c0 = { page: 2, type: 'circle', x: 1, y: 2, w: 30, h: 20, color: '#00ff00' };
  const [p, c] = marks(`X:1\nT:t\nK:C\nC|\n${annotationLine(a)}\n${annotationLine(c0)}\n`);
  assert.equal(p.text, 'say "ah"');
  assert.equal(p.x, 100);
  assert.deepEqual(p.rgb, [0.12, 0.37, 0.75]); // #1f5fbf, to two decimals
  assert.equal(p.line, 4);
  assert.deepEqual([c.page, c.type, c.w, c.h, c.rgb, c.color], [2, 'circle', 30, 20, [0, 1, 0], '#00ff00']);
});

test('added to the chosen tune, drawn only there, and removable', { skip }, () => {
  const src = addAnnotation(ABC, { page: 1, type: 'highlight', x: 50, y: 600, w: 80, h: 30, color: 'yellow' }, { tune: 1 });
  const lines = src.split('\n');
  assert.match(lines[lines.indexOf('GABc|') + 1], /^%%annotation page=1 type=highlight/);
  assert.equal(marks(src, 0).length, 0);
  assert.equal(marks(src, 1).length, 1);
  // the PostScript engraver is handed the mark for tune 2 only
  assert.doesNotMatch(optionsOf(psEngineDoc(src, { tune: 0 }).ps), /annotations/);
  assert.match(optionsOf(psEngineDoc(src, { tune: 1 }).ps), /\/annotations \[<< \/h 30 \/page 1 \/rgb \[[\d.]+ [\d.]+ [\d.]+\] \/text \(\) \/type \(highlight\) \/w 80 \/x 50 \/y 600 >>\]/);
  const back = removeAnnotation(src, marks(src, 1)[0].line, 1);
  assert.equal(back.trimEnd(), ABC.trimEnd());
});

test('MusicXML keeps annotations in comments', { skip }, () => {
  const xml = readFileSync(new URL('../samples/frere-jacques.musicxml', import.meta.url), 'utf8');
  const src = addAnnotation(xml, { page: 1, type: 'text', x: 72, y: 72, color: 'red', text: 'round -- 4 voices' });
  assert.match(src, /<!-- %%annotation .* -->\n<\/score-partwise>/);
  const r = psEngineDoc(src);
  assert.deepEqual(r.warnings, []);
  assert.match(optionsOf(r.ps), /\/annotations \[<< .*\/text \(round - - 4 voices\) \/type \(text\) .*\/x 72 \/y 72 >>\]/);
});

test('a highlight is drawn under the music', { skip: skip || (!existsSync(WASM) && 'pscat npm build not installed (npm run pscat:fetch)') }, async () => {
  // a pale box over the whole first system of tune 2: the staff lines and
  // notes still show through it as dark ink
  const src = addAnnotation(ABC, { page: 1, type: 'highlight', x: 40, y: 560, w: 530, h: 200, color: 'yellow' }, { tune: 1 });
  const { createRenderer } = await import(WASM);
  const r = await createRenderer();
  const page = (s) => r.render(psEngineDoc(s, { tune: 1 }).ps, { width: 612, height: 792, dpi: 36 });
  const a = page(src), b = page(ABC);
  const ch = a.data.length / (a.width * a.height);
  assert.ok(ch >= 3, 'RGB(A) pixels');
  // pixels (36 dpi: 2 points each, y down) inside the box where test holds
  const box = (img, test, also = () => true) => {
    let n = 0;
    for (let y = Math.ceil((792 - 760) / 2); y < Math.floor((792 - 560) / 2); y++) for (let x = Math.ceil(40 / 2); x < Math.floor(570 / 2); x++) {
      const i = (y * img.width + x) * ch;
      if (test(img.data[i], img.data[i + 1], img.data[i + 2]) && also(i)) n++;
    }
    return n;
  };
  const pale = (R, G, B) => R > 230 && G > 215 && B < 215 && R - B > 40; // yellow at 28%: about 246 233 184
  const dark = (R, G, B) => R < 90 && G < 90 && B < 90;
  assert.equal(box(b, pale), 0, 'no highlight without the mark');
  assert.ok(box(a, pale) > 1000, 'the highlight is drawn');
  assert.ok(box(b, dark) > 20, 'there is music in the box');
  // every dark pixel of the plain page is still dark under the highlight
  assert.equal(box(b, dark, (i) => !dark(a.data[i], a.data[i + 1], a.data[i + 2])), 0, 'the highlight covers the music');
});
