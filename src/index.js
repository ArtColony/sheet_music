// Public API, shared by the Node command line and the browser editor:
// parsing to the Score model, transposition, playback and MIDI, the source
// carried in PDFs, and reader's annotations.
//
// The engraving itself is PostScript (lib/sm_abc.ps and friends): see
// src/psdoc.js selfContainedPS, which writes one self-contained document
// that pscat (CLI or WebAssembly) renders to PNG, SVG or PDF.
import { parseABC, splitTunes } from './abc.js';
import { parseMusicXML } from './musicxml.js';
import { PAPERS } from './paper.js';
import { text as pstext, psLiteral } from './ps.js';
import { transposeScore, sourceTranspose, transposeChord, fifthsShift } from './transpose.js';
import { embedSource, extractSource, isPDF } from './pdfmeta.js';
import { performance as perform, midiFile, wholeSeconds, playOrder } from './play.js';

export const VERSION = '0.1.0';
export { parseABC, parseMusicXML, PAPERS, transposeScore, transposeChord, fifthsShift, embedSource, extractSource, isPDF, midiFile, wholeSeconds, playOrder };

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

// %%transpose in the tune, else in the ABC file header (before the first X:)
// (lib/sm_abc_parse.ps sm-abc-tune-transpose is the PostScript port)
export function tuneTranspose(src, tuneSrc, format) {
  const own = sourceTranspose(tuneSrc);
  if (own || format !== 'abc') return own;
  const x = /^X:/m.exec(src);
  return x ? sourceTranspose(src.slice(0, x.index)) : 0;
}

/**
 * What a tune sounds like (src/play.js), with the same tune choice and
 * transposition as the engraving (src/psdoc.js): { notes, length, tempo, staves, title }.
 */
export function performanceOf(src, options = {}) {
  const parsed = parse(src, options);
  const tune = options.tune || 0;
  const score = parsed.scores[tune];
  if (!score) throw Error(`no tune number ${tune + 1}`);
  const tuneSrc = parsed.format === 'abc' ? splitTunes(src)[tune] || '' : src;
  const semis = tuneTranspose(src, tuneSrc, parsed.format) + Math.trunc(options.transpose || 0);
  if (semis) transposeScore(score, semis);
  return { ...perform(score), title: score.meta.title || 'Untitled' };
}

/**
 * A PDF from pscat, with this score's source attached and document info
 * filled in (see src/pdfmeta.js). r is selfContainedPS's result (src/psdoc.js).
 */
export function finishPDF(pdf, r, { source, filename } = {}) {
  const xml = r.format === 'musicxml';
  const subject = [r.composer, r.transposed && `transposed ${r.transposed.semis > 0 ? '+' : ''}${r.transposed.semis} semitones`]
    .filter(Boolean).join('; ');
  return embedSource(pdf, {
    source,
    filename: filename || (xml ? 'score.musicxml' : 'score.abc'),
    mime: xml ? 'application/vnd.recordare.musicxml+xml' : 'text/vnd.abc',
    title: r.title,
    author: r.composer,
    subject: `Sheet music${subject ? ': ' + subject : ''}. The ${xml ? 'MusicXML' : 'ABC'} source is attached.`,
    keywords: `sheet music, ${xml ? 'MusicXML' : 'ABC notation'}`,
    creator: `ArtColony sheet_music ${VERSION}`,
  });
}

export { pstext, psLiteral };

// ------------------------------------------------------------ annotations
// A source line   %%annotation page=1 type=text x=120 y=540 color=red text="Breathe"
// (in MusicXML:   <!-- %%annotation ... -->). type is text, circle (x y w h:
// the box the ellipse fills) or highlight (x y w h). Positions are points
// from the page's lower-left corner. Colour: a name below or #rrggbb.
export const ANNOT_COLORS = { red: '#c0392b', blue: '#1f5fbf', green: '#2e7d32', orange: '#d35400', purple: '#7b3fa0', yellow: '#e0b000', black: '#222222' };
const ANNOT_RE = /^[ \t]*(?:<!--[ \t]*)?%%annotation[ \t]+(.*?)[ \t]*(?:-->)?[ \t]*$/;

function hexRgb(c) {
  const hex = ANNOT_COLORS[c] || c;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return [0.75, 0.22, 0.17];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000);
}

/** Every %%annotation in a text: [{ line, page, type, x, y, w, h, color, rgb, text }]. */
export function parseAnnotations(src) {
  const out = [];
  String(src).replace(/\r\n?/g, '\n').split('\n').forEach((l, line) => {
    const m = ANNOT_RE.exec(l);
    if (!m) return;
    const kv = {};
    m[1].replace(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g, (_, k, q, v) => { kv[k] = q !== undefined ? q.replace(/\\(.)/g, '$1') : v; return ''; });
    const n = (k, d = 0) => (Number.isFinite(parseFloat(kv[k])) ? parseFloat(kv[k]) : d);
    const type = ['text', 'circle', 'highlight'].includes(kv.type) ? kv.type : 'text';
    out.push({ line, page: Math.max(1, Math.round(n('page', 1))), type, x: n('x'), y: n('y'), w: n('w', 40), h: n('h', 20), color: kv.color || (type === 'highlight' ? 'yellow' : 'red'), rgb: hexRgb(kv.color || (type === 'highlight' ? 'yellow' : 'red')), text: kv.text || '' });
  });
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;
/** The source line for an annotation (format: 'abc' or 'musicxml'). */
export function annotationLine(a, format = 'abc') {
  const parts = [`page=${a.page || 1}`, `type=${a.type || 'text'}`, `x=${r1(a.x)}`, `y=${r1(a.y)}`];
  if (a.type === 'circle' || a.type === 'highlight') parts.push(`w=${r1(a.w)}`, `h=${r1(a.h)}`);
  if (a.color) parts.push(`color=${a.color}`);
  if (a.type === 'text' || !a.type) parts.push(`text="${String(a.text || '').replace(/["\\]/g, (c) => '\\' + c).replace(/\n/g, ' ')}"`);
  const body = `%%annotation ${parts.join(' ')}`;
  return format === 'musicxml' ? `<!-- ${body.replace(/--/g, '- -')} -->` : body;
}

/** The %%annotation marks of tune `tune` (0-based) of a source, lines counted from that tune's X: (as removeAnnotation takes them). */
export function tuneAnnotations(src, tune = 0) {
  return parseAnnotations(detectFormat(src) === 'abc' ? splitTunes(src)[tune] || '' : src);
}

/** Insert an annotation into the source: at the end of tune `tune` (ABC) or before </score-partwise>. */
export function addAnnotation(src, a, { tune = 0 } = {}) {
  const format = detectFormat(src);
  const line = annotationLine(a, format);
  if (format === 'musicxml') {
    const i = src.lastIndexOf('</score-partwise>');
    return i < 0 ? src + '\n' + line + '\n' : src.slice(0, i) + line + '\n' + src.slice(i);
  }
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const starts = lines.map((l, i) => (/^X:/.test(l) ? i : -1)).filter((i) => i >= 0);
  let end = starts.length > tune + 1 ? starts[tune + 1] : lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, line);
  return lines.join('\n');
}

/** Remove the annotation on source line `line` (0-based, from parseAnnotations of the same text). */
export function removeAnnotation(src, line, tune = 0) {
  const fmt = detectFormat(src);
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let offset = 0;
  if (fmt === 'abc') { const starts = lines.map((l, i) => (/^X:/.test(l) ? i : -1)).filter((i) => i >= 0); if (starts.length > tune) offset = starts[tune]; }
  const i = line + offset;
  if (ANNOT_RE.test(lines[i] || '')) lines.splice(i, 1);
  return lines.join('\n');
}
