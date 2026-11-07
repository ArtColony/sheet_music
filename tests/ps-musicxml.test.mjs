// The PostScript MusicXML parser (lib/sm_musicxml.ps) must build exactly the
// Score the retired JS parser (src/musicxml.js) built, and that Score must
// engrave exactly as the JS parse did through the PostScript layout
// (lib/sm_abc.ps). For every MusicXML sample and fixture: pscat runs
// sm-musicxml-parse, prints the result with sm-abc-json, and it must equal
// the frozen parseMusicXML(src) (tests/fixtures/reference/musicxml-parse.json),
// warnings included, both as values and as canonical JSON text (so an
// integer stays an integer); then the PDF from the PS parse must be byte
// for byte the PDF from the frozen Score's psLiteral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psLiteral } from '../src/ps.js';
import { selfContainedPS } from '../src/psdoc.js';
import { reference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const lib = (f) => readFileSync(path.join(root, 'lib', f), 'utf8');
const ENGRAVE = lib('sm_engrave.ps'), ABC = lib('sm_abc.ps'), PARSE = lib('sm_abc_parse.ps'), TRANSPOSE = lib('sm_transpose.ps'), MXL = lib('sm_musicxml.ps');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psmusicxml-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const REF = reference('musicxml-parse');
const META = reference('meta').meta;
const isXML = (f) => /\.(musicxml|xml)$/.test(f);
// the files the JS reference was frozen for (a sample added since is covered by
// the goldens and the explicit-value tests, not here); each must still exist
const files = Object.keys(REF.files).filter(isXML).map((f) => path.join(root, f));
test('the frozen files are all still there', () => {
  assert.equal(files.length, 2);
  for (const f of files) assert.ok(existsSync(f), f);
});

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
// the frozen JS parse of a file: { score, warnings } (or { error })
const expected = (name) => { assert.ok(REF.files[name], `no reference for ${name}`); return REF.files[name].parse; };
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
    assert.deepEqual(JSON.parse(out.split('\n')[0]), REF.files[name].xml);
  });
  test(`${name}: sm-musicxml-parse equals the JS parser's Score`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const want = expected(name);
    const out = runParse(`${psLiteral(src)} sm-musicxml-parse`);
    assert.deepEqual(JSON.parse(out), want);
    assert.equal(out, canon(want), 'same JSON text (integers stay integers)');
    if (name.startsWith('samples/')) assert.deepEqual(want.warnings, []);
    else assert.ok(want.warnings.length >= 3, 'the fixture exercises the warnings');
  });
  test(`${name}: engraved from the PS parse = engraved from the JS parse`, { skip }, () => {
    const prolog = `${ENGRAVE}\n${ABC}\n${PARSE}\n${MXL}\n`;
    const opts = '<< /quiet true >>';
    const js = pscat(`${prolog}${psLiteral(expected(name).score)} ${opts} sm-abc-engrave\n`);
    const ps = pscat(`${prolog}${psLiteral(path.relative(root, file))} sm-musicxml-parse-file ${opts} sm-abc-engrave\n`);
    assert.ok(js.pdf.length > 1000);
    assert.ok(ps.pdf.equals(js.pdf), `${name}: PDFs differ`);
  });
}

test('sm-musicxml-engrave-string applies <!-- %%transpose --> and <!-- %%annotation --> comments', { skip }, () => {
  const src = readFileSync(path.join(root, 'tests/fixtures/parse-edge.musicxml'), 'utf8').replace('<score-partwise', '<!-- %%transpose -3 -->\n<score-partwise');
  // the comment changes neither the JS Score nor its warnings (checked when frozen)
  const want = expected('tests/fixtures/parse-edge.musicxml');
  const annotations = REF.edgeAnnotations;
  assert.equal(annotations.length, 1);
  const prolog = `${ENGRAVE}\n${ABC}\n${PARSE}\n${TRANSPOSE}\n${MXL}\n`;
  const js = pscat(`${prolog}${psLiteral(want.score)} << /quiet true /transpose -1 /annotations ${psLiteral(annotations)} >> sm-abc-engrave\n`);
  const ps = pscat(`${prolog}${psLiteral(src)} << /quiet true /transpose 2 >> sm-musicxml-engrave-string\n`);
  assert.ok(ps.pdf.equals(js.pdf));
  assert.equal(ps.out, '');
  // the warnings are printed unless /quiet true
  const loud = pscat(`${prolog}${psLiteral(src)} sm-musicxml-engrave-string\n`);
  assert.deepEqual(loud.out.trimEnd().split('\n'), want.warnings.map((w) => `sm-abc: warning: ${w}`));
});

test('a self-contained MusicXML document draws what the JS parse drew', { skip }, () => {
  const base = { engraveLib: ENGRAVE, abcLib: ABC, parseLib: PARSE, transposeLib: TRANSPOSE };
  assert.throws(() => selfContainedPS(readFileSync(files[0], 'utf8'), { ...base, meta: META.find((m) => m.file === path.relative(root, files[0])).meta }), /needs options\.musicxmlLib/);
  for (const file of files) {
    const name = path.relative(root, file);
    const src = readFileSync(file, 'utf8');
    // the metadata, which sheet and the editor get from sm-score-meta, from the JS reference
    const meta = META.find((m) => m.file === name && m.tune === 0 && m.transpose === 2).meta;
    const doc = selfContainedPS(src, { ...base, musicxmlLib: MXL, transpose: 2, meta });
    assert.ok(doc.ps.includes('sm-musicxml-engrave-string'));
    // what the retired Score-literal fallback did: the same document, with the
    // JS Score engraved in place of the text
    const quiet = doc.ps.replace('/sm-abc-options <<', '/sm-abc-options << /quiet true');
    const call = 'sm-abc-source sm-abc-options sm-musicxml-engrave-string\n';
    assert.ok(quiet.includes(call));
    const a = pscat(quiet.replace(call, `${psLiteral(expected(name).score)} sm-abc-options sm-abc-engrave\n`));
    const b = pscat(quiet);
    assert.ok(a.pdf.equals(b.pdf), name);
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
  assert.deepEqual(REF.errors.map((e) => e.src), bad);
  for (const { src, error } of REF.errors) {
    const want = { error };
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
  const ref = pscat(`${ENGRAVE}\n${ABC}\n${psLiteral(expected('samples/frere-jacques.musicxml').score)} sm-abc-engrave\n`).pdf;
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
  assert.deepEqual(lines.filter((l) => l.startsWith('sm-abc: warning: ')).map((l) => l.slice(17)), expected('tests/fixtures/parse-edge.musicxml').warnings);
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
