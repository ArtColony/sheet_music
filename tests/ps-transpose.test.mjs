// Transposition in PostScript (lib/sm_transpose.ps, issue #6) must give
// exactly what the retired src/transpose.js gave (frozen in
// tests/fixtures/reference/transpose.json): for every ABC sample (and the
// parse edge-case fixture, and two tunes made to reach the corners) at
// several intervals, sm-abc-parse-all + sm-score-transpose printed with
// sm-abc-json must hash to the JSON of parse + transposeScore. The helpers
// are checked on a grid, %%transpose against tuneTranspose, and the
// engraved pages against the PostScript engraving of the JS-transposed Score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psLiteral } from '../src/ps.js';
import { psEngineDoc, psMeta } from '../bin/sheet.mjs';
import { reference, refHash } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const PARSE = read('lib/sm_abc_parse.ps');
const TRANSPOSE = read('lib/sm_transpose.ps');
const ENGRAVE = read('lib/sm_engrave.ps');
const ABC = read('lib/sm_abc.ps');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-pstranspose-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const REF = reference('transpose');
const INTERVALS = REF.intervals;
// every ABC sample, the parse edge-case fixture, and:
// tests/fixtures/reference/transpose-corners.abc reaches what the samples do
// not: every accidental on every step (double ones need respelling at some
// intervals), key changes inline and in the body, two voices, grace notes,
// chord symbols with # b and the sharp/flat signs, slash chords, text that
// is not a chord, double spaces; tests/fixtures/reference/inline-key.abc has
// only an inline [K:] field: the score's initial key is the same object as
// that measure's key, which the JS then moved only once
const CORNERS = 'tests/fixtures/reference/transpose-corners.abc';
const sources = Object.keys(REF.scores).map((f) => [f, read(f)]);

// Write a program to a file and run it with --lint-strict (a file, not stdin:
// docs/FRICTION.md #11); returns stdout. A dot is painted so the lint sees ink.
let runs = 0;
function pscat(prog, args = []) {
  const file = path.join(tmp, `p${++runs}.ps`);
  writeFileSync(file, `${prog}\n0 0 1 1 rectfill showpage\n`);
  const out = execFileSync(PSCAT, ['--lint-strict', ...args, '--pdf', file.replace(/ps$/, 'pdf'), file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  return out.split('\n').filter((l) => !l.startsWith('pscat: ')).join('\n'); // its own report

}
const lines = (out) => out.split('\n').filter((l) => l.length).map((l) => JSON.parse(l));

for (const [name, src] of sources) {
  test(`${name}: sm-score-transpose equals transposeScore at ${INTERVALS.join(' ')}`, { skip }, () => {
    const prog = `${PARSE}\n${TRANSPOSE}\n/sm-t-src ${psLiteral(src)} def\n`
      + INTERVALS.map((k) => `sm-t-src sm-abc-parse-all dup { ${k} sm-score-transpose pop } forall sm-abc-json (\\n) print`).join('\n');
    const got = lines(pscat(prog));
    assert.equal(got.length, INTERVALS.length);
    INTERVALS.forEach((k, i) => assert.equal(refHash(got[i]), REF.scores[name][k], `${name} transposed ${k}`));
  });
}

test('0, null and a real: untouched, untouched, truncated', { skip }, () => {
  const src = read('samples/greensleeves.abc');
  const got = lines(pscat(`${PARSE}\n${TRANSPOSE}\n${[0, 'null', 2.7, -2.7].map((k) => `${psLiteral(src)} sm-abc-parse ${k} sm-score-transpose sm-abc-json (\\n) print`).join('\n')}`));
  assert.equal(got[0].transposed, undefined);
  assert.deepEqual(got[0], reference('abc-parse').scores['samples/greensleeves.abc'].scores[0]);
  assert.deepEqual(got[1], got[0]);
  // the JS gave greensleeves untouched, untouched, +2 and -2
  assert.deepEqual(got.map(refHash), REF.greensleeves.sha);
  assert.deepEqual(got.slice(2).map((g) => g.transposed.semis), [2, -2]);
});

test('fifths shift, pitch moves and chord symbols agree with the JS helpers on a grid', { skip }, () => {
  const semis = Array.from({ length: 25 }, (_, i) => i - 12);
  const fifths = Array.from({ length: 15 }, (_, i) => i - 7);
  const wantShift = REF.fifthsShift;
  const pitches = [];
  for (const step of 'CDEFGAB') for (const alter of [-2, -1, 0, 1, 2]) for (const s of semis) for (const f of [-7, 0, 7]) for (const respell of [true, false]) {
    pitches.push({ step, oct: 4, alter, s, df: wantShift[s + 12][f + 7], respell });
  }
  const chords = REF.chords.list;
  const dfs = Array.from({ length: 24 }, (_, i) => i - 12);
  const prog = `${PARSE}\n${TRANSPOSE}\n`
    + `[ ${semis.map((s) => `[ ${fifths.map((f) => `${s} ${f} sm-transpose-fifths-shift`).join(' ')} ]`).join(' ')} ] sm-abc-json (\\n) print\n`
    + `[ ${pitches.map((p) => `(${p.step}) ${p.oct} ${p.alter} ${p.s} ${p.df} ${p.respell} sm-transpose-pitch`).join('\n')} ] sm-abc-json (\\n) print\n`
    + `[ ${chords.map((c) => `[ ${dfs.map((d) => `${psLiteral(c)} ${d} sm-transpose-chord`).join(' ')} ]`).join('\n')} ] sm-abc-json (\\n) print`;
  const [gotShift, gotPitch, gotChord] = lines(pscat(prog));
  assert.deepEqual(gotShift, wantShift);
  assert.equal(gotPitch.length, REF.pitches.count);
  assert.equal(refHash(gotPitch), REF.pitches.sha, 'sm-transpose-pitch differs from movePitch');
  assert.equal(refHash(gotChord), REF.chords.sha, 'sm-transpose-chord differs from transposeChord');
  assert.equal(gotShift[2 + 12][0 + 7], 2); // C major up a tone: D
  assert.equal(gotShift[1 + 12][0 + 7], -5); // up a semitone: Db (5 flats), not C# (7 sharps)
  assert.equal(gotChord[0][2 + 12], 'Bm7');
  assert.equal(gotChord[9][2 + 12], 'A#m7/Eb'); // the signs come back as # and b
});

test('sm-abc-tune-transpose reads %%transpose like tuneTranspose', { skip }, () => {
  // the cases: the tune's line, else the file header's; 0 in the tune lets
  // the header's count; the first line that matches; CRLF and CR; not
  // mid-line; a MusicXML comment; no X: line; empty text
  const cases = REF.tuneTranspose;
  const [got] = lines(pscat(`${PARSE}\n[ ${cases.map((c) => `${psLiteral(c.src)} ${c.tune} sm-abc-tune-transpose`).join('\n')} ] sm-abc-json (\\n) print`));
  assert.deepEqual(got, cases.map((c) => c.semis));
  assert.ok(cases.filter((c) => c.semis !== 0).length >= 8);
  // and what sheet reports (sm-score-meta, the PDF's Subject) agrees
  const two = cases.find((c) => c.src.startsWith('%%transpose 5\n\nX:1') && c.src.includes('X:2')).src;
  assert.equal(psMeta(two, { tune: 1 }).transposed.semis, 3);
  assert.equal(psMeta(cases.find((c) => c.src.includes('%%transpose 0')).src).transposed.semis, 5);
});

test('every name sm_transpose.ps defines, temporaries included, starts with sm-', { skip }, () => {
  const prog = `/sm-t-before userdict length dict def userdict { pop sm-t-before exch true put } forall
${PARSE}
/sm-t-before2 userdict length dict def userdict { pop sm-t-before2 exch true put } forall
${TRANSPOSE}
${psLiteral(read(CORNERS))} sm-abc-parse 7 sm-score-transpose pop (Bb/D A#) 3 sm-transpose-chord pop
userdict { pop dup sm-t-before2 exch known { pop } { 64 string cvs print ( ) print } ifelse } forall
sm-tr-dict { pop 64 string cvs print ( ) print } forall (\\n) print`;
  const names = pscat(prog).trim().split(/\s+/);
  assert.ok(names.length > 30, `only ${names.length} names`);
  assert.deepEqual(names.filter((n) => !n.startsWith('sm-')), []);
});

// ---------------------------------------------------------------- engraving
// a minimal PNG reader for pscat's output (8-bit gray, RGB or RGBA) -> gray
function pngGray(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.equal(data[8], 8, 'bit depth'); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = new Uint8Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = bpp >= 3 ? Math.round((cur[x * bpp] + cur[x * bpp + 1] + cur[x * bpp + 2]) / 3) : cur[x * bpp];
    [prev, cur] = [cur, prev];
  }
  return { w, h, px: out };
}

test('headless: (samples/X.abc) << /transpose 2 >> sm-abc-engrave-file draws the transposed score', { skip }, () => {
  // straight from the file, the parser and lib/sm_transpose.ps loaded on
  // demand from lib/: the same page as sheet --engine ps --transpose 2
  const f = 'samples/greensleeves.abc';
  const one = path.join(tmp, 'headless.ps');
  writeFileSync(one, `(lib/sm_engrave.ps) run (lib/sm_abc.ps) run (${f}) << /transpose 2 >> sm-abc-engrave-file\n`);
  const page = '612x792';
  const gOne = pngOf(one, page);
  const gDoc = pngOf(writeDoc(read(f), { transpose: 2 }), page);
  const gPlain = pngOf(writeDoc(read(f), {}), page);
  assert.equal(diffCount(gOne, gDoc, 0), 0, 'the one-liner and the self-contained document differ');
  assert.ok(diffCount(gOne, gPlain, 64) > 1000, 'the page did not change');
});

// the self-contained --engine ps document, written to tmp
function writeDoc(src, opts) {
  const { ps } = psEngineDoc(src, opts);
  const file = path.join(tmp, `doc${++runs}.ps`);
  writeFileSync(file, ps);
  return file;
}
function pngOf(psFile, page, dpi = 100) {
  const out = psFile.replace(/\.ps$/, '.png');
  execFileSync(PSCAT, ['--lint-strict', '--dpi', String(dpi), '--page', page, '--png', out, psFile], { cwd: root, stdio: 'pipe' });
  return pngGray(readFileSync(out));
}
const diffCount = (a, b, tol) => {
  assert.deepEqual([a.w, a.h], [b.w, b.h], 'page size');
  let n = 0;
  for (let i = 0; i < a.px.length; i++) if (Math.abs(a.px[i] - b.px[i]) > tol) n++;
  return n;
};

test('--engine ps --transpose: exactly the PostScript engraving of the JS-transposed Score', { skip }, () => {
  for (const [f, k] of [['samples/feature-tour.abc', 2], ['samples/greensleeves.abc', -5], ['samples/mountain-king.abc', 6], ['samples/frere-jacques.musicxml', 7]]) {
    const src = read(f);
    // A: what sheet --engine ps --transpose k writes: PostScript parses and transposes
    const pa = path.join(tmp, `a${++runs}.pdf`);
    execFileSync(process.execPath, [path.join(root, 'bin/sheet.mjs'), f, '--engine', 'ps', '--transpose', String(k), '--no-source', '-o', pa], { cwd: root, stdio: 'pipe' });
    // B: the untransposed document, drawing the JS-transposed Score instead of parsing
    const score = REF.engraved[`${f} ${k}`];
    assert.equal(score.transposed.semis, k);
    const plain = psEngineDoc(src);
    const call = /^sm-abc-source sm-abc-options sm-(abc|musicxml)-engrave-string$/m;
    assert.match(plain.ps, call);
    const docB = path.join(tmp, `b${runs}.ps`);
    writeFileSync(docB, plain.ps.replace(call, `${psLiteral(score)} sm-abc-options sm-abc-engrave`));
    const page = `${Math.round(plain.size[0])}x${Math.round(plain.size[1])}`;
    const pb = docB.replace(/ps$/, 'pdf');
    execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', pb, docB], { stdio: 'pipe' });
    assert.ok(readFileSync(pa).equals(readFileSync(pb)), `${f} ${k}: PDF differs from the engraving of the JS-transposed Score`);
  }
});

test('%%transpose in the source and the option add up on the PostScript path; the result reports it', { skip }, async () => {
  const src = read('samples/twinkle.abc').replace(/^K:/m, '%%transpose -3\nK:');
  const r = psEngineDoc(src, { transpose: 5 });
  // -3 + 5: what the JS gave twinkle at +2
  assert.deepEqual(r.transposed, reference('meta').meta.find((m) => m.file === 'samples/twinkle.abc' && m.transpose === 2).meta.transposed);
  assert.equal(r.transposed.semis, 2);
  assert.deepEqual(r.warnings, []);
  // PS (parser + directive) and the retired fallback (the JS Score literal +
  // the total) give the same PDF; the directive line leaves the Score as twinkle's
  const twinkle = reference('abc-parse').scores['samples/twinkle.abc'].scores[0];
  assert.deepEqual(lines(pscat(`${PARSE}\n${psLiteral(src)} sm-abc-parse sm-abc-json (\\n) print`))[0], twinkle);
  const call = 'sm-abc-source sm-abc-options sm-abc-engrave-string\n';
  assert.ok(r.ps.includes(call));
  const page = '612x792';
  const run = (ps) => { const f = path.join(tmp, `d${++runs}.ps`); writeFileSync(f, ps); execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', f + '.pdf', f], { stdio: 'pipe' }); return readFileSync(f + '.pdf'); };
  const viaParser = run(r.ps);
  const viaLiteral = run(r.ps.replace(call, `${psLiteral(twinkle)} sm-abc-options dup length 1 add dict copy dup /transpose 2 put sm-abc-engrave\n`));
  const twinkleUp2 = run(psEngineDoc(read('samples/twinkle.abc'), { transpose: 2 }).ps);
  assert.ok(viaParser.equals(viaLiteral), 'parser path and literal path differ');
  assert.ok(viaParser.equals(twinkleUp2), '%%transpose -3 plus 5 is not +2');
  // the WebAssembly build (no file system: the libraries are all in the file) agrees
  if (existsSync(path.join(root, 'vendor/pscat-npm/node.js'))) {
    const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
    const w = await createRenderer();
    w.render(r.ps, { width: 612, height: 792, pdf: true });
    assert.ok(Buffer.from(w.pdf()).equals(viaParser), 'WebAssembly PDF differs from the CLI\'s');
  }
  // sm-abc-engrave-string leaves the caller's options dict alone
  const out = pscat(`${ENGRAVE}\n${ABC}\n${PARSE}\n${TRANSPOSE}\n/sm-t-o << /transpose 5 >> def ${psLiteral(src)} sm-t-o sm-abc-engrave-string sm-t-o sm-abc-json (\\n) print`);
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { transpose: 5 });
});

test('sheet --engine ps --transpose reports the transposition, with no warning', { skip }, () => {
  const out = path.join(tmp, 'rep.pdf');
  const r = spawnSync(process.execPath, [path.join(root, 'bin/sheet.mjs'), 'samples/twinkle.abc', '--engine', 'ps', '--transpose', '-2', '-o', out], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /transposed -2: key signature of Bb major\), PostScript engraver/);
  assert.doesNotMatch(r.stderr, /warning/);
  assert.match(readFileSync(out).toString('latin1'), /transposed -2 semitones/); // the PDF's Subject
});
