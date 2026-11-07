// The score metadata PostScript prints (lib/sm_abc_parse.ps sm-score-meta,
// run through src/psdoc.js metaPS) must be what the retired JS parser gave
// (src/index.js scoreMeta, frozen in tests/fixtures/reference/meta.json):
// title, composer, the key after transposition, the tunes, the annotations
// and the warnings, for every sample and fixture, every tune, transposed
// 0 / +2 / -5. It is what `sheet` and the editor put in the document header
// and the PDF's metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metaPS, readMeta, selfContainedPS } from '../src/psdoc.js';
import { psLiteral } from '../src/ps.js';
import { reference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const LIBS = { abcLib: read('lib/sm_abc.ps'), parseLib: read('lib/sm_abc_parse.ps'), transposeLib: read('lib/sm_transpose.ps'), musicxmlLib: read('lib/sm_musicxml.ps') };
const NPM = path.join(root, 'vendor/pscat-npm/node.js');
const skip = !existsSync(NPM) && 'pscat npm build not installed (npm run pscat:fetch)';
const REF = reference('meta');
// the files the JS reference was frozen for (a sample added since is covered by
// the goldens and the explicit-value tests, not here); each must still exist
const files = [...new Set(REF.meta.map((r) => r.file))];
// numbers as the document writes them (psLiteral: two decimals): PostScript
// rounds annotation positions and colours to that already
const norm = (m) => JSON.parse(JSON.stringify(m, (k, v) => (typeof v === 'number' ? Number(psLiteral(v)) : v)));

let renderer = null;
const psMeta = async (src, opts) => {
  if (!renderer) renderer = await (await import(NPM)).createRenderer();
  return readMeta(renderer.render(metaPS(src, { ...LIBS, ...opts }), { width: 8, height: 8 }).output);
};

test('the frozen files are all still there', () => {
  assert.equal(files.length, 11);
  for (const f of files) assert.ok(existsSync(path.join(root, f)), f);
});

test('sm-score-meta equals the JS parser\'s metadata: every sample and fixture, every tune, transposed 0/+2/-5', { skip }, async () => {
  for (const f of files) {
    const want = REF.meta.filter((r) => r.file === f);
    assert.equal(want.length, 3 * want[0].meta.tunes.length, `${f}: every tune at three transpositions`);
    const got = await psMeta(read(f), {});
    assert.equal(got.tunes.length, want[0].meta.tunes.length, `${f}: number of tunes`);
  }
  for (const { file, tune, transpose, meta } of REF.meta) {
    const got = await psMeta(read(file), { tune, transpose });
    assert.deepEqual(norm(got), norm(meta), `${file} tune ${tune} transpose ${transpose}`);
  }
  assert.ok(REF.meta.length >= 3 * (files.length + 2), 'every tune of the multi-tune fixture is covered');
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
  assert.equal(REF.errors.length, 4);
  for (const { file, src: text, options, meta: want } of REF.errors) {
    const src = file ? read(file) : text;
    const got = await psMeta(src, options);
    assert.ok(want.error, 'the JS parser failed too');
    assert.deepEqual(norm(got), norm(want));
    assert.throws(() => selfContainedPS(src, { engraveLib: '%', abcLib: '%', parseLib: '%', musicxmlLib: '%', meta: got }), { message: want.error });
  }
});

test('selfContainedPS needs the metadata unless it performs', () => {
  const src = read('samples/twinkle.abc');
  const base = { engraveLib: '%', abcLib: '%', parseLib: '%' };
  assert.throws(() => selfContainedPS(src, base), /options\.meta/);
  assert.ok(selfContainedPS(src, { ...base, perform: true, performLib: '%' }).ps.includes('sm-abc-performance'));
  const meta = REF.meta.find((r) => r.file === 'samples/twinkle.abc' && r.transpose === 2).meta;
  const r = selfContainedPS(src, { ...base, meta, transpose: 2 });
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
  const doc = (extra) => selfContainedPS(src, { engraveLib: read('lib/sm_engrave.ps'), ...LIBS, meta, ...extra });
  const warnings = (d) => renderer.render(d.ps, { width: d.size[0], height: d.size[1] }).output.split('\n').filter((l) => l.startsWith('sm-abc: warning: '));
  assert.deepEqual(warnings(doc()), ['sm-abc: warning: annotation on page 3, but the score has 1']);
  // page 2 of a five-page score is there
  const long = read('samples/twinkle.abc').trimEnd().split('\n');
  const k = long.findIndex((l) => l.startsWith('K:'));
  const body = long.slice(k + 1).join('\n').replace(/\|\]/g, '|');
  const src2 = [...long.slice(0, k + 1), ...Array(12).fill(body), '%%annotation page=2 type=text x=10 y=10 text="p2"', '%%annotation page=9 type=text x=10 y=10 text="p9"', ''].join('\n');
  const d2 = selfContainedPS(src2, { engraveLib: read('lib/sm_engrave.ps'), ...LIBS, meta: await psMeta(src2, {}) });
  assert.deepEqual(warnings(d2), ['sm-abc: warning: annotation on page 9, but the score has 5']);
});
