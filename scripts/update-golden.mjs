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
import { selfContainedPS } from '../src/psdoc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-golden-'));
const PLATFORM = `${process.platform}-${process.arch}`;
let old = {};
try { old = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8')); } catch { /* first run */ }
const out = { pscat: readFileSync(path.join(root, '.pscat-version'), 'utf8').trim(), ps: {}, pdf: {} };
const pdfs = {};
for (const f of readdirSync(path.join(root, 'samples')).filter((x) => /\.(abc|musicxml)$/.test(x)).sort()) {
  const { ps, size } = toPostScript(readFileSync(path.join(root, 'samples', f), 'utf8'), { lib: LIB });
  out.ps[f] = sha(ps);
  const psFile = path.join(tmp, 'a.ps');
  writeFileSync(psFile, ps);
  execFileSync(PSCAT, ['--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', path.join(tmp, 'a.pdf'), psFile], { stdio: 'pipe' });
  pdfs[f] = sha(readFileSync(path.join(tmp, 'a.pdf')));
}
// The PostScript engraver's self-contained documents (tests/ps-engine.test.mjs)
const ABC_LIB = readFileSync(path.join(root, 'lib/sm_abc.ps'), 'utf8');
const PS_ENGINE_SAMPLES = ['amazing-grace.abc', 'ode-to-joy.abc', 'twinkle.abc'];
out.psEngine = { ps: {}, pdf: {} };
const pePdfs = {};
for (const f of PS_ENGINE_SAMPLES) {
  const { ps, size } = selfContainedPS(readFileSync(path.join(root, 'samples', f), 'utf8'), { engraveLib: LIB, abcLib: ABC_LIB });
  out.psEngine.ps[f] = sha(ps);
  const psFile = path.join(tmp, 'b.ps');
  writeFileSync(psFile, ps);
  execFileSync(PSCAT, ['--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', path.join(tmp, 'b.pdf'), psFile], { stdio: 'pipe' });
  pePdfs[f] = sha(readFileSync(path.join(tmp, 'b.pdf')));
}
rmSync(tmp, { recursive: true, force: true });
// PDF hashes are kept per platform; other platforms' entries are dropped when
// the PostScript changed (they no longer describe this output).
const psSame = old.ps && JSON.stringify(old.ps) === JSON.stringify(out.ps);
if (psSame && old.pdf) for (const [k, v] of Object.entries(old.pdf)) if (typeof v === 'object') out.pdf[k] = v;
out.pdf[PLATFORM] = pdfs;
const peSame = old.psEngine && JSON.stringify(old.psEngine.ps) === JSON.stringify(out.psEngine.ps);
if (peSame && old.psEngine.pdf) for (const [k, v] of Object.entries(old.psEngine.pdf)) if (typeof v === 'object') out.psEngine.pdf[k] = v;
out.psEngine.pdf[PLATFORM] = pePdfs;
writeFileSync(path.join(root, 'tests/golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`tests/golden.json: ${Object.keys(out.ps).length} samples`);
