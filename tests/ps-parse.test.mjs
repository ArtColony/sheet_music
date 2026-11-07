// The PostScript ABC parser (lib/sm_abc_parse.ps) must build exactly the
// Score the retired JS parser (src/abc.js) built: for every ABC sample (and
// an edge-case fixture), pscat runs sm-abc-parse-all, prints the result with
// sm-abc-json, and it must deep-equal the frozen reference
// (tests/fixtures/reference/abc-parse.json), warnings included. Fracs are
// [num den]; members the JS left undefined are absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psLiteral } from '../src/ps.js';
import { reference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const LIB = readFileSync(path.join(root, 'lib/sm_abc_parse.ps'), 'utf8');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psparse-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

// the files the JS reference was frozen for (a sample added since is covered by
// the goldens and the explicit-value tests, not here); each must still exist
const files = Object.keys(reference('abc-parse').scores).filter((k) => k.endsWith('.abc')).map((f) => path.join(root, f));

// Write a program to a file and run it (a file, not stdin: see
// docs/FRICTION.md) with --lint-strict; returns stdout.
let runs = 0;
function pscat(prog) {
  const file = path.join(tmp, `p${++runs}.ps`);
  writeFileSync(file, prog);
  return execFileSync(PSCAT, ['--lint-strict', '--pdf', file.replace(/ps$/, 'pdf'), file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
}

// Run `call` (PostScript leaving [scores] on the stack) and return the JSON
// {scores, warnings} it prints. A dot is painted so --lint-strict sees ink.
function runPS(call) {
  const prog = `${LIB}\n${call} (\\{"scores":) print sm-abc-json (,"warnings":) print sm-abc-warnings sm-abc-json (\\}\\n) print\n0 0 1 1 rectfill showpage\n`;
  const out = pscat(prog);
  return JSON.parse(out.split('\n')[0]);
}
const REF = reference('abc-parse');
const expected = (key) => { assert.ok(REF.scores[key], `no reference for ${key}`); return REF.scores[key]; };

test('the frozen files are all still there', () => {
  assert.equal(files.length, 9);
  for (const f of files) assert.ok(existsSync(f), f);
});

for (const file of files) {
  const name = path.relative(root, file);
  test(`${name}: sm-abc-parse equals the JS parser's Score`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const want = expected(name);
    assert.deepEqual(runPS(`${psLiteral(src)} sm-abc-parse-all`), want);
    if (name.startsWith('samples/')) assert.deepEqual(want.warnings, []);
  });
}

test('sm-abc-parse-file and sm-abc-parse give the first tune', { skip }, () => {
  const file = path.join(root, 'tests/fixtures/parse-edge.abc');
  const want = expected('tests/fixtures/parse-edge.abc');
  const got = runPS(`${psLiteral(file)} sm-abc-parse-file 1 array astore`);
  assert.deepEqual(got.scores, want.scores.slice(0, 1));
  assert.deepEqual(got.warnings, want.warnings);
  const got2 = runPS(`${psLiteral(readFileSync(file, 'utf8'))} sm-abc-parse 1 array astore`);
  assert.deepEqual(got2.scores, want.scores.slice(0, 1));
});

test('loaded inside another dict, no X: line, empty text', { skip }, () => {
  const src = 'T:Bare\nK:G\nGAB c2 |';
  const got = runPS(`10 dict begin ${LIB}\nend ${psLiteral(src)} sm-abc-parse-all () sm-abc-parse 2 array astore`);
  assert.deepEqual(got.scores, [expected('bare').scores, expected('empty').scores[0]]);
  assert.deepEqual(got.warnings, []);
});

test('sm-abc-annotations gives what the JS annotation reader gave the layout', { skip }, () => {
  // src/psdoc.js once mapped parseAnnotations of the tune's text to these
  // fields and wrote them with psLiteral (non-integers with two decimals)
  for (const file of ['samples/mountain-king.abc', 'tests/fixtures/parse-edge.abc']) {
    const src = readFileSync(path.join(root, file), 'utf8');
    const want = REF.annotations[file];
    const call = `[ 0 1 ${want.length - 1} { ${psLiteral(src)} exch sm-abc-annotations } for ]`;
    const got = runPS(call).scores;
    assert.deepEqual(got, want, file);
    assert.ok(want.flat().length >= 4, file);
  }
});

test('CRLF line ends parse like LF', { skip }, () => {
  const src = readFileSync(path.join(root, 'samples/amazing-grace.abc'), 'utf8').replace(/\n/g, '\r\n');
  assert.deepEqual(runPS(`${psLiteral(src)} sm-abc-parse-all`), expected('samples/amazing-grace.abc'));
});

test('every name it defines, temporaries included, starts with sm-', { skip }, () => {
  // userdict names added by loading the library, plus everything in the
  // private dict after a full parse (where the temporaries live)
  const src = readFileSync(path.join(root, 'tests/fixtures/parse-edge.abc'), 'utf8');
  const prog = `/sm-t-before userdict length dict def userdict { pop sm-t-before exch true put } forall
${LIB}
${psLiteral(src)} sm-abc-parse-all sm-abc-json
${psLiteral(path.join(root, 'samples/twinkle.abc'))} sm-abc-parse-file pop (\\n) print
userdict { pop dup sm-t-before exch known { pop } { 64 string cvs print ( ) print } ifelse } forall
sm-abcp-dict { pop 64 string cvs print ( ) print } forall (\\n) print
0 0 1 1 rectfill showpage
`;
  const out = pscat(prog);
  const names = out.split('\n')[1].trim().split(/\s+/);
  assert.ok(names.length > 100, `only ${names.length} names`);
  assert.deepEqual(names.filter((n) => !n.startsWith('sm-')), []);
});
