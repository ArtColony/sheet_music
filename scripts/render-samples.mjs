// Render every sample (or the files given) to renders/<name>.{ps,pdf,png}
// with the pinned pscat CLI, linted, plus renders/contact-sheet.png of all
// first pages: the quick visual check after any engraving change.
//
//   node scripts/render-samples.mjs                 all samples, PostScript engraver
//   node scripts/render-samples.mjs my-tune.abc     just these
//   node scripts/render-samples.mjs --js            the JavaScript layout (src/layout.js) instead
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPostScript } from '../src/index.js';
import { psEngineDoc, pdfPages, psWarnings } from '../bin/sheet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const out = path.join(root, 'renders');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const js = args.includes('--js');
const named = args.filter((a) => a !== '--js');
const files = named.length ? named : readdirSync(path.join(root, 'samples')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort().map((f) => path.join(root, 'samples', f));
const pss = [];
for (const file of files) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const src = readFileSync(file, 'utf8');
  const r = js ? toPostScript(src, { lib: LIB }) : psEngineDoc(src);
  if (js || r.format !== 'abc') for (const w of r.warnings) console.log(`${base}: warning: ${w}`);
  const ps = path.join(out, base + '.ps');
  writeFileSync(ps, r.ps);
  const page = `${Math.round(r.size[0])}x${Math.round(r.size[1])}`;
  const printed = execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', path.join(out, base + '.pdf'), ps], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (!js) for (const w of psWarnings(printed)) console.log(`${base}: warning: ${w}`);
  execFileSync(PSCAT, ['--page', page, '--dpi', '110', '--png', path.join(out, base + '.png'), ps], { stdio: 'pipe' });
  console.log(`${base}: ${pdfPages(readFileSync(path.join(out, base + '.pdf')))} page(s) -> renders/${base}.{ps,pdf,png}${js ? ' (JS layout)' : ''}`);
  pss.push(ps);
}
if (pss.length > 1) {
  execFileSync(PSCAT, ['sheet', '--dpi', '60', ...pss, '-o', path.join(out, 'contact-sheet.png')], { stdio: 'pipe' });
  console.log('contact sheet: renders/contact-sheet.png');
}
