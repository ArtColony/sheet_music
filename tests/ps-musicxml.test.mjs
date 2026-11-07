// The PostScript MusicXML parser (lib/sm_musicxml.ps) must build exactly the
// Score the JS parser (src/musicxml.js) builds, and that Score must engrave
// exactly as the JS parse does through the PostScript layout (lib/sm_abc.ps).
// For every MusicXML sample and fixture: pscat runs sm-musicxml-parse,
// prints the result with sm-abc-json, and it must equal parseMusicXML(src),
// warnings included, both as values and as canonical JSON text (so an
// integer stays an integer); then the PDF from the PS parse must be byte
// for byte the PDF from the JS parse's psLiteral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMusicXML, parseXML } from '../src/musicxml.js';
import { parseAnnotations } from '../src/index.js';
import { psLiteral } from '../src/ps.js';
import { selfContainedPS } from '../src/psdoc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const lib = (f) => readFileSync(path.join(root, 'lib', f), 'utf8');
const ENGRAVE = lib('sm_engrave.ps'), ABC = lib('sm_abc.ps'), PARSE = lib('sm_abc_parse.ps'), TRANSPOSE = lib('sm_transpose.ps'), MXL = lib('sm_musicxml.ps');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psmusicxml-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const isXML = (f) => /\.(musicxml|xml)$/.test(f);
const files = [
  ...readdirSync(path.join(root, 'samples')).filter(isXML).sort().map((f) => path.join(root, 'samples', f)),
  ...readdirSync(path.join(root, 'tests/fixtures')).filter(isXML).sort().map((f) => path.join(root, 'tests/fixtures', f)),
];

// Run a program from a file (not stdin: docs/FRICTION.md #11) with
// --lint-strict; returns { out, pdf }. pscat's own "pscat: wrote" line is dropped.
let runs = 0;
function pscat(prog, { page = '612x792' } = {}) {
  const file = path.join(tmp, `p${++runs}.ps`);
  const pdf = path.join(tmp, `p${runs}.pdf`);
  writeFileSync(file, prog);
  const out = execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', pdf, file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  return { out: out.replace(/^pscat: .*\n?/gm, ''), pdf: readFileSync(pdf) };
}
const DOT = '\n0 0 1 1 rectfill showpage\n';

// JSON text with object keys sorted, control characters as sm-abc-json
// writes them (\u00XX)
const ESC = { n: '000a', r: '000d', t: '0009', b: '0008', f: '000c' };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x)).replace(/\\([nrtbf])/g, (m, c) => '\\u' + ESC[c]);
const expected = (src) => {
  try { const r = parseMusicXML(src); return { score: r.score, warnings: r.warnings }; } catch (e) { return { error: e.message }; }
};
// call leaves a score on the stack (or fails): prints {"score":..,"warnings":..} or {"error":..}
function runParse(call) {
  const prog = `${PARSE}\n${MXL}\n{ ${call} (\\{"score":) print sm-abc-json (,"warnings":) print sm-musicxml-warnings sm-abc-json (\\}\\n) print } stopped
{ (\\{"error":) print sm-musicxml-error sm-abc-json (\\}\\n) print } if${DOT}`;
  return pscat(prog).out.split('\n')[0];
}

for (const file of files) {
  const name = path.relative(root, file);
  test(`${name}: the XML tree equals parseXML`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const out = pscat(`${PARSE}\n${MXL}\n${psLiteral(src)} sm-mxp-dict begin sm-mxp-xml end sm-abc-json (\\n) print${DOT}`).out;
    assert.deepEqual(JSON.parse(out.split('\n')[0]), JSON.parse(JSON.stringify(parseXML(src))));
  });
  test(`${name}: sm-musicxml-parse equals the JS parser`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const want = expected(src);
    const out = runParse(`${psLiteral(src)} sm-musicxml-parse`);
    assert.deepEqual(JSON.parse(out), JSON.parse(JSON.stringify(want)));
    assert.equal(out, canon(want), 'same JSON text (integers stay integers)');
    if (name.startsWith('samples/')) assert.deepEqual(want.warnings, []);
    else assert.ok(want.warnings.length >= 3, 'the fixture exercises the warnings');
  });
  test(`${name}: engraved from the PS parse = engraved from the JS parse`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const prolog = `${ENGRAVE}\n${ABC}\n${PARSE}\n${MXL}\n`;
    const opts = '<< /quiet true >>';
    const js = pscat(`${prolog}${psLiteral(parseMusicXML(src).score)} ${opts} sm-abc-engrave\n`);
    const ps = pscat(`${prolog}${psLiteral(path.relative(root, file))} sm-musicxml-parse-file ${opts} sm-abc-engrave\n`);
    assert.ok(js.pdf.length > 1000);
    assert.ok(ps.pdf.equals(js.pdf), `${name}: PDFs differ`);
  });
}

test('sm-musicxml-engrave-string applies <!-- %%transpose --> and <!-- %%annotation --> comments', { skip }, () => {
  const src = readFileSync(path.join(root, 'tests/fixtures/parse-edge.musicxml'), 'utf8').replace('<score-partwise', '<!-- %%transpose -3 -->\n<score-partwise');
  const annotations = parseAnnotations(src).map((a) => ({ page: a.page, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, rgb: a.rgb, text: a.text }));
  assert.equal(annotations.length, 1);
  const prolog = `${ENGRAVE}\n${ABC}\n${PARSE}\n${TRANSPOSE}\n${MXL}\n`;
  const js = pscat(`${prolog}${psLiteral(parseMusicXML(src).score)} << /quiet true /transpose -1 /annotations ${psLiteral(annotations)} >> sm-abc-engrave\n`);
  const ps = pscat(`${prolog}${psLiteral(src)} << /quiet true /transpose 2 >> sm-musicxml-engrave-string\n`);
  assert.ok(ps.pdf.equals(js.pdf));
  assert.equal(ps.out, '');
  // the warnings are printed unless /quiet true
  const loud = pscat(`${prolog}${psLiteral(src)} sm-musicxml-engrave-string\n`);
  assert.deepEqual(loud.out.trimEnd().split('\n'), parseMusicXML(src).warnings.map((w) => `sm-abc: warning: ${w}`));
});

test('a self-contained document parses MusicXML in PostScript when lib/sm_musicxml.ps is embedded', { skip }, () => {
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const base = { engraveLib: ENGRAVE, abcLib: ABC, parseLib: PARSE, transposeLib: TRANSPOSE };
    const plain = selfContainedPS(src, base);
    assert.ok(!plain.ps.includes('sm-musicxml-'), 'without musicxmlLib nothing changes');
    // no Score literal to fall back on: only the PS parser can draw it
    const viaPS = selfContainedPS(src, { ...base, musicxmlLib: MXL, embedScore: false, transpose: 1 });
    assert.ok(viaPS.ps.includes('sm-musicxml-engrave-string') && viaPS.ps.includes('/sm-abc-score null def'));
    const a = pscat(plain.ps.replace('/sm-abc-options <<', '/sm-abc-options << /quiet true /transpose 1'));
    const b = pscat(viaPS.ps.replace('/sm-abc-options <<', '/sm-abc-options << /quiet true'));
    assert.ok(a.pdf.equals(b.pdf), path.relative(root, file));
  }
});

test('documents the parser cannot read: the JS error message, as a syntaxerror', { skip }, () => {
  const bad = [
    '<a><b/></a>',
    '<?xml version="1.0"?>\n<score-timewise version="4.0"></score-timewise>',
    '<score-partwise><part id="P1"><measure></part></score-partwise>',
    '<score-partwise><part id="P1"',
    '<score-partwise></score-partwise></score-partwise>',
  ];
  for (const src of bad) {
    const want = expected(src);
    assert.ok(want.error, src);
    assert.equal(runParse(`${psLiteral(src)} sm-musicxml-parse`), canon(want), src);
  }
  // uncaught: pscat reports it and fails
  const file = path.join(tmp, 'uncaught.ps');
  writeFileSync(file, `${MXL}\n(<a/>) sm-musicxml-parse pop${DOT}`);
  const r = spawnSync(PSCAT, ['--pdf', path.join(tmp, 'uncaught.pdf'), file], { encoding: 'utf8', timeout: 60000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /syntaxerror.*sm-musicxml: not a MusicXML score \(no <score-partwise>\)/);
  // a later good parse clears sm-musicxml-error
  const out = pscat(`${MXL}\n{ (<a/>) sm-musicxml-parse } stopped pop sm-musicxml-error =
(<score-partwise><part id="P"><measure><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>whole</type></note></measure></part></score-partwise>) sm-musicxml-parse
/measures get length = sm-musicxml-error null eq =${DOT}`).out;
  assert.equal(out, 'not a MusicXML score (no <score-partwise>)\n1\ntrue\n');
});

test('lib/sheet.ps: engrave-file, engrave-here, check-file and check-string', { skip }, () => {
  const fj = readFileSync(path.join(root, 'samples/frere-jacques.musicxml'), 'utf8');
  const ref = pscat(`${ENGRAVE}\n${ABC}\n${psLiteral(parseMusicXML(fj).score)} sm-abc-engrave\n`).pdf;
  let r = pscat('(lib/sheet.ps) run (samples/frere-jacques.musicxml) sm-musicxml-engrave-file\n');
  assert.equal(r.out, '');
  assert.ok(r.pdf.equals(ref));
  // the MusicXML after the call, up to the end marker, then the program goes on
  r = pscat(`%!PS\n(lib/sheet.ps) run\nsm-musicxml-engrave-here\n${fj.trimEnd()}\n%%SM-ABC-END\n(after) =\n`);
  assert.equal(r.out, 'after\n');
  assert.ok(r.pdf.equals(ref));
  r = pscat(`(lib/sheet.ps) run\nsm-musicxml-here\n${fj.trimEnd()}\n%%SM-ABC-END\ndup sm-musicxml-check-string << /quiet true >> sm-musicxml-engrave-string\n`);
  assert.deepEqual(r.out.trimEnd().split('\n'), [
    'sm-abc: musicxml  "Frère Jacques"  M:4/4  K:0  bars 8  staves 1',
    'sm-abc: check: 1 score, 0 warning(s), 0 bar(s) off the meter',
    'sm-abc: ok',
  ]);
  assert.ok(r.pdf.equals(ref));
  r = pscat(`(lib/sheet.ps) run (tests/fixtures/parse-edge.musicxml) sm-musicxml-check-file${DOT}`);
  const lines = r.out.trimEnd().split('\n');
  assert.match(lines[0], /^sm-abc: musicxml {2}"Café & Crème <edge> .*" {2}M:3\/4 {2}K:3b {2}bars 5 {2}staves 3$/);
  assert.deepEqual(lines.filter((l) => l.startsWith('sm-abc: warning: ')).map((l) => l.slice(17)), parseMusicXML(readFileSync(path.join(root, 'tests/fixtures/parse-edge.musicxml'), 'utf8')).warnings);
  assert.match(lines.at(-1), /^sm-abc: check: 1 score, 3 warning\(s\), \d+ bar\(s\) off the meter$/);
  r = pscat(`(lib/sheet.ps) run (<score-partwise><part) sm-musicxml-check-string${DOT}`);
  assert.deepEqual(r.out.trimEnd().split('\n'), [
    'sm-abc: error: malformed XML: unterminated tag',
    'sm-abc: check: the MusicXML does not parse',
  ]);
});

test('loaded inside another dict; every name it defines starts with sm-', { skip }, () => {
  const src = readFileSync(path.join(root, 'tests/fixtures/parse-edge.musicxml'), 'utf8');
  const prog = `/sm-t-before userdict length dict def userdict { pop sm-t-before exch true put } forall
10 dict begin ${MXL}\nend
${psLiteral(src)} sm-musicxml-parse pop
${psLiteral(path.join(root, 'samples/frere-jacques.musicxml'))} sm-musicxml-parse-file /meta get /title get print (\\n) print
userdict { pop dup sm-t-before exch known { pop } { 64 string cvs print ( ) print } ifelse } forall
sm-mxp-dict { pop 64 string cvs print ( ) print } forall (\\n) print${DOT}`;
  const lines = pscat(prog).out.split('\n');
  assert.equal(lines[0], 'Frère Jacques');
  const names = lines[1].trim().split(/\s+/);
  assert.ok(names.length > 150, `only ${names.length} names`);
  assert.deepEqual(names.filter((n) => !n.startsWith('sm-')), []);
});
