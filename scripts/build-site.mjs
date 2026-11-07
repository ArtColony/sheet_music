// Build the GitHub Pages site into dist/:
//   index.html                      gallery of the samples (PNG previews, PDF, PS, source)
//   editor.html                     the editor: one HTML file + pscat.wasm beside it
//   sheet-music-editor-offline.html the editor with the engine inlined: works from file://
//   friction.html                   docs/FRICTION.md as a page
//   samples/                        each sample's source, .ps, .pdf and page PNGs
//   engine/                         pscat licences and notices (the wasm is at the root)
//
// Every PDF and PNG is rendered by the pinned pscat CLI (vendor/pscat), so the
// site shows exactly what `bin/sheet.mjs` produces. Run: npm run build
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parse, finishPDF, parseAnnotations, VERSION } from '../src/index.js';
import { psEngineDoc, pdfPages, psWarnings, ABC_LIB, PARSE_LIB, TRANSPOSE_LIB } from '../bin/sheet.mjs';
import { mdToHtml } from './md.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const npm = path.join(root, 'vendor/pscat-npm');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const pscatVersion = readFileSync(path.join(root, '.pscat-version'), 'utf8').trim();
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
if (!existsSync(path.join(npm, 'pscat.wasm'))) { console.error('vendor/pscat-npm missing: npm run pscat:fetch'); process.exit(1); }

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'samples'), { recursive: true });
mkdirSync(path.join(dist, 'engine'), { recursive: true });

// ------------------------------------------------------------ samples
const order = JSON.parse(readFileSync(path.join(root, 'samples/order.json'), 'utf8'));
const samples = [];
for (const file of order) {
  const text = readFileSync(path.join(root, 'samples', file), 'utf8');
  const base = file.replace(/\.[^.]+$/, '');
  // the self-contained document `sheet` writes: pscat parses, lays out and draws
  const r = psEngineDoc(text);
  const score = parse(text).scores[0];
  writeFileSync(path.join(dist, 'samples', base + '.ps'), r.ps);
  copyFileSync(path.join(root, 'samples', file), path.join(dist, 'samples', file));
  const page = `${Math.round(r.size[0])}x${Math.round(r.size[1])}`;
  const psFile = path.join(dist, 'samples', base + '.ps');
  const printed = execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', path.join(dist, 'samples', base + '.pdf'), psFile], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  for (const w of psWarnings(printed)) console.log(`${file}: warning: ${w}`);
  const pdfPath = path.join(dist, 'samples', base + '.pdf');
  const pages = pdfPages(readFileSync(pdfPath));
  writeFileSync(pdfPath, finishPDF(readFileSync(pdfPath), r, { source: text, filename: file })); // source attached
  execFileSync(PSCAT, ['--page', page, '--dpi', '110', '--png', path.join(dist, 'samples', base + '.png'), psFile], { stdio: 'pipe' });
  const pngs = pages > 1 ? Array.from({ length: pages }, (_, k) => `${base}-${String(k + 1).padStart(3, '0')}.png`) : [base + '.png'];
  samples.push({
    file, base, text, title: r.title, pages, pngs,
    format: r.format === 'musicxml' ? 'MusicXML' : 'ABC',
    composer: score.meta.composer || score.meta.origin || '',
    notes: [...features(score), ...(parseAnnotations(text).length ? ['annotations'] : [])],
    psSha: sha(r.ps), pdfSha: sha(readFileSync(path.join(dist, 'samples', base + '.pdf'))),
  });
}
function features(score) {
  const f = new Set();
  const evs = score.measures.flatMap((m) => m.staves.flatMap((s) => s.events));
  if (score.staves.length > 1) f.add(`${score.staves.length} staves`);
  if (evs.some((e) => e.lyrics)) f.add('lyrics');
  if (evs.some((e) => e.chord)) f.add('chord symbols');
  if (score.measures.some((m) => m.ending)) f.add('endings');
  else if (score.measures.some((m) => m.startRepeat || m.endBar === 'repeat-end')) f.add('repeats');
  if (evs.some((e) => e.tuplet)) f.add('tuplets');
  if (evs.some((e) => e.grace)) f.add('grace notes');
  if (evs.some((e) => e.dyn)) f.add('dynamics');
  if (evs.some((e) => e.notes && e.notes.some((n) => n.acc))) f.add('accidentals');
  if (score.staves.some((s) => s.clef.sign === 'F') && score.staves.length === 1) f.add('bass clef');
  return [...f];
}

// ------------------------------------------------------------ engine + licences
copyFileSync(path.join(npm, 'pscat.wasm'), path.join(dist, 'pscat.wasm'));
for (const f of ['LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE-OFL', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.html']) copyFileSync(path.join(npm, f), path.join(dist, 'engine', f));
copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE.txt'));

// ------------------------------------------------------------ editor (served + offline)
const modules = {};
for (const f of readdirSync(path.join(root, 'src')).filter((x) => x.endsWith('.js'))) modules['src/' + f] = readFileSync(path.join(root, 'src', f), 'utf8');
modules['site/ps-viewer.js'] = readFileSync(path.join(root, 'site/ps-viewer.js'), 'utf8');
copyFileSync(path.join(root, 'site/ps-viewer.js'), path.join(dist, 'ps-viewer.js'));
for (const f of ['index.js', 'renderer.js', 'core.js']) modules['engine/' + f] = readFileSync(path.join(npm, f), 'utf8');
const bundle = { version: VERSION, pscat: pscatVersion, lib: LIB, modules, samples: samples.map(({ file, title, text }) => ({ file, title, text })) };
const editorTpl = readFileSync(path.join(root, 'site/editor.html'), 'utf8');
const fill = (tpl, wasm) => {
  if (!tpl.includes('__SM_BUNDLE__') || !tpl.includes('__SM_WASM__')) throw Error('site/editor.html lost its placeholders');
  return tpl.replace('__SM_BUNDLE__', () => json(bundle)).replace('__SM_WASM__', () => wasm);
};
writeFileSync(path.join(dist, 'editor.html'), fill(editorTpl, ''));
const packed = gzipSync(readFileSync(path.join(npm, 'pscat.wasm')), { level: 9 }).toString('base64');
const offline = fill(editorTpl, packed).replace('<a href="index.html" id="home">', '<a href="https://artcolony.github.io/sheet_music/" id="home">');
writeFileSync(path.join(dist, 'sheet-music-editor-offline.html'), offline);

// ------------------------------------------------------------ pages
const css = readFileSync(path.join(root, 'site/site.css'), 'utf8');
const shell = (title, desc, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<style>${css}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="index.html">sheet_music</a><nav><a href="index.html#gallery">Gallery</a><a href="editor.html">Editor</a><a href="friction.html">pscat notes</a><a href="https://github.com/ArtColony/sheet_music">GitHub</a></nav></div></header>
${body}
<footer class="foot"><div class="wrap">ArtColony / sheet_music ${VERSION} · code MIT · samples CC0 1.0 (public-domain music) · rendered with <a href="https://github.com/PSCatLabs/pscat/releases/tag/v${pscatVersion}">pscat ${pscatVersion}</a> (<a href="engine/THIRD_PARTY_NOTICES.md">notices</a>)</div></footer>
<script type="module">import { wireLinks } from './ps-viewer.js'; wireLinks();</script>
</body>
</html>
`;

const cards = samples.map((s) => `
  <article class="card" id="${esc(s.base)}">
    <a class="thumb" href="samples/${esc(s.base)}.pdf"><img src="samples/${esc(s.pngs[0])}" alt="First page of ${esc(s.title)}, engraved" loading="lazy" width="935" height="1210"></a>
    <div class="meta">
      <h3>${esc(s.title)}</h3>
      <p class="by">${esc(s.composer)}</p>
      <p class="tags"><span class="fmt">${s.format}</span>${s.notes.map((n) => `<span>${esc(n)}</span>`).join('')}</p>
      <p class="links"><a href="samples/${esc(s.base)}.pdf">PDF</a> · <a class="view-ps" data-name="${esc(s.base)}.ps" href="samples/${esc(s.base)}.ps">View PostScript</a> · <a href="samples/${esc(s.file)}">${s.format} source</a> · <a href="editor.html#sample=${encodeURIComponent(s.file)}">Open in editor</a></p>
    </div>
  </article>`).join('');

const hashes = samples.map((s) => `<tr><td>${esc(s.file)}</td><td><code>${s.psSha.slice(0, 16)}…</code></td><td><code>${s.pdfSha.slice(0, 16)}…</code></td></tr>`).join('');

const index = shell('Sheet music with pscat', 'Deterministic sheet music engraving: ABC and MusicXML to PostScript to PDF, with pscat on the command line or in the browser.', `
<main>
  <section class="hero"><div class="wrap">
    <h1>Sheet music, engraved in PostScript</h1>
    <p class="lede">Write a tune in <a href="https://abcnotation.com/">ABC notation</a> (or bring MusicXML), get an engraved score as PDF. The engraver is a PostScript library: each score is one PostScript program that carries the music as text, and <a href="https://github.com/PSCatLabs/pscat">pscat</a> parses it, lays it out and draws it, either the command-line tool or the very same interpreter compiled to WebAssembly in your browser. JavaScript only plays the music and runs the page. Every glyph (clefs, noteheads, rests, accidentals) is drawn from PostScript paths, so no music font is involved.</p>
    <p class="cta"><a class="btn" href="editor.html">Open the editor</a> <a class="btn ghost" href="sheet-music-editor-offline.html" download>Download the offline editor</a> <a class="btn ghost" href="https://github.com/ArtColony/sheet_music">Source on GitHub</a></p>
  </div></section>

  <section class="wrap" id="gallery">
    <h2>Gallery</h2>
    <p>Public-domain tunes, transcribed for this project and released under CC0. Click a page for the PDF. Each was rendered by the pinned pscat ${esc(pscatVersion)} command-line tool during the site build.</p>
    <div class="grid">${cards}
    </div>
  </section>

  <section class="wrap two">
    <div>
      <h2>How it works</h2>
      <ol class="flow">
        <li><b>One program.</b> The score file is the library (<code>lib/sm_engrave.ps</code> glyphs, <code>lib/sm_abc.ps</code> layout, <code>lib/sm_abc_parse.ps</code>, <code>lib/sm_transpose.ps</code>), a short driver, and the ABC source itself after <code>currentfile</code>.</li>
        <li><b>Parse.</b> PostScript reads the ABC into one score model with exact rational durations. (MusicXML is still read by <code>src/musicxml.js</code> and embedded as a PostScript literal.)</li>
        <li><b>Lay out and draw.</b> <code>lib/sm_abc.ps</code> spaces columns by duration, justifies lines, breaks pages, beams, stacks chords and accidentals, and places lyrics, chord symbols, ties and slurs, every position rounded to two decimals.</li>
        <li><b>Render.</b> <code>pscat --pdf</code> on the command line, or <code>createRenderer().render(ps, {pdf: true})</code> in the browser. Same interpreter, same bytes. Playback reads the notes from PostScript too (<code>sm-abc-performance</code>).</li>
      </ol>
      <pre class="cmd">npm run pscat:fetch          # the pinned pscat release, SHA-256 checked
node bin/sheet.mjs samples/amazing-grace.abc -o amazing-grace.pdf</pre>
    </div>
    <div>
      <h2>Deterministic, checked</h2>
      <p>The same input gives the same PostScript bytes and the same PDF bytes, and the browser build writes exactly the PDF the command line writes. The test suite holds these hashes and checks CLI/WebAssembly parity on every sample.</p>
      <table class="hashes"><thead><tr><th>sample</th><th>PostScript SHA-256</th><th>PDF SHA-256</th></tr></thead><tbody>${hashes}</tbody></table>
    </div>
  </section>
</main>`);
writeFileSync(path.join(dist, 'index.html'), index);

const friction = mdToHtml(readFileSync(path.join(root, 'docs/FRICTION.md'), 'utf8'), (href) => {
  // drafts live in the repository, not on the site
  if (href.startsWith('issues/')) return 'https://github.com/ArtColony/sheet_music/blob/main/docs/' + href;
  return href;
});
writeFileSync(path.join(dist, 'friction.html'), shell('pscat notes', 'What was hard or missing when building a music engraver on pscat, and the issues filed upstream.', `<main class="wrap prose">${friction}</main>`));
writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`dist/: ${samples.length} samples, editor.html (${Math.round(readFileSync(path.join(dist, 'editor.html')).length / 1024)} KiB + pscat.wasm), offline editor (${Math.round(offline.length / 1048576 * 10) / 10} MiB)`);
