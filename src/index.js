// Public API, shared by the Node command line and the browser editor: the
// format of a text, MIDI from the notes PostScript plays, the source carried
// in PDFs, and editing the reader's annotations in the source.
//
// Parsing, layout, transposition and playback are PostScript (lib/*.ps):
// src/psdoc.js selfContainedPS writes one self-contained document that pscat
// (CLI or WebAssembly) parses and renders to PNG, SVG or PDF, and metaPS one
// that prints what the score is (title, tunes, annotations, warnings).
import { PAPERS } from './paper.js';
import { text as pstext, psLiteral } from './ps.js';
import { embedSource, extractSource, isPDF } from './pdfmeta.js';
import { midiFile, wholeSeconds } from './play.js';

export const VERSION = '0.1.0';
export { PAPERS, embedSource, extractSource, isPDF, midiFile, wholeSeconds };

/** 'abc' or 'musicxml', from the text itself (lib/sm_abc_parse.ps tells them apart the same way). */
export function detectFormat(src) {
  const head = src.slice(0, 2000).trimStart();
  if (head.startsWith('<?xml') || /<score-partwise|<score-timewise/.test(head)) return 'musicxml';
  return 'abc';
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
// PostScript reads them (lib/sm_abc_parse.ps; sm-score-meta lists them with
// their source lines); these functions only write and remove the lines.
export const ANNOT_COLORS = { red: '#c0392b', blue: '#1f5fbf', green: '#2e7d32', orange: '#d35400', purple: '#7b3fa0', yellow: '#e0b000', black: '#222222' };
const ANNOT_RE = /^[ \t]*(?:<!--[ \t]*)?%%annotation[ \t]+(.*?)[ \t]*(?:-->)?[ \t]*$/;

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

/** Remove the annotation on source line `line` (0-based, counted from tune `tune`'s X: line, as sm-score-meta's annotations give it). */
export function removeAnnotation(src, line, tune = 0) {
  const fmt = detectFormat(src);
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let offset = 0;
  if (fmt === 'abc') { const starts = lines.map((l, i) => (/^X:/.test(l) ? i : -1)).filter((i) => i >= 0); if (starts.length > tune) offset = starts[tune]; }
  const i = line + offset;
  if (ANNOT_RE.test(lines[i] || '')) lines.splice(i, 1);
  return lines.join('\n');
}
