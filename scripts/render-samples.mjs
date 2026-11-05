// Render every sample (or the files given) to renders/<name>.{ps,pdf,png}
// with the pinned pscat CLI, linted, plus renders/contact-sheet.png of all
// first pages: the quick visual check after any engraving change.
//
//   node scripts/render-samples.mjs                 all samples
//   node scripts/render-samples.mjs my-tune.abc     just these
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPostScript } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const out = path.join(root, 'renders');
mkdirSync(out, { recursive: true });
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(path.join(root, 'samples')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort().map((f) => path.join(root, 'samples', f));
const pss = [];
for (const file of files) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const r = toPostScript(readFileSync(file, 'utf8'), { lib: LIB });
  for (const w of r.warnings) console.log(`${base}: warning: ${w}`);
  const ps = path.join(out, base + '.ps');
  writeFileSync(ps, r.ps);
  const page = `${Math.round(r.size[0])}x${Math.round(r.size[1])}`;
  execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', path.join(out, base + '.pdf'), ps], { stdio: 'inherit' });
  execFileSync(PSCAT, ['--page', page, '--dpi', '110', '--png', path.join(out, base + '.png'), ps], { stdio: 'pipe' });
  console.log(`${base}: ${r.pages} page(s) -> renders/${base}.{ps,pdf,png}`);
  pss.push(ps);
}
if (pss.length > 1) {
  execFileSync(PSCAT, ['sheet', '--dpi', '60', ...pss, '-o', path.join(out, 'contact-sheet.png')], { stdio: 'pipe' });
  console.log('contact sheet: renders/contact-sheet.png');
}
