// The PostScript ABC parser (lib/sm_abc_parse.ps) must build exactly the
// Score the JS parser builds: for every ABC sample (and an edge-case
// fixture), pscat runs sm-abc-parse-all, prints the result with sm-abc-json,
// and it must deep-equal parse(src) from src/index.js, warnings included.
// Fracs are [num den] on both sides; JS undefined members are absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/index.js';
import { psLiteral } from '../src/ps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const LIB = readFileSync(path.join(root, 'lib/sm_abc_parse.ps'), 'utf8');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psparse-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const files = [
  ...readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.abc')).sort().map((f) => path.join(root, 'samples', f)),
  path.join(root, 'tests/fixtures/parse-edge.abc'),
];

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
const expected = (src) => {
  const { scores, warnings } = parse(src, { format: 'abc' });
  return JSON.parse(JSON.stringify({ scores, warnings }));
};

for (const file of files) {
  const name = path.relative(root, file);
  test(`${name}: sm-abc-parse equals the JS parser`, { skip }, () => {
    const src = readFileSync(file, 'utf8');
    const want = expected(src);
    assert.deepEqual(runPS(`${psLiteral(src)} sm-abc-parse-all`), want);
    if (name.startsWith('samples/')) assert.deepEqual(want.warnings, []);
  });
}

test('sm-abc-parse-file and sm-abc-parse give the first tune', { skip }, () => {
  const file = path.join(root, 'tests/fixtures/parse-edge.abc');
  const want = expected(readFileSync(file, 'utf8'));
  const got = runPS(`${psLiteral(file)} sm-abc-parse-file 1 array astore`);
  assert.deepEqual(got.scores, want.scores.slice(0, 1));
  assert.deepEqual(got.warnings, want.warnings);
  const got2 = runPS(`${psLiteral(readFileSync(file, 'utf8'))} sm-abc-parse 1 array astore`);
  assert.deepEqual(got2.scores, want.scores.slice(0, 1));
});

test('loaded inside another dict, no X: line, empty text', { skip }, () => {
  const src = 'T:Bare\nK:G\nGAB c2 |';
  const got = runPS(`10 dict begin ${LIB}\nend ${psLiteral(src)} sm-abc-parse-all () sm-abc-parse 2 array astore`);
  assert.deepEqual(got.scores, [expected(src).scores, expected('').scores[0]]);
  assert.deepEqual(got.warnings, []);
});

test('CRLF line ends parse like LF', { skip }, () => {
  const src = readFileSync(path.join(root, 'samples/amazing-grace.abc'), 'utf8').replace(/\n/g, '\r\n');
  assert.deepEqual(runPS(`${psLiteral(src)} sm-abc-parse-all`), expected(src));
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
