#!/usr/bin/env node
// sheet: ABC / MusicXML in, PostScript / PDF / PNG / SVG out.
//
//   sheet song.abc                       -> song.pdf (next to the input)
//   sheet song.abc -o out.pdf            PDF via the pscat command-line tool
//   sheet song.abc -o out.png --dpi 150  PNG of page 1 (more pages: out-002.png ...)
//   sheet song.abc -o out.ps             the self-contained PostScript (engraves itself in pscat)
//   sheet song.abc -o out.mid            a MIDI file, from the notes PostScript plays (sm-abc-performance)
//   sheet song.musicxml --paper a4 --engine ps-wasm
//   sheet song.abc --transpose -2 -o song-in-Bb.pdf
//   sheet song.pdf -o song.abc           get the source back out of a PDF
//
// The engraver is the PostScript library (lib/sm_abc.ps and friends): the
// output .ps carries it, a short driver and the source itself, and pscat
// parses (ABC, and MusicXML with lib/sm_musicxml.ps), lays out and draws the
// score. The JS parser's Score literal is embedded only when no PostScript
// parser is available. (The JavaScript layout, src/layout.js, and its
// --engine js / js-wasm were retired in #10.)
//
// PDFs carry their source as an attachment (src/pdfmeta.js), so a PDF made
// here is also an input: it is read back and engraved again (or, with an
// .abc/.musicxml output, just unpacked). --no-source leaves it out.
// Options: --tune N (1-based, for files with several X: tunes), --paper
// letter|a4, --staff-space PT, --breaks source|auto, --engine ps|ps-wasm
// (ps, the default: rendered by the pscat CLI; ps-wasm: by its WebAssembly
// build; cli and wasm are older names for ps and ps-wasm), --footer TEXT, --format abc|musicxml, --transpose SEMITONES,
// --no-source, --list (print the tunes and exit).
// The pscat binary comes from $PSCAT, else vendor/pscat/pscat
// (npm run pscat:fetch), else `pscat` on PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, finishPDF, extractSource, isPDF, detectFormat, midiFile } from '../src/index.js';
import { selfContainedPS } from '../src/psdoc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
export const ABC_LIB = readFileSync(path.join(root, 'lib/sm_abc.ps'), 'utf8');
const optional = (f) => (existsSync(path.join(root, 'lib', f)) ? readFileSync(path.join(root, 'lib', f), 'utf8') : null);
export const PARSE_LIB = optional('sm_abc_parse.ps');
export const TRANSPOSE_LIB = optional('sm_transpose.ps');
export const PERFORM_LIB = optional('sm_perform.ps');
export const MUSICXML_LIB = optional('sm_musicxml.ps');

/**
 * The self-contained PostScript-engraver document for src (src/psdoc.js):
 * what `sheet` writes and renders by default. ABC is parsed by PostScript;
 * MusicXML too (lib/sm_musicxml.ps); the JS parser's Score is embedded only
 * when no PostScript parser is available (or with noParser).
 */
export function psEngineDoc(src, opts = {}) {
  const parseLib = opts.noParser ? null : PARSE_LIB;
  const musicxmlLib = opts.noParser ? null : MUSICXML_LIB;
  const format = opts.format || detectFormat(src);
  const embedScore = opts.embedScore ?? (!parseLib || (format !== 'abc' && !(format === 'musicxml' && musicxmlLib)));
  return selfContainedPS(src, { ...opts, embedScore, engraveLib: LIB, abcLib: ABC_LIB, parseLib, transposeLib: TRANSPOSE_LIB, performLib: PERFORM_LIB, musicxmlLib });
}
/** The performance JSON line a perform document printed (sm-abc-performance). */
export function performanceFromOutput(out) {
  const line = String(out || '').split('\n').reverse().find((l) => l.startsWith('{"'));
  if (!line) throw Error(`PostScript printed no performance${out ? ': ' + String(out).trim().split('\n').pop() : ''}`);
  return JSON.parse(line);
}
/** Pages in a PDF pscat wrote. */
export const pdfPages = (pdf) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
/** The warnings the PostScript engraver printed ("sm-abc: warning: ..." lines). */
export const psWarnings = (out) => String(out || '').split('\n').filter((l) => l.startsWith('sm-abc: warning: ')).map((l) => l.slice(17));

export function pscatPath() {
  if (process.env.PSCAT) return process.env.PSCAT;
  const v = path.join(root, 'vendor/pscat/pscat');
  if (existsSync(v)) return v;
  return 'pscat';
}

// --engine: which pscat renders the PostScript engraver's document (cli and
// wasm are the older names). js and js-wasm, the JavaScript layout, are gone.
export const ENGINES = {
  ps: { render: 'cli' }, 'ps-wasm': { render: 'wasm' },
  cli: { render: 'cli' }, wasm: { render: 'wasm' },
};
const RETIRED_ENGINES = new Set(['js', 'js-wasm']);

function usage(code) {
  console.error('usage: sheet INPUT [-o OUT.(pdf|png|svg|ps|mid)] [--tune N] [--paper letter|a4] [--staff-space PT] [--breaks source|auto] [--engine ps|ps-wasm] [--transpose N] [--dpi N] [--footer TEXT] [--no-source] [--list]\n       sheet SCORE.pdf -o SOURCE.abc     (unpack the source a PDF carries)');
  process.exit(code);
}

async function main(argv) {
  const opts = { engine: 'ps', dpi: 150 };
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
    else if (a === '--transpose') opts.transpose = parseInt(next(), 10);
    else if (a === '--no-source') opts.noSource = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (!input) input = a;
    else usage(2);
  }
  if (!input) usage(2);
  const engine = ENGINES[opts.engine];
  if (RETIRED_ENGINES.has(opts.engine)) throw Error(`--engine ${opts.engine} is gone: the JavaScript layout (src/layout.js) was retired; the PostScript engraver draws the same pages (use --engine ps or ps-wasm)`);
  if (!engine) throw Error(`unknown engine "${opts.engine}" (use ps or ps-wasm)`);
  let src;
  let srcName = path.basename(input);
  const bytes = readFileSync(input);
  if (isPDF(bytes)) {
    const got = extractSource(bytes);
    if (!got) throw Error(`${input} has no attached source (only PDFs made by this project do)`);
    src = got.text; srcName = got.filename;
    const oext = opts.out && path.extname(opts.out).toLowerCase();
    if (!opts.out || ['.abc', '.musicxml', '.xml', '.txt'].includes(oext)) {
      const out = opts.out || path.join(path.dirname(input), srcName);
      if (path.resolve(out) === path.resolve(input)) throw Error('refusing to overwrite the input');
      writeFileSync(out, src);
      console.error(`sheet: wrote ${out} (the source attached to ${input})`);
      return;
    }
  } else src = bytes.toString('utf8');
  if (opts.list) {
    parse(src, opts).scores.forEach((s, k) => console.log(`${k + 1}\t${s.meta.title || 'Untitled'}`));
    return;
  }
  const out = opts.out || input.replace(/\.[^.]+$/, '') + '.pdf';
  const ext = path.extname(out).toLowerCase();
  if (ext === '.mid' || ext === '.midi') return writeMidi(src, out, opts, engine);
  const r = psEngineDoc(src, opts);
  // The PostScript engraver parses ABC itself and prints its warnings as it
  // runs (relayed below). The JS parser's are shown for MusicXML and for a
  // .ps output, which nothing runs here.
  if (r.format !== 'abc' || ext === '.ps') for (const w of r.warnings) console.error(`sheet: warning: ${w}`);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  if (ext === '.ps') {
    writeFileSync(out, r.ps);
    console.error(`sheet: wrote ${out} (self-contained, engraves itself in pscat)`);
    return;
  }
  const finish = (pdf) => (opts.noSource ? pdf : finishPDF(pdf, r, { source: src, filename: srcName }));
  const [W, H] = r.size;
  let pages = 0;
  let printed = '';
  if (engine.render === 'wasm') {
    const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
    const renderer = await createRenderer();
    if (ext === '.pdf') { printed = renderer.render(r.ps, { width: W, height: H, pdf: true }).output; const pdf = renderer.pdf(); pages = pdfPages(pdf); writeFileSync(out, finish(pdf)); }
    else if (ext === '.svg') { printed = renderer.render(r.ps, { width: W, height: H, svg: true }).output; const s = renderer.svgPages(); pages = s.length; writeSvgs(out, s); }
    else throw Error(`--engine ${opts.engine} writes .pdf, .svg or .ps`);
  } else {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
    try {
      const psFile = path.join(tmp, 'score.ps');
      writeFileSync(psFile, r.ps);
      const flag = ext === '.pdf' ? '--pdf' : ext === '.svg' ? '--svg' : ext === '.png' ? '--png' : null;
      if (!flag) throw Error(`unknown output type ${ext} (use .pdf, .png, .svg or .ps)`);
      const args = ['--page', `${Math.round(W)}x${Math.round(H)}`, flag, path.resolve(out), psFile];
      if (ext === '.png') args.unshift('--dpi', String(opts.dpi));
      printed = execFileSync(pscatPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      if (ext === '.pdf') { const pdf = readFileSync(out); pages = pdfPages(pdf); writeFileSync(out, finish(pdf)); }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  for (const w of psWarnings(printed)) console.error(`sheet: warning: ${w}`);
  const notes = [pages ? `${pages} page${pages > 1 ? 's' : ''}` : '', transposedNote(r)].filter(Boolean).join(', ');
  console.error(`sheet: wrote ${out}${notes ? ` (${notes})` : ''}, PostScript engraver`);
}

// .mid: the notes as PostScript plays them (lib/sm_perform.ps) into a
// Standard MIDI File (src/play.js midiFile).
async function writeMidi(src, out, opts, engine) {
  const doc = psEngineDoc(src, { ...opts, perform: true });
  let printed;
  if (engine.render === 'wasm') {
    const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
    printed = (await createRenderer()).render(doc.ps, { width: 8, height: 8 }).output;
  } else {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
    try {
      const psFile = path.join(tmp, 'perform.ps');
      writeFileSync(psFile, doc.ps);
      printed = execFileSync(pscatPath(), ['--page', '8x8', '--pdf', path.join(tmp, 'blank.pdf'), psFile], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 << 20 });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  const perf = performanceFromOutput(printed);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, midiFile(perf, { title: perf.title }));
  console.error(`sheet: wrote ${out} (${perf.notes.length} notes, ${perf.staves} track${perf.staves > 1 ? 's' : ''})`);
}

const transposedNote = (r) => (r.transposed ? `transposed ${r.transposed.semis > 0 ? '+' : ''}${r.transposed.semis}: key signature of ${r.transposed.key} major` : '');

function writeSvgs(out, svgs) {
  svgs.forEach((s, k) => writeFileSync(k === 0 ? out : out.replace(/\.svg$/, `-${k + 1}.svg`), s));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`sheet: ${e.message}`); process.exit(1); });
}
