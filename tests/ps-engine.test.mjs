// The PostScript engraver (lib/sm_abc.ps, what `sheet` writes): for every
// sample and test fixture the self-contained .ps (psEngineDoc: ABC and
// MusicXML parsed by PostScript) must be deterministic, render lint-clean
// with the pinned pscat CLI (the samples with no warnings), reproduce byte
// for byte, give exactly the same PDF in the WebAssembly build, and match its
// golden hashes (tests/golden.json, key psEngine). The goldens were first
// recorded when these pages were pixel-identical to the retired JavaScript
// layout's (src/layout.js, #10).
//
// After an intended change to the output: node scripts/update-golden.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selfContainedPS, END_MARK } from '../src/psdoc.js';
import { psEngineDoc, psWarnings } from '../bin/sheet.mjs';
import { GOLDEN_FILES } from '../scripts/golden-files.mjs';
import { psLiteral } from '../src/ps.js';
import { reference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engraveLib = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const abcLib = readFileSync(path.join(root, 'lib/sm_abc.ps'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const golden = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8'));
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const PLATFORM = `${process.platform}-${process.arch}`;
const pages = (pdf) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const full = (src) => psEngineDoc(src);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psengine-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('every sample and fixture has a golden hash, on every platform recorded', () => {
  const keys = GOLDEN_FILES.map((g) => g.key).sort();
  assert.ok(keys.some((k) => k.startsWith('fixtures/')), 'the fixtures are in the list');
  assert.deepEqual(Object.keys(golden.psEngine.ps).sort(), keys);
  for (const [plat, h] of Object.entries(golden.psEngine.pdf)) assert.deepEqual(Object.keys(h).sort(), keys, `PDF goldens for ${plat}`);
});

test('self-contained .ps: deterministic text, source verbatim after the driver', () => {
  for (const { key: f, file } of GOLDEN_FILES) {
    const src = readFileSync(file, 'utf8');
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
  // a stub parser: prints the text it was given, returns the JS parser's Score
  const score = reference('abc-parse').scores['samples/twinkle.abc'].scores[0];
  const meta = reference('meta').meta.find((m) => m.file === 'samples/twinkle.abc' && m.transpose === 0).meta;
  const stub = `/sm-abc-parse { (<<) print print (>>) print ${psLiteral(score)} } def`;
  const out = r.render(selfContainedPS(src, { engraveLib, abcLib, parseLib: stub, meta }).ps, { width: 612, height: 792 }).output;
  assert.equal(out, `<<${src.trimEnd()}\n>>`);
});

test('PostScript engraver: CLI and WebAssembly agree, PDFs reproduce, goldens match', { skip: !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)' }, async () => {
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const { key: f, file, sample } of GOLDEN_FILES) {
    const { ps, size, warnings } = full(readFileSync(file, 'utf8'));
    const base = path.join(tmp, f.replace(/\//g, '_'));
    const psFile = base + '.ps';
    writeFileSync(psFile, ps);
    const page = `${Math.round(size[0])}x${Math.round(size[1])}`;
    const run = (out) => execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', out, psFile], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const printed = run(base + '.1.pdf');
    run(base + '.2.pdf');
    // the samples engrave with no warning: none printed by the PostScript
    // parser and engraver, none in the metadata (sm-score-meta)
    if (sample) assert.deepEqual([...psWarnings(printed), ...warnings], [], `${f}: warnings`);
    const p1 = readFileSync(base + '.1.pdf');
    assert.ok(p1.equals(readFileSync(base + '.2.pdf')), `${f}: CLI PDF differs between runs`);
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

test('PostScript engraver: a long score breaks into the same five pages', { skip: !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)' }, async () => {
  // twinkle's three lines, twelve times over, with W: words after the tune
  const tw = readFileSync(path.join(root, 'samples/twinkle.abc'), 'utf8').trimEnd().split('\n');
  const k = tw.findIndex((l) => l.startsWith('K:'));
  const body = tw.slice(k + 1).join('\n').replace(/\|\]/g, '|');
  const src = [...tw.slice(0, k + 1), ...Array(12).fill(body), 'W:Words after the tune, on the last page.', ''].join('\n');
  const { ps, size } = full(src);
  const psFile = path.join(tmp, 'long.ps');
  writeFileSync(psFile, ps);
  const out = path.join(tmp, 'long.pdf');
  execFileSync(PSCAT, ['--lint-strict', '--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', out, psFile], { stdio: 'pipe' });
  const p1 = readFileSync(out);
  // 5: what the JavaScript layout gave for this score when it was retired (#10)
  assert.equal(pages(p1), 5, 'page count changed');
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  r.render(ps, { width: size[0], height: size[1], pdf: true });
  assert.ok(Buffer.from(r.pdf()).equals(p1), 'WebAssembly PDF differs from the CLI\'s');
});

test('sheet --engine js / js-wasm: a clear error, now that the JavaScript layout is gone', () => {
  for (const engine of ['js', 'js-wasm']) {
    const r = spawnSync(process.execPath, [path.join(root, 'bin/sheet.mjs'), 'samples/twinkle.abc', '--engine', engine, '-o', path.join(tmp, `gone-${engine}.pdf`)], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`--engine ${engine} is gone: the JavaScript layout \\(src/layout\\.js\\) was retired.*use --engine ps or ps-wasm`));
    assert.ok(!existsSync(path.join(tmp, `gone-${engine}.pdf`)));
  }
});
