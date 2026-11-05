// Public API, shared by the Node command line and the browser editor.
//
//   import { toPostScript } from './src/index.js';
//   const { ps, warnings, pages } = toPostScript(abcText, { lib, paper: 'a4' });
//
// `lib` is the text of lib/sm_engrave.ps (the caller loads it: from disk in
// Node, inlined in the editor). The result is one self-contained PostScript
// document that pscat (CLI or WebAssembly) renders to PNG, SVG or PDF.
import { parseABC } from './abc.js';
import { parseMusicXML } from './musicxml.js';
import { engrave, PAPERS } from './layout.js';
import { text as pstext } from './ps.js';

export const VERSION = '0.1.0';
export { parseABC, parseMusicXML, PAPERS };

/** 'abc' or 'musicxml', from the text itself. */
export function detectFormat(src) {
  const head = src.slice(0, 2000).trimStart();
  if (head.startsWith('<?xml') || /<score-partwise|<score-timewise/.test(head)) return 'musicxml';
  return 'abc';
}

/** Parse any supported notation into Scores: { scores, warnings, format }. */
export function parse(src, { format } = {}) {
  const fmt = format || detectFormat(src);
  if (fmt === 'musicxml') {
    const r = parseMusicXML(src);
    return { scores: [r.score], warnings: r.warnings, format: fmt };
  }
  if (fmt !== 'abc') throw Error(`unknown format "${fmt}" (use abc or musicxml)`);
  return { ...parseABC(src), format: fmt };
}

const psString = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, (c) => '\\' + c);

/**
 * Engrave one tune to a complete PostScript document.
 * options: lib (required), tune (index, default 0), paper ('letter'|'a4'),
 * sp (staff space in points, default 5.5), breaks ('source'|'auto'),
 * footer (credit line on the last page), format.
 */
export function toPostScript(src, options = {}) {
  if (!options.lib) throw Error('toPostScript needs options.lib: the text of lib/sm_engrave.ps');
  const parsed = parse(src, options);
  const tune = options.tune || 0;
  const score = parsed.scores[tune];
  if (!score) throw Error(`no tune number ${tune + 1} (the input has ${parsed.scores.length})`);
  const footer = options.footer !== undefined ? options.footer : defaultFooter(score);
  const r = engrave(score, { ...options, footer });
  const [W, H] = r.size;
  const title = score.meta.title || 'Untitled';
  const lines = [
    '%!PS-Adobe-3.0',
    `%%Title: ${psString(title)}`,
    `%%Creator: ArtColony sheet_music ${VERSION}`,
    score.meta.composer ? `%%For: ${psString(score.meta.composer)}` : null,
    `%%Pages: ${r.pages.length}`,
    `%%BoundingBox: 0 0 ${Math.round(W)} ${Math.round(H)}`,
    '%%EndComments',
    '%%BeginProlog',
    options.lib.trimEnd(),
    '%%EndProlog',
    '%%BeginSetup',
    `/sm-sp ${options.sp || 5.5} def`,
    '%%EndSetup',
  ].filter((l) => l !== null);
  r.pages.forEach((body, k) => {
    lines.push(`%%Page: ${k + 1} ${k + 1}`);
    lines.push(...body);
    lines.push('showpage');
  });
  lines.push('%%EOF', '');
  return {
    ps: lines.join('\n'),
    pages: r.pages.length,
    size: r.size,
    title,
    tunes: parsed.scores.map((s) => s.meta.title || 'Untitled'),
    warnings: [...parsed.warnings, ...r.warnings],
    format: parsed.format,
  };
}

function defaultFooter(score) {
  const m = score.meta;
  const parts = [];
  if (m.source) parts.push(`Source: ${m.source}`);
  if (m.transcriber) parts.push(`Transcription: ${m.transcriber}`);
  if (m.rights) parts.push(m.rights);
  return parts.join('  ·  ').replace(/·/g, '·');
}

export { pstext };
