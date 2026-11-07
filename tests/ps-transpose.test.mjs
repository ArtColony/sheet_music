// Transposition in PostScript (lib/sm_transpose.ps, issue #6) must give
// exactly what src/transpose.js gives: for every ABC sample (and the parse
// edge-case fixture, and a tune made to reach the corners) at several
// intervals, sm-abc-parse-all + sm-score-transpose printed with sm-abc-json
// deep-equals JSON of parse + transposeScore. The helpers are checked on a
// grid against the exported JS ones, %%transpose against tuneTranspose, and
// the engraved pages against the PostScript engraving of the JS-transposed
// Score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, tuneTranspose, transposeScore, fifthsShift, transposeChord } from '../src/index.js';
import { movePitch } from '../src/transpose.js';
import { splitTunes } from '../src/abc.js';
import { selfContainedPS } from '../src/psdoc.js';
import { psLiteral } from '../src/ps.js';

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

const INTERVALS = [-12, -5, -2, 1, 2, 6, 7, 11];

// a tune that reaches what the samples do not: every accidental on every
// step (double ones need respelling at some intervals), key changes inline
// and in the body, two voices, grace notes, chord symbols with # b and the
// sharp/flat signs, slash chords, text that is not a chord, double spaces
const CORNERS = `X:1
T:Corners
M:4/4
L:1/8
V:1
V:2 clef=bass
K:F#
[V:1] "F#m7/C#"^^C ^C =C _C __C "Bb/D"^^D ^D =D | "N.C."_D __D ^^E ^E "E\u266dm7/B\u266f"=E _E __E ^^F |
[V:2] "C/G7"^F, =F, _F, __F, "Am  D7"^^G, ^G, =G, _G, | __G, ^^A, ^A, =A, _A, __A, ^^B, ^B, |
[V:1] [K:Eb] {^^c__d}=B _B __B c d e f g | [K:C#m] "G\u266f"c' b a g {=f}f e d c |]
[V:2] [K:Eb] =B,, _B,, __B,, C, D, E, F, G, | [K:C#m] C D E F G A B c |]
`;

// a file whose only key is an inline [K:] field: the score's initial key is
// the same object as that measure's key, which JS then moves only once
const INLINE_KEY = 'X:1\nT:Inline key\nL:1/8\nAB cd | [K:G] cd ef |]\n';

const sources = [
  ...readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.abc')).sort().map((f) => [`samples/${f}`, read(`samples/${f}`)]),
  ['tests/fixtures/parse-edge.abc', read('tests/fixtures/parse-edge.abc')],
  ['corners', CORNERS],
  ['inline key', INLINE_KEY],
];

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
const jsTransposed = (src, k) => JSON.parse(JSON.stringify(parse(src, { format: 'abc' }).scores.map((s) => transposeScore(s, k))));

for (const [name, src] of sources) {
  test(`${name}: sm-score-transpose equals transposeScore at ${INTERVALS.join(' ')}`, { skip }, () => {
    const prog = `${PARSE}\n${TRANSPOSE}\n/sm-t-src ${psLiteral(src)} def\n`
      + INTERVALS.map((k) => `sm-t-src sm-abc-parse-all dup { ${k} sm-score-transpose pop } forall sm-abc-json (\\n) print`).join('\n');
    const got = lines(pscat(prog));
    assert.equal(got.length, INTERVALS.length);
    INTERVALS.forEach((k, i) => assert.deepEqual(got[i], jsTransposed(src, k), `${name} transposed ${k}`));
  });
}

test('0, null and a real: untouched, untouched, truncated', { skip }, () => {
  const src = read('samples/greensleeves.abc');
  const got = lines(pscat(`${PARSE}\n${TRANSPOSE}\n${[0, 'null', 2.7, -2.7].map((k) => `${psLiteral(src)} sm-abc-parse ${k} sm-score-transpose sm-abc-json (\\n) print`).join('\n')}`));
  const base = jsTransposed(src, 0)[0];
  assert.equal(base.transposed, undefined);
  assert.deepEqual(got, [base, base, jsTransposed(src, 2)[0], jsTransposed(src, -2)[0]]);
});

test('fifths shift, pitch moves and chord symbols agree with the JS helpers on a grid', { skip }, () => {
  const semis = Array.from({ length: 25 }, (_, i) => i - 12);
  const fifths = Array.from({ length: 15 }, (_, i) => i - 7);
  const wantShift = semis.map((s) => fifths.map((f) => fifthsShift(s, f)));
  const pitches = [];
  for (const step of 'CDEFGAB') for (const alter of [-2, -1, 0, 1, 2]) for (const s of semis) for (const f of [-7, 0, 7]) for (const respell of [true, false]) {
    pitches.push({ step, oct: 4, alter, s, df: fifthsShift(s, f), respell });
  }
  const chords = ['Am7', 'Bb/D', 'F#m', 'Eb', 'N.C.', 'C/G7', 'C/', 'Cb', 'B#dim', 'G\u266fm7/D\u266d', 'E\u266d', 'A\u266f/', 'D/F\u266f', 'Am  D7', ' G ', '', 'H', 'Bbb', 'C/Bb', 'C/Bbb', 'c', 'Dsus4/A'];
  const dfs = Array.from({ length: 24 }, (_, i) => i - 12);
  const prog = `${PARSE}\n${TRANSPOSE}\n`
    + `[ ${semis.map((s) => `[ ${fifths.map((f) => `${s} ${f} sm-transpose-fifths-shift`).join(' ')} ]`).join(' ')} ] sm-abc-json (\\n) print\n`
    + `[ ${pitches.map((p) => `(${p.step}) ${p.oct} ${p.alter} ${p.s} ${p.df} ${p.respell} sm-transpose-pitch`).join('\n')} ] sm-abc-json (\\n) print\n`
    + `[ ${chords.map((c) => `[ ${dfs.map((d) => `${psLiteral(c)} ${d} sm-transpose-chord`).join(' ')} ]`).join('\n')} ] sm-abc-json (\\n) print`;
  const [gotShift, gotPitch, gotChord] = lines(pscat(prog));
  assert.deepEqual(gotShift, wantShift);
  assert.deepEqual(gotPitch, pitches.map((p) => movePitch({ step: p.step, oct: p.oct, alter: p.alter }, p.s, p.df, p.respell)));
  assert.deepEqual(gotChord, chords.map((c) => dfs.map((d) => transposeChord(c, d))));
  assert.equal(gotChord[0][2 + 12], 'Bm7');
  assert.equal(gotChord[9][2 + 12], 'A#m7/Eb'); // the signs come back as # and b
});

test('sm-abc-tune-transpose reads %%transpose like tuneTranspose', { skip }, () => {
  const tune = (n, extra = '') => `X:${n}\nT:T${n}\n${extra}K:C\nCDEF|\n`;
  const cases = [
    tune(1, '%%transpose -2\n'),
    '%%transpose 5\n\n' + tune(1) + tune(2, '%%transpose 3\n'),
    '%%transpose 5\n\n' + tune(1, '%%transpose 0\n'), // 0 in the tune: the header's counts
    '  %%transpose\t+7 semitones\n' + tune(1),
    '<!-- %%transpose -4 -->\n' + tune(1),
    '%%transposex 3\n%%transpose x\n%%transpose 9\n' + tune(1), // the first line that matches
    '%%transpose 2\nT:No X line\nK:G\nGABc|\n',
    'T:none\nK:C\nC|\n',
    tune(1, '%%transpose 4\n').replace(/\n/g, '\r\n'),
    '%%transpose -1\r' + tune(1).replace(/\n/g, '\r'),
    tune(1) + 'w: %%transpose 6 is not at the line start\n',
    '',
  ];
  const calls = [];
  const want = [];
  for (const src of cases) {
    for (let t = 0; t < Math.max(1, splitTunes(src).length) + 1; t++) {
      calls.push(`${psLiteral(src)} ${t} sm-abc-tune-transpose`);
      want.push(tuneTranspose(src, splitTunes(src)[t] || '', 'abc'));
    }
  }
  const [got] = lines(pscat(`${PARSE}\n[ ${calls.join('\n')} ] sm-abc-json (\\n) print`));
  assert.deepEqual(got, want);
  assert.ok(want.filter((v) => v !== 0).length >= 8);
  // and selfContainedPS (what it reports, the PDF's Subject) agrees with tuneTranspose
  assert.equal(selfContainedPS(cases[1], { engraveLib: ENGRAVE, abcLib: ABC, tune: 1 }).transposed.semis, 3);
  assert.equal(selfContainedPS(cases[2], { engraveLib: ENGRAVE, abcLib: ABC }).transposed.semis, 5);
});

test('every name sm_transpose.ps defines, temporaries included, starts with sm-', { skip }, () => {
  const prog = `/sm-t-before userdict length dict def userdict { pop sm-t-before exch true put } forall
${PARSE}
/sm-t-before2 userdict length dict def userdict { pop sm-t-before2 exch true put } forall
${TRANSPOSE}
${psLiteral(CORNERS)} sm-abc-parse 7 sm-score-transpose pop (Bb/D A#) 3 sm-transpose-chord pop
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
  const { ps } = selfContainedPS(src, { engraveLib: ENGRAVE, abcLib: ABC, parseLib: PARSE, transposeLib: TRANSPOSE, ...opts });
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
    // B: the same document with no parser, the JS-transposed Score embedded, no PS transposition
    const score = parse(src).scores[0];
    transposeScore(score, k);
    const plain = selfContainedPS(src, { engraveLib: ENGRAVE, abcLib: ABC });
    const lit = `/sm-abc-score ${psLiteral(parse(src).scores[0])} def`;
    assert.ok(plain.ps.includes(lit));
    const docB = path.join(tmp, `b${runs}.ps`);
    writeFileSync(docB, plain.ps.replace(lit, `/sm-abc-score ${psLiteral(score)} def`));
    const page = `${Math.round(plain.size[0])}x${Math.round(plain.size[1])}`;
    const pb = docB.replace(/ps$/, 'pdf');
    execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', pb, docB], { stdio: 'pipe' });
    assert.ok(readFileSync(pa).equals(readFileSync(pb)), `${f} ${k}: PDF differs from the engraving of the JS-transposed Score`);
  }
});

test('%%transpose in the source and the option add up on the PostScript path; the result reports it', { skip }, async () => {
  const src = read('samples/twinkle.abc').replace(/^K:/m, '%%transpose -3\nK:');
  const r = selfContainedPS(src, { engraveLib: ENGRAVE, abcLib: ABC, parseLib: PARSE, transposeLib: TRANSPOSE, transpose: 5 });
  assert.deepEqual(r.transposed, transposeScore(parse(src).scores[0], 2).transposed); // -3 + 5
  assert.equal(r.transposed.semis, 2);
  assert.deepEqual(r.warnings, []);
  // PS (parser + directive) and the fallback (embedded literal + total) give the same PDF
  const page = '612x792';
  const run = (ps) => { const f = path.join(tmp, `d${++runs}.ps`); writeFileSync(f, ps); execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', f + '.pdf', f], { stdio: 'pipe' }); return readFileSync(f + '.pdf'); };
  const viaParser = run(r.ps);
  const viaLiteral = run(selfContainedPS(src, { engraveLib: ENGRAVE, abcLib: ABC, transposeLib: TRANSPOSE, transpose: 5 }).ps);
  const twinkleUp2 = run(selfContainedPS(read('samples/twinkle.abc'), { engraveLib: ENGRAVE, abcLib: ABC, parseLib: PARSE, transposeLib: TRANSPOSE, transpose: 2 }).ps);
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
