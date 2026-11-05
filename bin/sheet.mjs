#!/usr/bin/env node
// sheet: ABC / MusicXML in, PostScript / PDF / PNG / SVG out.
//
//   sheet song.abc                       -> song.pdf (next to the input)
//   sheet song.abc -o out.pdf            PDF via the pscat command-line tool
//   sheet song.abc -o out.png --dpi 150  PNG of page 1 (more pages: out-2.png ...)
//   sheet song.abc -o out.ps             just the PostScript
//   sheet song.musicxml --paper a4 --engine wasm
//
// Options: --tune N (1-based, for files with several X: tunes), --paper
// letter|a4, --staff-space PT, --breaks source|auto, --engine cli|wasm,
// --footer TEXT, --format abc|musicxml, --list (print the tunes and exit).
// The pscat binary comes from $PSCAT, else vendor/pscat/pscat
// (npm run pscat:fetch), else `pscat` on PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPostScript, parse } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');

export function pscatPath() {
  if (process.env.PSCAT) return process.env.PSCAT;
  const v = path.join(root, 'vendor/pscat/pscat');
  if (existsSync(v)) return v;
  return 'pscat';
}

function usage(code) {
  console.error('usage: sheet INPUT [-o OUT.(pdf|png|svg|ps)] [--tune N] [--paper letter|a4] [--staff-space PT] [--breaks source|auto] [--engine cli|wasm] [--dpi N] [--footer TEXT] [--list]');
  process.exit(code);
}

async function main(argv) {
  const opts = { engine: 'cli', dpi: 150 };
  let input = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) usage(2); return argv[++i]; };
    if (a === '-o' || a === '--out') opts.out = next();
    else if (a === '--tune') opts.tune = parseInt(next(), 10) - 1;
    else if (a === '--paper') opts.paper = next();
    else if (a === '--staff-space') opts.sp = parseFloat(next());
    else if (a === '--breaks') opts.breaks = next();
    else if (a === '--engine') opts.engine = next();
    else if (a === '--dpi') opts.dpi = parseInt(next(), 10);
    else if (a === '--footer') opts.footer = next();
    else if (a === '--format') opts.format = next();
    else if (a === '--list') opts.list = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (!input) input = a;
    else usage(2);
  }
  if (!input) usage(2);
  const src = readFileSync(input, 'utf8');
  if (opts.list) {
    parse(src, opts).scores.forEach((s, k) => console.log(`${k + 1}\t${s.meta.title || 'Untitled'}`));
    return;
  }
  const out = opts.out || input.replace(/\.[^.]+$/, '') + '.pdf';
  const r = toPostScript(src, { ...opts, lib: LIB });
  for (const w of r.warnings) console.error(`sheet: warning: ${w}`);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const ext = path.extname(out).toLowerCase();
  if (ext === '.ps') { writeFileSync(out, r.ps); console.error(`sheet: wrote ${out} (${r.pages} page${r.pages > 1 ? 's' : ''})`); return; }
  const [W, H] = r.size;
  if (opts.engine === 'wasm') {
    const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
    const renderer = await createRenderer();
    if (ext === '.pdf') { renderer.render(r.ps, { width: W, height: H, pdf: true }); writeFileSync(out, renderer.pdf()); }
    else if (ext === '.svg') { renderer.render(r.ps, { width: W, height: H, svg: true }); writeSvgs(out, renderer.svgPages()); }
    else throw Error('--engine wasm writes .pdf, .svg or .ps');
  } else {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
    try {
      const psFile = path.join(tmp, 'score.ps');
      writeFileSync(psFile, r.ps);
      const flag = ext === '.pdf' ? '--pdf' : ext === '.svg' ? '--svg' : ext === '.png' ? '--png' : null;
      if (!flag) throw Error(`unknown output type ${ext} (use .pdf, .png, .svg or .ps)`);
      const args = ['--page', `${Math.round(W)}x${Math.round(H)}`, flag, path.resolve(out), psFile];
      if (ext === '.png') args.unshift('--dpi', String(opts.dpi));
      execFileSync(pscatPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  console.error(`sheet: wrote ${out} (${r.pages} page${r.pages > 1 ? 's' : ''})`);
}

function writeSvgs(out, svgs) {
  svgs.forEach((s, k) => writeFileSync(k === 0 ? out : out.replace(/\.svg$/, `-${k + 1}.svg`), s));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`sheet: ${e.message}`); process.exit(1); });
}
void readdirSync;
