// Record the SHA-256 of every sample's PostScript and PDF in tests/golden.json.
// Run after an intended change to the engraving, and commit the result with
// the change (look at the renders first: npm run samples).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPostScript } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-golden-'));
const out = { pscat: readFileSync(path.join(root, '.pscat-version'), 'utf8').trim(), ps: {}, pdf: {} };
for (const f of readdirSync(path.join(root, 'samples')).filter((x) => /\.(abc|musicxml)$/.test(x)).sort()) {
  const { ps, size } = toPostScript(readFileSync(path.join(root, 'samples', f), 'utf8'), { lib: LIB });
  out.ps[f] = sha(ps);
  const psFile = path.join(tmp, 'a.ps');
  writeFileSync(psFile, ps);
  execFileSync(PSCAT, ['--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', path.join(tmp, 'a.pdf'), psFile], { stdio: 'pipe' });
  out.pdf[f] = sha(readFileSync(path.join(tmp, 'a.pdf')));
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(path.join(root, 'tests/golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`tests/golden.json: ${Object.keys(out.ps).length} samples`);
