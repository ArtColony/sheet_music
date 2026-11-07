// Freeze what the JavaScript parsers computed, before they were retired (#10):
// tests/fixtures/reference/*.json hold, for every sample and fixture, the
// Score src/abc.js and src/musicxml.js built, src/index.js scoreMeta, the
// events src/play.js performance() gave, and src/transpose.js's results.
// The PostScript parser, metadata, playback and transposition tests compare
// against these files now. This script ran once, at 61bad5e plus the commit
// that added it, and was then deleted with the JS parsers; it stays in the
// history as the record of how the references were made.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parse, scoreMeta, performanceOf, parseAnnotations, tuneTranspose, transposeScore, fifthsShift, transposeChord } from '../src/index.js';
import { parseMusicXML, parseXML } from '../src/musicxml.js';
import { splitTunes } from '../src/abc.js';
import { movePitch } from '../src/transpose.js';
import { psLiteral, num } from '../src/ps.js';
import { canon } from '../tests/reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// one line per entry, nested `depth` levels deep: small diffs, small files
const lines = (v, depth, pad = '') => {
  if (depth <= 0 || v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = pad + ' ';
  const items = Array.isArray(v) ? v.map((x) => inner + lines(x, depth - 1, inner))
    : Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${lines(x, depth - 1, inner)}`);
  return items.length ? `${Array.isArray(v) ? '[' : '{'}\n${items.join(',\n')}\n${pad}${Array.isArray(v) ? ']' : '}'}` : JSON.stringify(v);
};
const out = (name, v, depth = 2) => writeFileSync(path.join(root, 'tests/fixtures/reference', name), lines(v, depth) + '\n');
const sha = (v) => createHash('sha256').update(canon(v)).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
// the PDF-equality tests engrave psLiteral(frozen Score): it must be the
// literal of the JS Score itself
const frozenScore = (s) => { const f = plain(s); assert.equal(psLiteral(f), psLiteral(s)); return f; };

const list = (dir, re) => readdirSync(path.join(root, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);
const ABC = [...list('samples', /\.abc$/), 'tests/fixtures/parse-edge.abc'];
const XML = [...list('samples', /\.musicxml$/), ...list('tests/fixtures', /\.musicxml$/)];
const ALL = [...list('samples', /\.(abc|musicxml)$/), ...list('tests/fixtures', /\.(abc|musicxml)$/)];
const PERFORM_CORNERS = 'tests/fixtures/reference/perform-corners.abc';
const TRANSPOSE_CORNERS = 'tests/fixtures/reference/transpose-corners.abc';
const INLINE_KEY = 'tests/fixtures/reference/inline-key.abc';

// ------------------------------------------------------------ ABC parse
const abc = {};
const abcParse = (src) => { const { scores, warnings } = parse(src, { format: 'abc' }); scores.forEach(frozenScore); return plain({ scores, warnings }); };
for (const f of ABC) abc[f] = abcParse(read(f));
abc.bare = abcParse('T:Bare\nK:G\nGAB c2 |');
abc.empty = abcParse('');
// CRLF parses like LF: the test checks PostScript on CRLF against the LF reference
assert.deepEqual(abcParse(read('samples/amazing-grace.abc').replace(/\n/g, '\r\n')), abc['samples/amazing-grace.abc']);
// sm-abc-annotations: what psdoc passed the layout (numbers as psLiteral writes them)
const lit = (v) => (typeof v === 'number' && !Number.isInteger(v) ? parseFloat(num(v)) : Array.isArray(v) ? v.map(lit) : v);
const annotations = {};
for (const f of ['samples/mountain-king.abc', 'tests/fixtures/parse-edge.abc']) {
  annotations[f] = splitTunes(read(f)).map((t) => parseAnnotations(t).map((a) => Object.fromEntries(['page', 'type', 'x', 'y', 'w', 'h', 'rgb', 'text'].map((k) => [k, lit(a[k])]))));
}
out('abc-parse.json', { scores: abc, annotations }, 3);

// ------------------------------------------------------------ MusicXML parse
const xmlParse = (src) => { try { const r = parseMusicXML(src); frozenScore(r.score); return plain({ score: r.score, warnings: r.warnings }); } catch (e) { return { error: e.message }; } };
const xml = {};
for (const f of XML) xml[f] = { xml: plain(parseXML(read(f))), parse: xmlParse(read(f)) };
const BAD = [
  '<a><b/></a>',
  '<?xml version="1.0"?>\n<score-timewise version="4.0"></score-timewise>',
  '<score-partwise><part id="P1"><measure></part></score-partwise>',
  '<score-partwise><part id="P1"',
  '<score-partwise></score-partwise></score-partwise>',
];
const errors = BAD.map((src) => { const r = xmlParse(src); assert.ok(r.error); return { src, error: r.error }; });
// a %%transpose comment changes neither the Score nor the warnings
const edgeX = read('tests/fixtures/parse-edge.musicxml');
const edgeT = edgeX.replace('<score-partwise', '<!-- %%transpose -3 -->\n<score-partwise');
assert.deepEqual(xmlParse(edgeT), xml['tests/fixtures/parse-edge.musicxml'].parse);
const edgeAnnotations = parseAnnotations(edgeT).map((a) => ({ page: a.page, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, rgb: a.rgb, text: a.text }));
out('musicxml-parse.json', { files: xml, errors, edgeAnnotations }, 3);

// ------------------------------------------------------------ metadata
const meta = [];
for (const f of ALL) {
  const src = read(f);
  for (let tune = 0; tune < scoreMeta(src).tunes.length; tune++) {
    for (const transpose of [0, 2, -5]) meta.push({ file: f, tune, transpose, meta: plain(scoreMeta(src, { tune, transpose })) });
  }
}
const META_ERRORS = [[read('samples/twinkle.abc'), { tune: 3 }, 'samples/twinkle.abc'], ['<?xml version="1.0"?>\n<score-partwise><part-list></score-partwise>', {}], ['<?xml version="1.0"?>\n<opus/>', {}], ['<score-timewise/>', {}]];
const metaErrors = META_ERRORS.map(([src, opts, file]) => {
  const m = plain(scoreMeta(src, opts));
  assert.ok(m.error);
  return { ...(file ? { file } : { src }), options: opts, meta: m };
});
out('meta.json', { meta, errors: metaErrors });

// ------------------------------------------------------------ playback
const perform = {};
const perf = (label, src, opts) => { perform[label] = plain(performanceOf(src, opts)); };
for (const f of list('samples', /\.(abc|musicxml)$/)) {
  for (const k of [0, 2, -5, -3]) perf(`${f} ${k}`, read(f), { transpose: k });
}
for (const k of [0, 2, -5]) perf(`tests/fixtures/parse-edge.musicxml ${k}`, edgeX, { transpose: k });
const xt3 = edgeX.replace('<score-partwise', '<!-- %%transpose 3 -->\n<score-partwise');
perf('tests/fixtures/parse-edge.musicxml %%transpose 3, /transpose -1', xt3, { transpose: -1 });
const edge = read('tests/fixtures/parse-edge.abc');
splitTunes(edge).forEach((_, t) => { for (const k of [0, 2, -5]) perf(`tests/fixtures/parse-edge.abc /tune ${t} ${k}`, edge, { tune: t, transpose: k }); });
for (const k of [0, 2, -5]) perf(`${PERFORM_CORNERS} ${k}`, read(PERFORM_CORNERS), { transpose: k });
assert.deepEqual(plain(performanceOf(read('samples/greensleeves.abc'))), perform['samples/greensleeves.abc 0']);
out('perform.json', perform, 1);

// ------------------------------------------------------------ transposition
const INTERVALS = [-12, -5, -2, 1, 2, 6, 7, 11];
const transposed = {};
for (const f of [...list('samples', /\.abc$/), 'tests/fixtures/parse-edge.abc', TRANSPOSE_CORNERS, INLINE_KEY]) {
  const src = read(f);
  transposed[f] = Object.fromEntries(INTERVALS.map((k) => [k, sha(plain(parse(src, { format: 'abc' }).scores.map((s) => transposeScore(s, k))))]));
}
// greensleeves by 0, null, 2.7 and -2.7: untouched, untouched, 2, -2
const gs = read('samples/greensleeves.abc');
const gsT = (k) => plain(transposeScore(parse(gs).scores[0], k));
const odd = [0, null, 2.7, -2.7].map((k) => sha(gsT(k)));
assert.equal(gsT(0).transposed, undefined);
// the helpers on a grid (the inputs are rebuilt by tests/ps-transpose.test.mjs)
const semis = Array.from({ length: 25 }, (_, i) => i - 12);
const fifths = Array.from({ length: 15 }, (_, i) => i - 7);
const shiftGrid = semis.map((s) => fifths.map((f) => fifthsShift(s, f)));
const pitches = [];
for (const step of 'CDEFGAB') for (const alter of [-2, -1, 0, 1, 2]) for (const s of semis) for (const f of [-7, 0, 7]) for (const respell of [true, false]) {
  pitches.push(movePitch({ step, oct: 4, alter }, s, fifthsShift(s, f), respell));
}
const CHORDS = ['Am7', 'Bb/D', 'F#m', 'Eb', 'N.C.', 'C/G7', 'C/', 'Cb', 'B#dim', 'G♯m7/D♭', 'E♭', 'A♯/', 'D/F♯', 'Am  D7', ' G ', '', 'H', 'Bbb', 'C/Bb', 'C/Bbb', 'c', 'Dsus4/A'];
const dfs = Array.from({ length: 24 }, (_, i) => i - 12);
const chordGrid = CHORDS.map((c) => dfs.map((d) => transposeChord(c, d)));
// %%transpose: the tune's line, else the file header's
const tune = (n, extra = '') => `X:${n}\nT:T${n}\n${extra}K:C\nCDEF|\n`;
const TT = [
  tune(1, '%%transpose -2\n'),
  '%%transpose 5\n\n' + tune(1) + tune(2, '%%transpose 3\n'),
  '%%transpose 5\n\n' + tune(1, '%%transpose 0\n'),
  '  %%transpose\t+7 semitones\n' + tune(1),
  '<!-- %%transpose -4 -->\n' + tune(1),
  '%%transposex 3\n%%transpose x\n%%transpose 9\n' + tune(1),
  '%%transpose 2\nT:No X line\nK:G\nGABc|\n',
  'T:none\nK:C\nC|\n',
  tune(1, '%%transpose 4\n').replace(/\n/g, '\r\n'),
  '%%transpose -1\r' + tune(1).replace(/\n/g, '\r'),
  tune(1) + 'w: %%transpose 6 is not at the line start\n',
  '',
];
const tuneTransposes = [];
for (const src of TT) {
  for (let t = 0; t < Math.max(1, splitTunes(src).length) + 1; t++) tuneTransposes.push({ src, tune: t, semis: tuneTranspose(src, splitTunes(src)[t] || '', 'abc') });
}
// the Scores the --transpose PDF-equality test engraves: parsed and transposed in JS
const engraved = {};
for (const [f, k] of [['samples/feature-tour.abc', 2], ['samples/greensleeves.abc', -5], ['samples/mountain-king.abc', 6], ['samples/frere-jacques.musicxml', 7]]) {
  engraved[`${f} ${k}`] = frozenScore(transposeScore(parse(read(f)).scores[0], k));
}
out('transpose.json', {
  intervals: INTERVALS, scores: transposed, greensleeves: { amounts: [0, null, 2.7, -2.7], sha: odd },
  fifthsShift: shiftGrid, pitches: { count: pitches.length, sha: sha(pitches) }, chords: { list: CHORDS, sha: sha(chordGrid) },
  tuneTranspose: tuneTransposes, engraved,
});
console.log('wrote tests/fixtures/reference/{abc-parse,musicxml-parse,meta,perform,transpose}.json');
