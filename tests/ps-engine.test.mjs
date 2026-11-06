// The PostScript engraver (lib/sm_abc.ps, `sheet --engine ps`): the
// self-contained .ps must render lint-clean with the pinned pscat CLI,
// reproduce byte for byte, give exactly the same PDF in the WebAssembly
// build, and match its golden hashes (tests/golden.json, key psEngine).
//
// After an intended change to the output: node scripts/update-golden.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selfContainedPS, END_MARK } from '../src/psdoc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engraveLib = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const abcLib = readFileSync(path.join(root, 'lib/sm_abc.ps'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const golden = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8'));
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const PLATFORM = `${process.platform}-${process.arch}`;
export const PS_ENGINE_SAMPLES = ['amazing-grace.abc', 'ode-to-joy.abc', 'twinkle.abc'];
const pages = (pdf) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
// the golden document never depends on whether lib/sm_abc_parse.ps exists yet
const doc = (src, extra = {}) => selfContainedPS(src, { engraveLib, abcLib, ...extra });

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psengine-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('self-contained .ps: deterministic text, source verbatim after the driver', () => {
  for (const f of PS_ENGINE_SAMPLES) {
    const src = readFileSync(path.join(root, 'samples', f), 'utf8');
    const a = doc(src), b = doc(src);
    assert.equal(a.ps, b.ps);
    assert.ok(a.ps.includes(`(${END_MARK}) sm-abc-readsrc\n${src.trimEnd()}\n${END_MARK}\n`), `${f}: source is embedded verbatim`);
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
    const { ps, size } = doc(readFileSync(path.join(root, 'samples', f), 'utf8'));
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
