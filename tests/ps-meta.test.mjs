// The score metadata PostScript prints (lib/sm_abc_parse.ps sm-score-meta,
// run through src/psdoc.js metaPS) must be what the JS parser gives
// (src/index.js scoreMeta): title, composer, the key after transposition,
// the tunes, the annotations and the warnings, for every sample and fixture,
// every tune, transposed 0 / +2 / -5. It is what `sheet` and the editor put in
// the document header and the PDF's metadata, so they need no JS parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMeta } from '../src/index.js';
import { metaPS, readMeta, selfContainedPS } from '../src/psdoc.js';
import { psLiteral } from '../src/ps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const LIBS = { abcLib: read('lib/sm_abc.ps'), parseLib: read('lib/sm_abc_parse.ps'), transposeLib: read('lib/sm_transpose.ps'), musicxmlLib: read('lib/sm_musicxml.ps') };
const NPM = path.join(root, 'vendor/pscat-npm/node.js');
const skip = !existsSync(NPM) && 'pscat npm build not installed (npm run pscat:fetch)';
const files = [
  ...readdirSync(path.join(root, 'samples')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort().map((f) => `samples/${f}`),
  ...readdirSync(path.join(root, 'tests/fixtures')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort().map((f) => `tests/fixtures/${f}`),
];
// numbers as the document writes them (psLiteral: two decimals): PostScript
// rounds annotation positions and colours to that already
const norm = (m) => JSON.parse(JSON.stringify(m, (k, v) => (typeof v === 'number' ? Number(psLiteral(v)) : v)));

let renderer = null;
const psMeta = async (src, opts) => {
  if (!renderer) renderer = await (await import(NPM)).createRenderer();
  return readMeta(renderer.render(metaPS(src, { ...LIBS, ...opts }), { width: 8, height: 8 }).output);
};

test('sm-score-meta equals the JS parser\'s metadata: every sample and fixture, every tune, transposed 0/+2/-5', { skip }, async () => {
  let n = 0;
  for (const f of files) {
    const src = read(f);
    const tunes = scoreMeta(src).tunes.length;
    for (let tune = 0; tune < tunes; tune++) {
      for (const transpose of [0, 2, -5]) {
        const want = scoreMeta(src, { tune, transpose });
        const got = await psMeta(src, { tune, transpose });
        assert.deepEqual(norm(got), norm(want), `${f} tune ${tune} transpose ${transpose}`);
        n++;
      }
    }
  }
  assert.ok(n >= 3 * (files.length + 2), 'every tune of the multi-tune fixture is covered');
});

test('sm-score-meta: the multi-tune fixture lists its tunes, annotations carry line and colour', { skip }, async () => {
  const src = read('tests/fixtures/parse-edge.abc');
  const m = await psMeta(src, { tune: 1 });
  assert.deepEqual(m.tunes.map((t) => [t.index, t.x]), [[0, '1'], [1, '2'], [2, '3']]);
  assert.equal(m.tunes[0].title, 'Café über & ß tra\\c cade ø', 'UTF-8 survives the wasm output');
  assert.ok(m.annotations.length > 0);
  for (const a of m.annotations) assert.ok(Number.isInteger(a.line) && typeof a.color === 'string');
  const xml = await psMeta(read('samples/frere-jacques.musicxml'), { transpose: 2 });
  assert.equal(xml.title, 'Frère Jacques');
  assert.deepEqual(xml.transposed, { key: 'D', semis: 2 });
});

test('sm-score-meta errors: no such tune, MusicXML that does not parse', { skip }, async () => {
  const twinkle = read('samples/twinkle.abc');
  for (const [src, opts] of [[twinkle, { tune: 3 }], ['<?xml version="1.0"?>\n<score-partwise><part-list></score-partwise>', {}], ['<?xml version="1.0"?>\n<opus/>', {}], ['<score-timewise/>', {}]]) {
    const want = scoreMeta(src, opts), got = await psMeta(src, opts);
    assert.ok(want.error, 'the JS parser fails too');
    assert.deepEqual(norm(got), norm(want));
    assert.throws(() => selfContainedPS(src, { engraveLib: '%', abcLib: '%', embedScore: false, meta: got }), { message: want.error });
  }
});

test('selfContainedPS needs the metadata unless it embeds the JS Score or performs', () => {
  const src = read('samples/twinkle.abc');
  const base = { engraveLib: '%', abcLib: '%', parseLib: '%' };
  assert.throws(() => selfContainedPS(src, { ...base, embedScore: false }), /options\.meta/);
  const r = selfContainedPS(src, { ...base, embedScore: false, meta: scoreMeta(src, { transpose: 2 }), transpose: 2 });
  assert.equal(r.title, 'Twinkle, Twinkle, Little Star');
  assert.deepEqual(r.transposed, { key: 'D', semis: 2 });
  assert.ok(r.ps.includes('%%Title: Twinkle, Twinkle, Little Star\n'));
});

test('readMeta skips pscat\'s own lines (pscat#1058) and says when nothing was printed', () => {
  assert.deepEqual(readMeta('{"a":1}\npscat: wrote /tmp/x.pdf\n'), { a: 1 });
  assert.throws(() => readMeta('sm-abc: error: oops\n'), /no score metadata: sm-abc: error: oops/);
});

test('an annotation on a page the score does not have is a warning when it engraves', { skip }, async () => {
  const src = read('samples/twinkle.abc').trimEnd() + '\n%%annotation page=3 type=text x=10 y=10 text="far"\n%%annotation page=1 type=text x=10 y=10 text="near"\n';
  const meta = await psMeta(src, {});
  assert.deepEqual(meta.annotations.map((a) => a.page), [3, 1]);
  const doc = (extra) => selfContainedPS(src, { engraveLib: read('lib/sm_engrave.ps'), ...LIBS, embedScore: false, meta, ...extra });
  const warnings = (d) => renderer.render(d.ps, { width: d.size[0], height: d.size[1] }).output.split('\n').filter((l) => l.startsWith('sm-abc: warning: '));
  assert.deepEqual(warnings(doc()), ['sm-abc: warning: annotation on page 3, but the score has 1']);
  // page 2 of a five-page score is there
  const long = read('samples/twinkle.abc').trimEnd().split('\n');
  const k = long.findIndex((l) => l.startsWith('K:'));
  const body = long.slice(k + 1).join('\n').replace(/\|\]/g, '|');
  const src2 = [...long.slice(0, k + 1), ...Array(12).fill(body), '%%annotation page=2 type=text x=10 y=10 text="p2"', '%%annotation page=9 type=text x=10 y=10 text="p9"', ''].join('\n');
  const d2 = selfContainedPS(src2, { engraveLib: read('lib/sm_engrave.ps'), ...LIBS, embedScore: false, meta: await psMeta(src2, {}) });
  assert.deepEqual(warnings(d2), ['sm-abc: warning: annotation on page 9, but the score has 5']);
});
