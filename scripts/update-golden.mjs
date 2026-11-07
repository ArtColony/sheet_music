// Record the SHA-256 of the PostScript engraver's self-contained document
// (what sheet writes, psEngineDoc) and of its PDF for every sample and test
// fixture in tests/golden.json (key psEngine; tests/ps-engine.test.mjs).
// Run after an intended change to the engraving, and commit the result with
// the change (look at the renders first: npm run samples).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psEngineDoc } from '../bin/sheet.mjs';
import { GOLDEN_FILES } from './golden-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-golden-'));
const PLATFORM = `${process.platform}-${process.arch}`;
let old = {};
try { old = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8')); } catch { /* first run */ }
const out = { pscat: readFileSync(path.join(root, '.pscat-version'), 'utf8').trim(), psEngine: { ps: {}, pdf: {} } };
const pdfs = {};
for (const { key, file } of GOLDEN_FILES) {
  const { ps, size } = psEngineDoc(readFileSync(file, 'utf8'));
  out.psEngine.ps[key] = sha(ps);
  const psFile = path.join(tmp, 'a.ps');
  writeFileSync(psFile, ps);
  execFileSync(PSCAT, ['--page', `${Math.round(size[0])}x${Math.round(size[1])}`, '--pdf', path.join(tmp, 'a.pdf'), psFile], { stdio: 'pipe' });
  pdfs[key] = sha(readFileSync(path.join(tmp, 'a.pdf')));
}
rmSync(tmp, { recursive: true, force: true });
// PDF hashes are kept per platform; other platforms' entries are dropped when
// the PostScript changed (they no longer describe this output).
const same = old.psEngine && JSON.stringify(old.psEngine.ps) === JSON.stringify(out.psEngine.ps);
if (same && old.psEngine.pdf) for (const [k, v] of Object.entries(old.psEngine.pdf)) if (typeof v === 'object') out.psEngine.pdf[k] = v;
out.psEngine.pdf[PLATFORM] = pdfs;
writeFileSync(path.join(root, 'tests/golden.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`tests/golden.json: ${GOLDEN_FILES.length} files`);
