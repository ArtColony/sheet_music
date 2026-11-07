// A self-contained PostScript document that engraves itself in pscat:
// DSC header + lib/sm_engrave.ps + lib/sm_abc.ps + lib/sm_abc_parse.ps
// (+ lib/sm_transpose.ps, and lib/sm_musicxml.ps for MusicXML) + a short
// driver + the source text after `currentfile`.
//
// The driver reads the source lines up to END_MARK and hands them to
// sm-abc-engrave-string (or sm-musicxml-engrave-string): PostScript parses
// the text, applies options.transpose plus any %%transpose line, lays the
// score out and draws it. No JavaScript parser is involved (src/abc.js and
// src/musicxml.js were retired in #10).
//
// What the header and the caller need to know about the score (title,
// composer, the key after transposition, the tunes, the annotations, the
// warnings) comes from PostScript as well: metaPS() writes a small document
// that prints it as one JSON line (lib/sm_abc_parse.ps sm-score-meta), the
// caller runs it in pscat and readMeta() turns the output into options.meta.
import { detectFormat } from './index.js';
import { PAPERS } from './paper.js';
import { psLiteral } from './ps.js';

export const END_MARK = '%%SM-ABC-END';
const dscText = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
const checkSource = (src) => { if (src.split(/\r?\n/).some((l) => l === END_MARK)) throw Error(`the source contains the line ${END_MARK}`); };
const sourceText = (src) => src.replace(/\r\n?/g, '\n').replace(/\n$/, '');

/**
 * A document that prints what sm-score-meta knows about the source: one
 * JSON line, nothing else; it draws nothing. options: abcLib (lib/sm_abc.ps,
 * for its source reader) and parseLib (lib/sm_abc_parse.ps), both required;
 * transposeLib, musicxmlLib (embedded for a MusicXML source); tune,
 * transpose, format. Run it in pscat (any page size) and give what it
 * printed to readMeta().
 */
export function metaPS(src, options = {}) {
  const { abcLib, parseLib, transposeLib, musicxmlLib } = options;
  if (!abcLib || !parseLib) throw Error('metaPS needs options.abcLib and options.parseLib');
  checkSource(src);
  const format = options.format || detectFormat(src);
  const optSemis = Math.trunc(options.transpose || 0);
  const opt = `<< /tune ${Math.trunc(options.tune || 0)} /format ${psLiteral(format)}${optSemis ? ' /transpose ' + optSemis : ''} >>`;
  return [
    '%!PS-Adobe-3.0',
    '%%Title: score metadata',
    '%%Creator: ArtColony sheet_music (PostScript engraver)',
    '%%EndComments',
    '%%BeginProlog',
    abcLib.trimEnd(),
    parseLib.trimEnd(),
    transposeLib ? transposeLib.trimEnd() : null,
    format === 'musicxml' && musicxmlLib ? musicxmlLib.trimEnd() : null,
    '%%EndProlog',
    `currentfile (${END_MARK}) sm-abc-readsrc`,
    sourceText(src),
    END_MARK,
    `${opt} sm-score-meta`,
    '%%EOF',
    '',
  ].filter((l) => l !== null).join('\n');
}

/** The metadata a metaPS() document printed (pscat's own "pscat: " lines are skipped). */
export function readMeta(out) {
  const lines = String(out || '').split('\n').filter((l) => !l.startsWith('pscat: '));
  const line = [...lines].reverse().find((l) => l.startsWith('{"'));
  if (!line) throw Error(`PostScript printed no score metadata${lines.some((l) => l.trim()) ? ': ' + lines.find((l) => l.trim()) : ''}`);
  return JSON.parse(line);
}

/**
 * options: engraveLib (lib/sm_engrave.ps text), abcLib (lib/sm_abc.ps) and
 * parseLib (lib/sm_abc_parse.ps), all required; musicxmlLib
 * (lib/sm_musicxml.ps), required for a MusicXML source; meta (readMeta() of
 * the metaPS() document for the same source and options), required unless
 * perform is set; transposeLib (lib/sm_transpose.ps, optional: without it
 * pscat runs it from lib/ when the score needs transposing); tune, paper
 * ('letter'|'a4'), sp, breaks, footer, format, transpose (semitones, added to
 * any %%transpose line); perform (with performLib, lib/sm_perform.ps:
 * instead of drawing, the document prints the tune's playback events as one
 * JSON line, sm-abc-performance; it needs no meta, only the format, which
 * comes from options.format or the text).
 * Returns { ps, size, title, composer, format, warnings, transposed, tunes, annotations, meta }.
 */
export function selfContainedPS(src, options = {}) {
  const { engraveLib, abcLib, parseLib, transposeLib, performLib, musicxmlLib } = options;
  if (options.perform && !performLib) throw Error('selfContainedPS: perform needs options.performLib');
  if (!engraveLib || !abcLib || !parseLib) throw Error('selfContainedPS needs options.engraveLib, options.abcLib and options.parseLib');
  checkSource(src);
  const tune = options.tune || 0;
  const meta = options.meta || null;
  if (!meta && !options.perform) throw Error('selfContainedPS needs options.meta: readMeta() of the metaPS() document');
  if (meta && meta.error) throw Error(meta.error);
  const format = meta ? meta.format : options.format || detectFormat(src);
  if (format === 'musicxml' && !musicxmlLib) throw Error('selfContainedPS: a MusicXML source needs options.musicxmlLib');
  // reader's %%annotation marks: drawn by sm-abc-engrave from its options
  const annotations = meta ? meta.annotations.map((a) => ({ page: a.page, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, rgb: a.rgb, text: a.text })) : [];
  // transposition: the option goes to sm-abc-engrave-string, which adds the
  // source's %%transpose itself
  const optSemis = Math.trunc(options.transpose || 0);
  const paper = PAPERS[options.paper] ? options.paper : 'letter';
  const [W, H] = PAPERS[paper];
  const sp = options.sp || 5.5;
  const optLit = '<< /paper /' + paper + ' /staff-space ' + psLiteral(sp)
    + ' /breaks ' + psLiteral(options.breaks || 'source') + ' /tune ' + tune + ' /format ' + psLiteral(format)
    + (options.footer !== undefined ? ' /footer ' + psLiteral(String(options.footer)) : '')
    + (annotations.length ? ' /annotations ' + psLiteral(annotations) : '')
    + (optSemis ? ' /transpose ' + optSemis : '') + ' >>';
  const title = (meta && meta.title) || 'Untitled';
  const composer = (meta && meta.composer) || '';
  const xml = format === 'musicxml';
  const call = options.perform ? 'sm-abc-performance' : xml ? 'sm-musicxml-engrave-string' : 'sm-abc-engrave-string';
  const lines = [
    '%!PS-Adobe-3.0',
    `%%Title: ${dscText(title)}`,
    `%%Creator: ArtColony sheet_music (PostScript engraver)`,
    composer ? `%%For: ${dscText(composer)}` : null,
    `%%BoundingBox: 0 0 ${Math.round(W)} ${Math.round(H)}`,
    '%%EndComments',
    '%%BeginProlog',
    engraveLib.trimEnd(),
    abcLib.trimEnd(),
    parseLib.trimEnd(),
    transposeLib ? transposeLib.trimEnd() : null,
    options.perform ? performLib.trimEnd() : null,
    xml ? musicxmlLib.trimEnd() : null,
    '%%EndProlog',
    '%%BeginSetup',
    `/sm-sp ${sp} def`,
    `/sm-abc-options ${optLit} def`,
    '%%EndSetup',
    `% The ${xml ? 'MusicXML' : 'ABC'} source follows, up to the line ${END_MARK}.`,
    `currentfile (${END_MARK}) sm-abc-readsrc`,
    sourceText(src),
    END_MARK,
    '/sm-abc-source exch def',
    `sm-abc-source sm-abc-options ${call}`,
    '%%EOF',
    '',
  ].filter((l) => l !== null);
  // what the PostScript engraver will print, for the caller's messages and
  // the PDF's Subject
  return {
    ps: lines.join('\n'), size: [W, H], title, composer, format,
    warnings: meta ? [...meta.warnings] : [], transposed: meta ? meta.transposed : null,
    tunes: meta ? meta.tunes.map((t) => t.title) : [], annotations: meta ? meta.annotations : [], meta,
  };
}
