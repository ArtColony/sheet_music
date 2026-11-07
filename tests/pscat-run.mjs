// Run a PostScript program with the pinned pscat CLI and return what it
// printed: the program goes in a file (not stdin, docs/FRICTION.md #11),
// the output flag is always given, and pscat's own "pscat: " lines are
// dropped (pscat#1058). The program starts in the repository root, so
// (lib/sheet.ps) run loads the whole library.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psLiteral } from '../src/ps.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
export const noPscat = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';

let tmp = null, runs = 0;
export function runPS(prog) {
  if (!tmp) { tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-run-')); process.on('exit', () => rmSync(tmp, { recursive: true, force: true })); }
  const file = path.join(tmp, `p${++runs}.ps`);
  writeFileSync(file, prog);
  const out = execFileSync(PSCAT, ['--page', '8x8', '--pdf', file.replace(/ps$/, 'pdf'), file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 64 << 20 });
  return out.split('\n').filter((l) => !l.startsWith('pscat: ')).join('\n');
}

/** Each PostScript expression's value as JSON (sm-abc-json), with the whole library loaded. */
export function psValues(exprs) {
  const out = runPS(['(lib/sheet.ps) run', ...exprs.map((e) => `${e} sm-abc-json (\\n) print`)].join('\n') + '\n');
  const lines = out.split('\n').filter((l) => l.length);
  if (lines.length !== exprs.length) throw Error(`expected ${exprs.length} values, PostScript printed:\n${out}`);
  return lines.map((l) => JSON.parse(l));
}

/** The playback events of each [text, options] (sm-abc-performance), in one pscat run. */
export function psPerformances(cases) {
  const out = runPS(['(lib/sheet.ps) run', ...cases.map(([src, opts = {}]) => `${psLiteral(src)} ${psLiteral(opts)} sm-abc-performance`)].join('\n') + '\n');
  const lines = out.split('\n').filter((l) => l.startsWith('{'));
  if (lines.length !== cases.length) throw Error(`expected ${cases.length} performances, PostScript printed:\n${out}`);
  return lines.map((l) => JSON.parse(l));
}
