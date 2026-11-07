// A self-contained PostScript document that engraves itself in pscat:
// DSC header + lib/sm_engrave.ps + lib/sm_abc.ps (+ lib/sm_abc_parse.ps,
// lib/sm_transpose.ps and, for MusicXML, lib/sm_musicxml.ps when available)
// + a short driver + the source text after `currentfile`.
//
// The driver reads the source lines up to END_MARK. When sm-abc-parse is
// defined (lib/sm_abc_parse.ps loaded) and the source is ABC, PostScript
// parses it; MusicXML likewise when lib/sm_musicxml.ps is embedded (with
// lib/sm_abc_parse.ps, which reads its %%transpose/%%annotation comments).
// Otherwise it engraves the Score literal the JS parser wrote
// (src/ps.js psLiteral), which is embedded as a fallback. Either way the
// layout and drawing are lib/sm_abc.ps's. Transposition (options.transpose
// plus any %%transpose line) is done in PostScript too: the options carry
// /transpose, sm-abc-engrave-string adds the source's %%transpose, and the
// Score literal fallback gets the total.
//
// What the header and the caller need to know about the score (title,
// composer, the key after transposition, the tunes, the annotations, the
// warnings) comes from PostScript as well: metaPS() writes a small document
// that prints it as one JSON line (lib/sm_abc_parse.ps sm-score-meta), the
// caller runs it in pscat and readMeta() turns the output into options.meta.
// Only the Score-literal fallback (embedScore) runs the JS parser.
import { parse, detectFormat, scoreMeta } from './index.js';
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
 * options: engraveLib (lib/sm_engrave.ps text, required), abcLib
 * (lib/sm_abc.ps, required), meta (readMeta() of the metaPS() document for
 * the same source and options: required unless the Score literal is
 * embedded or perform is set), parseLib (lib/sm_abc_parse.ps, optional),
 * transposeLib (lib/sm_transpose.ps, optional; without it pscat runs it from
 * lib/ when the score needs transposing), musicxmlLib (lib/sm_musicxml.ps,
 * optional: embedded, with parseLib, for a MusicXML source), tune, paper ('letter'|'a4'), sp,
 * breaks, footer, format, transpose (semitones, added to any %%transpose
 * line), embedScore (default true: embed the JS parser's Score literal, the
 * fallback for a document without the PostScript parser; options.score
 * gives it, else src/index.js parses the source, and its scoreMeta stands
 * in for a missing meta), perform (with performLib, lib/sm_perform.ps:
 * instead of drawing, the document prints the tune's playback events as one
 * JSON line, sm-abc-performance).
 * Returns { ps, size, title, composer, format, warnings, transposed, tunes, annotations, meta }.
 */
export function selfContainedPS(src, options = {}) {
  const { engraveLib, abcLib, parseLib, transposeLib, performLib, musicxmlLib } = options;
  if (options.perform && !performLib) throw Error('selfContainedPS: perform needs options.performLib');
  if (!engraveLib || !abcLib) throw Error('selfContainedPS needs options.engraveLib and options.abcLib');
  checkSource(src);
  const embed = options.embedScore !== false;
  const tune = options.tune || 0;
  let meta = options.meta || null;
  let score = null;
  if (embed) {
    // the fallback: the JS parser's Score (and, without meta, its metadata)
    meta = meta || scoreMeta(src, options);
    if (meta.error) throw Error(meta.error);
    score = options.score || parse(src, { format: meta.format }).scores[tune];
  } else if (!meta && !options.perform) throw Error('selfContainedPS needs options.meta: readMeta() of the metaPS() document');
  if (meta && meta.error) throw Error(meta.error);
  const format = meta ? meta.format : options.format || detectFormat(src);
  // reader's %%annotation marks: drawn by sm-abc-engrave from its options
  const annotations = meta ? meta.annotations.map((a) => ({ page: a.page, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, rgb: a.rgb, text: a.text })) : [];
  // transposition: the option goes to sm-abc-engrave-string, which adds the
  // source's %%transpose itself; the Score literal fallback needs the total
  const optSemis = Math.trunc(options.transpose || 0);
  const semis = meta ? meta.transpose : optSemis;
  const paper = PAPERS[options.paper] ? options.paper : 'letter';
  const [W, H] = PAPERS[paper];
  const opts = { paper: `/${paper}`, 'staff-space': options.sp || 5.5, breaks: options.breaks || 'source', tune, format };
  const optLit = '<< /paper /' + paper + ' /staff-space ' + psLiteral(opts['staff-space'])
    + ' /breaks ' + psLiteral(opts.breaks) + ' /tune ' + tune + ' /format ' + psLiteral(format)
    + (options.footer !== undefined ? ' /footer ' + psLiteral(String(options.footer)) : '')
    + (annotations.length ? ' /annotations ' + psLiteral(annotations) : '')
    + (optSemis ? ' /transpose ' + optSemis : '') + ' >>';
  const title = (meta && meta.title) || 'Untitled';
  const composer = (meta && meta.composer) || '';
  // MusicXML parsed in PostScript too (without musicxmlLib the document is
  // exactly what it was before lib/sm_musicxml.ps existed)
  const xmlPS = !!(musicxmlLib && parseLib && format === 'musicxml');
  const [fromText, fromScore] = options.perform ? ['sm-abc-performance', 'sm-abc-performance']
    : [xmlPS ? 'sm-musicxml-engrave-string' : 'sm-abc-engrave-string', 'sm-abc-engrave'];
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
    parseLib ? parseLib.trimEnd() : null,
    transposeLib ? transposeLib.trimEnd() : null,
    options.perform ? performLib.trimEnd() : null,
    xmlPS ? musicxmlLib.trimEnd() : null,
    '%%EndProlog',
    '%%BeginSetup',
    `/sm-sp ${opts['staff-space']} def`,
    `/sm-abc-options ${optLit} def`,
    embed ? `/sm-abc-score ${psLiteral(score)} def` : '/sm-abc-score null def',
    '%%EndSetup',
    `% The ${format === 'abc' ? 'ABC' : 'MusicXML'} source follows, up to the line ${END_MARK}.`,
    `currentfile (${END_MARK}) sm-abc-readsrc`,
    sourceText(src),
    END_MARK,
    '/sm-abc-source exch def',
    xmlPS ? '/sm-musicxml-parse where { pop sm-abc-options /format get (musicxml) eq } { false } ifelse'
      : '/sm-abc-parse where { pop sm-abc-options /format get (abc) eq } { false } ifelse',
    'sm-abc-score null eq or',
    semis === optSemis
      ? `{ sm-abc-source sm-abc-options ${fromText} } { sm-abc-score sm-abc-options ${fromScore} } ifelse`
      : `{ sm-abc-source sm-abc-options ${fromText} } { sm-abc-score sm-abc-options dup length 1 add dict copy dup /transpose ${semis} put ${fromScore} } ifelse`,
    '%%EOF',
    '',
  ].filter((l) => l !== null);
  // what the PostScript engraver will print, for the caller's messages and
  // the PDF's Subject (the Score literal above stays untransposed)
  return {
    ps: lines.join('\n'), size: [W, H], title, composer, format,
    warnings: meta ? [...meta.warnings] : [], transposed: meta ? meta.transposed : null,
    tunes: meta ? meta.tunes.map((t) => t.title) : [], annotations: meta ? meta.annotations : [], meta,
  };
}
