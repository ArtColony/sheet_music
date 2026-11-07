// The PostScript engraver (lib/sm_abc.ps, what `sheet` writes by default):
// the self-contained .ps (psEngineDoc: ABC parsed by PostScript, MusicXML
// as an embedded Score) must render lint-clean with the pinned pscat CLI,
// reproduce byte for byte, give exactly the same PDF in the WebAssembly
// build, match its golden hashes (tests/golden.json, key psEngine), and draw
// exactly the JS engraver's pages (src/layout.js, kept as the fallback).
//
// After an intended change to the output: node scripts/update-golden.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selfContainedPS, END_MARK } from '../src/psdoc.js';
import { toPostScript } from '../src/index.js';
import { psEngineDoc } from '../bin/sheet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engraveLib = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const abcLib = readFileSync(path.join(root, 'lib/sm_abc.ps'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const golden = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8'));
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const PLATFORM = `${process.platform}-${process.arch}`;
const PS_ENGINE_SAMPLES = readdirSync(path.join(root, 'samples')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort();
const pages = (pdf) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
// a bare document (engraver + layout, the JS Score embedded), and the default one
const doc = (src, extra = {}) => selfContainedPS(src, { engraveLib, abcLib, ...extra });
const full = (src) => psEngineDoc(src);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psengine-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('self-contained .ps: deterministic text, source verbatim after the driver', () => {
  for (const f of PS_ENGINE_SAMPLES) {
    const src = readFileSync(path.join(root, 'samples', f), 'utf8');
    const a = full(src), b = full(src);
    assert.equal(a.ps, b.ps);
    assert.ok(a.ps.includes(`(${END_MARK}) sm-abc-readsrc\n${src.replace(/\r\n?/g, '\n').trimEnd()}\n${END_MARK}\n`), `${f}: source is embedded verbatim`);
    assert.equal(sha(a.ps), golden.psEngine && golden.psEngine.ps[f], `${f}: PostScript changed; if intended run node scripts/update-golden.mjs`);
  }
});

test('the driver hands the embedded source to sm-abc-parse when it is defined', { skip: !existsSync(path.join(root, 'vendor/pscat-npm/node.js')) && 'pscat npm build not installed' }, async () => {
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  const src = readFileSync(path.join(root, 'samples/twinkle.abc'), 'utf8');
  // a stub parser: prints the text it was given, returns the JS Score
  const stub = '/sm-abc-parse { (<<) print print (>>) print sm-abc-score } def';
  const out = r.render(doc(src, { parseLib: stub }).ps, { width: 612, height: 792 }).output;
  assert.equal(out, `<<${src.trimEnd()}\n>>`);
});

test('PostScript engraver: CLI and WebAssembly agree, PDFs reproduce, goldens match', { skip: !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)' }, async () => {
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const f of PS_ENGINE_SAMPLES) {
    const { ps, size } = full(readFileSync(path.join(root, 'samples', f), 'utf8'));
    const psFile = path.join(tmp, f + '.ps');
    writeFileSync(psFile, ps);
    const page = `${Math.round(size[0])}x${Math.round(size[1])}`;
    const run = (out) => execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', out, psFile], { stdio: 'pipe' });
    run(path.join(tmp, f + '.1.pdf'));
    run(path.join(tmp, f + '.2.pdf'));
    const p1 = readFileSync(path.join(tmp, f + '.1.pdf'));
    assert.ok(p1.equals(readFileSync(path.join(tmp, f + '.2.pdf'))), `${f}: CLI PDF differs between runs`);
    r.render(ps, { width: size[0], height: size[1], pdf: true });
    const w = Buffer.from(r.pdf());
    assert.ok(pages(p1) >= 1, `${f}: no pages`);
    assert.equal(pages(w), pages(p1), `${f}: page count differs between CLI and WebAssembly`);
    assert.ok(w.equals(p1), `${f}: WebAssembly PDF differs from the CLI's`);
    const plat = golden.psEngine && golden.psEngine.pdf && golden.psEngine.pdf[PLATFORM];
    if (plat && plat[f]) assert.equal(sha(p1), plat[f], `${f}: PDF bytes changed on ${PLATFORM}`);
    else console.log(`ps-engine pdf ${PLATFORM} ${f} ${sha(p1)} (no golden for this platform)`);
  }
});

test('PostScript engraver: a long score breaks into the same pages as the JS engraver', { skip: !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)' }, async () => {
  // twinkle's three lines, twelve times over, with W: words after the tune
  const tw = readFileSync(path.join(root, 'samples/twinkle.abc'), 'utf8').trimEnd().split('\n');
  const k = tw.findIndex((l) => l.startsWith('K:'));
  const body = tw.slice(k + 1).join('\n').replace(/\|\]/g, '|');
  const src = [...tw.slice(0, k + 1), ...Array(12).fill(body), 'W:Words after the tune, on the last page.', ''].join('\n');
  const js = toPostScript(src, { lib: engraveLib });
  assert.ok(js.pages > 1, 'the test score should need several pages');
  const { ps, size } = full(src);
  const psFile = path.join(tmp, 'long.ps');
  writeFileSync(psFile, ps);
  const out = path.join(tmp, 'long.pdf');
  execFileSync(PSCAT, ['--lint-strict', '--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', out, psFile], { stdio: 'pipe' });
  const p1 = readFileSync(out);
  assert.equal(pages(p1), js.pages, 'page count differs from the JS engraver');
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  r.render(ps, { width: size[0], height: size[1], pdf: true });
  assert.ok(Buffer.from(r.pdf()).equals(p1), 'WebAssembly PDF differs from the CLI\'s');
});

test('PostScript engraver draws exactly the JS engraver\'s pages (every sample, 150 dpi)', { skip: !existsSync(path.join(root, 'vendor/pscat-npm/node.js')) && 'pscat npm build not installed' }, async () => {
  // Until src/layout.js is retired (#8), the two layouts must agree pixel for
  // pixel; the multi-page case is the test above.
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const f of PS_ENGINE_SAMPLES) {
    const src = readFileSync(path.join(root, 'samples', f), 'utf8');
    const js = toPostScript(src, { lib: engraveLib });
    const ps = full(src);
    assert.equal(js.pages, 1, `${f}: the comparison renders the first page only`);
    const a = r.render(js.ps, { width: js.size[0], height: js.size[1], dpi: 150 });
    const b = r.render(ps.ps, { width: ps.size[0], height: ps.size[1], dpi: 150 });
    assert.deepEqual([b.width, b.height], [a.width, a.height], `${f}: page size`);
    let n = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) n++;
    assert.equal(n, 0, `${f}: ${n} channel values differ between the JS and PostScript engravers`);
  }
});
