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
import { parse, parseAnnotations, tuneTranspose } from './index.js';
import { splitTunes } from './abc.js';
import { PAPERS } from './layout.js';
import { psLiteral } from './ps.js';
import { transposeScore } from './transpose.js';

export const END_MARK = '%%SM-ABC-END';
const dscText = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');

/**
 * options: engraveLib (lib/sm_engrave.ps text, required), abcLib
 * (lib/sm_abc.ps, required), parseLib (lib/sm_abc_parse.ps, optional),
 * transposeLib (lib/sm_transpose.ps, optional; without it pscat runs it from
 * lib/ when the score needs transposing), musicxmlLib (lib/sm_musicxml.ps,
 * optional: embedded, with parseLib, for a MusicXML source), tune, paper ('letter'|'a4'), sp,
 * breaks, footer, format, transpose (semitones, added to any %%transpose
 * line), embedScore (default true), perform (with performLib,
 * lib/sm_perform.ps: instead of drawing, the document prints the tune's
 * playback events as one JSON line, sm-abc-performance).
 * Returns { ps, size, title, composer, format, warnings, transposed }.
 */
export function selfContainedPS(src, options = {}) {
  const { engraveLib, abcLib, parseLib, transposeLib, performLib, musicxmlLib } = options;
  if (options.perform && !performLib) throw Error('selfContainedPS: perform needs options.performLib');
  if (!engraveLib || !abcLib) throw Error('selfContainedPS needs options.engraveLib and options.abcLib');
  const parsed = parse(src, options);
  const tune = options.tune || 0;
  const score = parsed.scores[tune];
  if (!score) throw Error(`no tune number ${tune + 1} (the input has ${parsed.scores.length})`);
  if (src.split(/\r?\n/).some((l) => l === END_MARK)) throw Error(`the source contains the line ${END_MARK}`);
  // reader's %%annotation marks: drawn by sm-abc-engrave from its options
  const tuneSrc = parsed.format === 'abc' ? splitTunes(src)[tune] || '' : src;
  const annotations = parseAnnotations(tuneSrc).map((a) => ({ page: a.page, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h, rgb: a.rgb, text: a.text }));
  const warnings = [...parsed.warnings];
  // transposition: the option goes to sm-abc-engrave-string, which adds the
  // source's %%transpose itself; the Score literal fallback needs the total
  const optSemis = Math.trunc(options.transpose || 0);
  const semis = tuneTranspose(src, tuneSrc, parsed.format) + optSemis;
  const paper = PAPERS[options.paper] ? options.paper : 'letter';
  const [W, H] = PAPERS[paper];
  const opts = { paper: `/${paper}`, 'staff-space': options.sp || 5.5, breaks: options.breaks || 'source', tune, format: parsed.format };
  const optLit = '<< /paper /' + paper + ' /staff-space ' + psLiteral(opts['staff-space'])
    + ' /breaks ' + psLiteral(opts.breaks) + ' /tune ' + tune + ' /format ' + psLiteral(parsed.format)
    + (options.footer !== undefined ? ' /footer ' + psLiteral(String(options.footer)) : '')
    + (annotations.length ? ' /annotations ' + psLiteral(annotations) : '')
    + (optSemis ? ' /transpose ' + optSemis : '') + ' >>';
  const title = score.meta.title || 'Untitled';
  // MusicXML parsed in PostScript too (without musicxmlLib the document is
  // exactly what it was before lib/sm_musicxml.ps existed)
  const xmlPS = !!(musicxmlLib && parseLib && parsed.format === 'musicxml');
  const [fromText, fromScore] = options.perform ? ['sm-abc-performance', 'sm-abc-performance']
    : [xmlPS ? 'sm-musicxml-engrave-string' : 'sm-abc-engrave-string', 'sm-abc-engrave'];
  const embed = options.embedScore !== false;
  const lines = [
    '%!PS-Adobe-3.0',
    `%%Title: ${dscText(title)}`,
    `%%Creator: ArtColony sheet_music (PostScript engraver)`,
    score.meta.composer ? `%%For: ${dscText(score.meta.composer)}` : null,
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
    `% The ${parsed.format === 'abc' ? 'ABC' : 'MusicXML'} source follows, up to the line ${END_MARK}.`,
    `currentfile (${END_MARK}) sm-abc-readsrc`,
    src.replace(/\r\n?/g, '\n').replace(/\n$/, ''),
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
  const transposed = semis ? transposeScore(score, semis).transposed : null;
  return { ps: lines.join('\n'), size: [W, H], title, composer: score.meta.composer || '', format: parsed.format, warnings, transposed };
}
