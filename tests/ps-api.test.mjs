// The headless PostScript API (lib/sheet.ps, docs/postscript-api.md): the
// one-liners from the repository root and from another directory, ABC read
// from the program file itself, the check/list helpers' output, the docs'
// glyph example, and the doc covering every public sm- name.
// Every pscat run is --lint-strict, with the program in a file (not stdin:
// docs/FRICTION.md #11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, publicNames } from '../scripts/ps-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-psapi-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const lit = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
const LIB = path.join(root, 'lib') + '/';
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

// Run a program file with pscat in cwd; returns { out, pdf } (what it printed, PDF bytes).
let runs = 0;
// The environment drops PSCAT_LIB and PSCAT_HOME, so a developer's own
// settings do not change what lib/ resolves to; confine: true adds
// --read-root cwd, which also hides an install in pscat's per-user lib/.
const cleanEnv = (env) => { const e = { ...process.env, ...env }; for (const k of ['PSCAT_LIB', 'PSCAT_HOME']) if (!env || !(k in env)) delete e[k]; return e; };
function pscat(prog, { cwd = root, page = '612x792', env, confine = false } = {}) {
  const file = path.join(tmp, `p${++runs}.ps`);
  const pdf = path.join(tmp, `p${runs}.pdf`);
  writeFileSync(file, prog);
  const args = ['--lint-strict', '--page', page, '--pdf', pdf, ...(confine ? ['--read-root', cwd] : []), file];
  const r = spawnSync(PSCAT, args, { cwd, encoding: 'utf8', timeout: 60000, env: cleanEnv(env) });
  if (r.status !== 0) throw Error(`pscat failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  // the program's output, without pscat's own "pscat: wrote ..." lines
  return { out: r.stdout.replace(/^pscat: .*\n/gm, ''), pdf: readFileSync(pdf) };
}
const DOT = '\n0 0 1 1 rectfill showpage\n';   // ink, so --lint-strict sees a page

test('one-liner from the repository root: (song.abc) sm-abc-engrave-file', { skip }, () => {
  const { out, pdf } = pscat('(lib/sheet.ps) run (samples/twinkle.abc) sm-abc-engrave-file\n');
  assert.equal(pages(pdf), 1);
  assert.equal(out, '');
  // options: a4, a bigger staff, the second tune of a file, its own footer
  const r = pscat('(lib/sheet.ps) run (tests/fixtures/parse-edge.abc) << /paper /a4 /staff-space 7 /tune 2 /footer (x) /quiet true >> sm-abc-engrave-file\n', { page: '595x842' });
  assert.ok(pages(r.pdf) >= 1);
  assert.equal(r.out, '');
});

test('the engrave procedures print parse warnings; /quiet true silences them', { skip }, () => {
  const abc = 'X:1\\nT:Warn\\nK:C\\nCDEF & GABc|]';
  const { out } = pscat(`(lib/sheet.ps) run (${abc}) sm-abc-engrave-string\n`);
  assert.match(out, /^sm-abc: warning: tune 1: voice overlay \(&\) is not supported/m);
  assert.equal(pscat(`(lib/sheet.ps) run (${abc}) << /quiet true >> sm-abc-engrave-string\n`).out, '');
});

test('one-liners from another directory: /sm-lib-dir, PSCAT_LIB, a .sheet-music copy', { skip }, () => {
  const other = path.join(tmp, 'elsewhere');
  mkdirSync(other, { recursive: true });
  const song = path.join(root, 'samples/twinkle.abc');
  // 1. sm-lib-dir set by the caller, absolute paths
  let r = pscat(`/sm-lib-dir ${lit(LIB)} def ${lit(LIB + 'sheet.ps')} run ${lit(song)} sm-abc-engrave-file\n`, { cwd: other });
  assert.equal(pages(r.pdf), 1);
  // ... with sm_transpose.ps loaded from there too: twinkle in D
  r = pscat(`/sm-lib-dir ${lit(LIB)} def ${lit(LIB + 'sheet.ps')} run ${lit(song)} sm-abc-parse-file 2 sm-score-transpose /transposed get /key get = ${lit(song)} << /transpose 2 >> sm-abc-engrave-file\n`, { cwd: other });
  assert.equal(r.out, 'D\n');
  assert.equal(pages(r.pdf), 1);
  // 2. PSCAT_LIB: (lib/sheet.ps) resolves through pscat's lib/ search, and
  //    pscat's own bundled libraries still do
  r = pscat(`(lib/sheet.ps) run (lib/artkit.ps) run ${lit(song)} sm-abc-list-file${DOT}`, { cwd: other, env: { PSCAT_LIB: path.join(root, 'lib') } });
  assert.match(r.out, /\/tune 0 {2}X:1 {2}"Twinkle, Twinkle, Little Star"/);
  // 3. a copy in the project's .sheet-music/ (what the MCP tools can read)
  const proj = path.join(tmp, 'proj');
  mkdirSync(path.join(proj, '.sheet-music'), { recursive: true });
  for (const f of readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.ps'))) copyFileSync(path.join(root, 'lib', f), path.join(proj, '.sheet-music', f));
  copyFileSync(song, path.join(proj, 'song.abc'));
  r = pscat('(.sheet-music/sheet.ps) run sm-lib-dir = (song.abc) sm-abc-engrave-file\n', { cwd: proj, confine: true });
  assert.equal(r.out, '.sheet-music/\n');
  assert.equal(pages(r.pdf), 1);
  // 4. nothing to find: a clear message, then an error
  writeFileSync(path.join(other, 'sheet.ps'), readFileSync(path.join(root, 'lib/sheet.ps')));
  const bad = spawnSync(PSCAT, ['--pdf', path.join(tmp, 'bad.pdf'), '--read-root', other, '-e', '(sheet.ps) run'], { cwd: other, encoding: 'utf8', timeout: 60000, env: cleanEnv() });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /sm-abc: error: cannot find sm_engrave.ps; define \/sm-lib-dir/);
});

test('ABC in the program file: sm-abc-engrave-here and sm-abc-here (raw text: triplets, accents)', { skip }, () => {
  const abc = "X:1\nT:Inline (with parens) \\'e\nM:3/4\nL:1/8\nK:G\n(3GAB c2 d2 | (ed) B2 G2 | A6 |]\nw: tri-plet one two three four five\n";
  // up to the end marker, then the program goes on
  let r = pscat(`%!PS\n(lib/sheet.ps) run\n<< /footer (Inline) >> sm-abc-engrave-here\n${abc}%%SM-ABC-END\n(after) =\n`);
  assert.equal(r.out, 'after\n');
  assert.equal(pages(r.pdf), 1);
  // to the end of the file, no options
  assert.equal(pages(pscat(`(lib/sheet.ps) run\nsm-abc-engrave-here\n${abc}`).pdf), 1);
  // the text itself, exactly as written
  r = pscat(`(lib/sheet.ps) run\nsm-abc-here\n${abc}%%SM-ABC-END\ndup length = print (|) =${DOT}`);
  assert.equal(r.out, `${Buffer.byteLength(abc)}\n${abc}|\n`);
  // read once, checked and engraved
  r = pscat(`(lib/sheet.ps) run\nsm-abc-here\n${abc}%%SM-ABC-END\ndup sm-abc-check-string sm-abc-engrave-string\n`);
  assert.match(r.out, /^sm-abc: ok$/m);
  assert.equal(pages(r.pdf), 1);
});

test('sm-abc-list-file and sm-abc-check-file output', { skip }, () => {
  let { out } = pscat(`(lib/sheet.ps) run (tests/fixtures/parse-edge.abc) sm-abc-list-file${DOT}`);
  assert.deepEqual(out.trimEnd().split('\n'), [
    'sm-abc: 3 tunes',
    'sm-abc: /tune 0  X:1  "Café über & ß tra\\c cade ø"  M:5/8  K:4b  bars 13  staves 4',
    'sm-abc: /tune 1  X:2  "Second tune"  M:none  K:0  bars 4  staves 1',
    'sm-abc: /tune 2  X:3  "Third"  M:6/8  K:1#  bars 4  staves 1',
  ]);
  ({ out } = pscat(`(lib/sheet.ps) run (samples/twinkle.abc) sm-abc-check-file${DOT}`));
  assert.deepEqual(out.trimEnd().split('\n'), [
    'sm-abc: 1 tune',
    'sm-abc: /tune 0  X:1  "Twinkle, Twinkle, Little Star"  M:4/4  K:0  bars 12  staves 1',
    'sm-abc: check: 1 tune(s), 0 warning(s), 0 bar(s) off the meter',
    'sm-abc: ok',
  ]);
  // warnings, and bars that do not add up (a pickup and a short last bar are fine)
  const abc = 'X:7\\nT:Uneven\\nM:3/4\\nL:1/4\\nK:D\\nA | B c d | e f | g a b c | d2 Hh |]';
  ({ out } = pscat(`(lib/sheet.ps) run (${abc}) sm-abc-check-string${DOT}`));
  assert.deepEqual(out.trimEnd().split('\n'), [
    'sm-abc: 1 tune',
    'sm-abc: /tune 0  X:7  "Uneven"  M:3/4  K:2#  bars 5  staves 1',
    'sm-abc: warning: tune 1: skipped "h" in: A | B c d | e f | g a b c | d2 Hh |]',
    'sm-abc: bar 2: 1/2 of a whole note, M:3/4 wants 3/4',
    'sm-abc: bar 3: 1/1 of a whole note, M:3/4 wants 3/4',
    'sm-abc: check: 1 tune(s), 1 warning(s), 2 bar(s) off the meter',
  ]);
});

test('every ABC sample checks clean except the known short bar in feature-tour', { skip }, () => {
  const files = readdirSync(path.join(root, 'samples')).filter((f) => f.endsWith('.abc')).sort();
  const prog = '(lib/sheet.ps) run\n' + files.map((f) => `(samples/${f}) sm-abc-check-file`).join('\n') + DOT;
  const out = pscat(prog).out;
  assert.equal(out.match(/^sm-abc: warning/gm), null);
  assert.deepEqual(out.match(/^sm-abc: bar .*$/gm), ['sm-abc: bar 10: 7/8 of a whole note, M:3/4 wants 3/4']);
});

test('docs/postscript-api.md: the glyph example renders', { skip }, () => {
  const doc = readFileSync(path.join(root, 'docs/postscript-api.md'), 'utf8');
  const m = /<!-- example: glyph-exercise -->\n```postscript\n([\s\S]*?)```/.exec(doc);
  assert.ok(m, 'the glyph-exercise example is in the doc');
  const file = path.join(tmp, 'exercise.ps');
  writeFileSync(file, m[1]);
  const png = path.join(tmp, 'exercise.png');
  execFileSync(PSCAT, ['--lint-strict', '--page', '612x792', '--png', png, file], { cwd: root, stdio: 'pipe', timeout: 60000 });
  assert.ok(readFileSync(png).length > 5000);
});

test('docs/postscript-api.md covers every public sm- name', () => {
  assert.ok(publicNames().length > 100);
  for (const n of ['sm-abc-engrave-file', 'sm-abc-check-file', 'sm-staff', 'sm-clef-treble', 'sm-lib-dir']) {
    assert.ok(publicNames().some((p) => p.name === n), `${n} is found`);
  }
  assert.deepEqual(check(), []);
});
