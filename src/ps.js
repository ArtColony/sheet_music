// PostScript emission helpers: fixed-precision numbers and text literals.
// Everything here is pure and locale-independent, so the same input gives
// the same bytes in Node and in every browser.

/** A number with at most two decimals, no trailing zeros, never "-0". */
export function num(x) {
  if (!Number.isFinite(x)) throw Error(`non-finite coordinate ${x}`);
  let r = Math.round(x * 100);
  if (r === 0) return '0';
  const neg = r < 0;
  r = Math.abs(r);
  const int = Math.floor(r / 100);
  const frac = r % 100;
  let s = String(int);
  if (frac) s += '.' + (frac < 10 ? '0' + frac : String(frac)).replace(/0$/, '');
  return neg ? '-' + s : s;
}
export const nums = (...xs) => xs.map(num).join(' ');

// Characters StandardEncoding has directly (octal codes).
const DIRECT = {
  'Æ': '\\341', 'æ': '\\361', 'Ø': '\\351', 'ø': '\\371', 'ß': '\\373', 'Œ': '\\352', 'œ': '\\372',
  'Ł': '\\350', 'ł': '\\370', 'ı': '\\365', '–': '\\261', '—': '\\320', '‘': '\\140', '’': '\\047',
  '“': '\\252', '”': '\\272', '„': '\\271', '‚': '\\270', '…': '\\274', '•': '\\267', '¡': '\\241', '¿': '\\277',
  '£': '\\243', '¥': '\\245', '§': '\\247', '«': '\\253', '»': '\\273', '‹': '\\254', '›': '\\255',
  '†': '\\262', '‡': '\\263', '·': '\\264', '¶': '\\266', 'ﬁ': '\\256', 'ﬂ': '\\257', '¢': '\\242',
  "'": '\\047', '`': '\\140', '♯': '#', '♭': 'b', '♮': '', '©': '(c)', '°': 'o', '×': 'x', ' ': ' ',
};
// Combining marks -> StandardEncoding accent glyphs. Above-marks get raised
// on capitals; cedilla and ogonek sit below and never move.
const MARK = {
  '̀': ['\\301', true], '́': ['\\302', true], '̂': ['\\303', true], '̃': ['\\304', true],
  '̄': ['\\305', true], '̆': ['\\306', true], '̇': ['\\307', true], '̈': ['\\310', true],
  '̊': ['\\312', true], '̋': ['\\315', true], '̌': ['\\317', true],
  '̧': ['\\313', false], '̨': ['\\316', false],
};

const esc = (c) => (c === '(' || c === ')' || c === '\\' ? '\\' + c : c);

/**
 * A text literal for sm-show: a plain (string) when the text is ASCII, else
 * an array mixing strings and [(base) (accent) raise] triples. size is the
 * font size in points (it sets how far an accent rises over a capital).
 */
export function text(s, size = 11) {
  const items = [];
  let run = '';
  const flush = () => { if (run) { items.push(`(${run})`); run = ''; } };
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code < 127) { run += code === 39 ? '\\047' : code === 96 ? '\\140' : esc(ch); continue; }
    if (DIRECT[ch] !== undefined) { run += DIRECT[ch]; continue; }
    const d = ch.normalize('NFD');
    if (d.length === 2 && MARK[d[1]] && /[A-Za-z]/.test(d[0])) {
      const [acc, above] = MARK[d[1]];
      let base = d[0];
      if (above && base === 'i') base = '\\365'; // dotless i under the accent
      const raise = above && /[A-Z]/.test(d[0]) ? Math.round(size * 0.22 * 100) / 100 : 0;
      flush();
      items.push(`[(${base}) (${acc}) ${num(raise)}]`);
      continue;
    }
    run += '?';
  }
  flush();
  if (items.length === 0) return '()';
  if (items.length === 1 && items[0][0] === '(') return items[0];
  return '[' + items.join(' ') + ']';
}

/**
 * Any JSON-like value as a PostScript literal: objects -> << /key value >>
 * (keys sorted), arrays -> [ ], strings -> (escaped, non-ASCII as \ooo of
 * its UTF-8 bytes), integers as integers, other numbers via num(), null ->
 * null, booleans -> true/false; undefined members are left out. It writes
 * the options dict of the documents src/psdoc.js makes, and (in the tests)
 * the frozen Scores of the retired JS parsers, which the PostScript layout
 * takes as they are: the same structure lib/sm_abc_parse.ps builds, Fracs
 * as [num den].
 */
export function psLiteral(v) {
  if (v === null) return 'null';
  if (v === true || v === false) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : num(v);
  if (typeof v === 'string') {
    let s = '(';
    for (const b of new TextEncoder().encode(v)) {
      if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
      else if (b >= 32 && b < 127) s += String.fromCharCode(b);
      else s += '\\' + b.toString(8).padStart(3, '0');
    }
    return s + ')';
  }
  if (Array.isArray(v)) return '[' + Array.from(v, (x) => psLiteral(x === undefined ? null : x)).join(' ') + ']'; // holes -> null, as in JSON
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '<<' + keys.map((k) => ` /${k} ${psLiteral(v[k])}`).join('') + ' >>';
}
