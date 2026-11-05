// ABC notation (https://abcnotation.com/wiki/abc:standard:v2.1) -> Score.
//
// A practical subset of ABC 2.1, covering what folk-tune, hymn and simple
// keyboard collections use: header fields, keys with modes, meters, unit
// lengths, notes/rests/chords, broken rhythm, tuplets, ties, slurs, grace
// notes, decorations, chord symbols, annotations, bar lines, repeats and
// endings, lyrics (w:) and several voices, each on its own staff.
// docs/notation.md lists exactly what is supported.
import { F, add, mul, div, ZERO, cmp } from './frac.js';
import { newScore, newMeasure, finalizeScore, parseKeyText, parseClef } from './score.js';

const ACC = { '^': 'sharp', '^^': 'dsharp', '_': 'flat', '__': 'dflat', '=': 'natural' };
const SHORT_DECO = { '.': 'staccato', '~': 'roll', H: 'fermata', L: 'accent', M: 'lowermordent', O: 'coda', P: 'uppermordent', S: 'segno', T: 'trill', u: 'upbow', v: 'downbow' };
const DECO_ALIAS = { '>': 'accent', emphasis: 'accent', '^': 'marcato', '+': 'plus', '<(': 'crescendo(', '<)': 'crescendo)', '>(': 'diminuendo(', '>)': 'diminuendo)', pralltriller: 'uppermordent', mordent: 'lowermordent' };
const DYNAMICS = new Set(['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sfz', 'sf', 'fp', 'rfz', 'sfp']);
const TEXT_DECOS = { 'D.C.': 'D.C.', 'D.S.': 'D.S.', fine: 'Fine', 'D.C.alfine': 'D.C. al Fine', 'D.S.alcoda': 'D.S. al Coda', dacapo: 'Da Capo', dacoda: 'Coda' };

// TeX-like ABC text escapes for accented letters, to Unicode.
const MNEMONIC = { '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È' }, "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É' }, '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê' }, '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', O: 'Ö', U: 'Ü' }, '~': { n: 'ñ', N: 'Ñ', a: 'ã', o: 'õ' }, c: { c: 'ç', C: 'Ç' } };
export function abcText(s) {
  return s.replace(/\\([`'^"~c])([A-Za-z])/g, (m, a, l) => (MNEMONIC[a] && MNEMONIC[a][l]) || m)
    .replace(/\\ss/g, 'ß').replace(/\\aa/g, 'å').replace(/\\AA/g, 'Å').replace(/\\o/g, 'ø').replace(/\\O/g, 'Ø')
    .replace(/&amp;/g, '&');
}

function parseLength(s, i) {
  const m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i));
  const txt = m[0];
  let num = m[1] ? parseInt(m[1], 10) : 1;
  let den = 1;
  if (m[2]) den = m[3] ? parseInt(m[3], 10) : 2 ** m[2].length;
  else if (m[3]) num = parseInt(m[3], 10);
  if (num === 0) num = 1;
  return { len: F(num, den), next: i + txt.length };
}

function parseMeter(t) {
  t = t.trim();
  if (t === 'C') return { num: 4, den: 4, symbol: 'common' };
  if (t === 'C|') return { num: 2, den: 2, symbol: 'cut' };
  if (t === 'none' || t === '') return { num: 0, den: 0, symbol: 'none' };
  const m = /^\(?([\d+]+)\)?\/(\d+)/.exec(t);
  if (!m) return null;
  const num = m[1].split('+').reduce((a, b) => a + parseInt(b, 10), 0);
  return { num, den: parseInt(m[2], 10), text: m[1] };
}

function parseTempo(t) {
  const out = { text: '', beat: null, bpm: null };
  let rest = t.replace(/"([^"]*)"/g, (_, s) => { out.text = (out.text ? out.text + ' ' : '') + abcText(s); return ''; }).trim();
  const m = /(\d+)\/(\d+)(?:\s+\d+\/\d+)*\s*=\s*(\d+)/.exec(rest);
  if (m) { out.beat = F(parseInt(m[1], 10), parseInt(m[2], 10)); out.bpm = parseInt(m[3], 10); }
  else if (/^\d+$/.test(rest)) { out.bpm = parseInt(rest, 10); }
  return out.text || out.bpm ? out : null;
}

function voiceProps(rest) {
  const props = {};
  rest = rest.replace(/(\w+)\s*=\s*("([^"]*)"|\S+)/g, (_, k, v, q) => { props[k.toLowerCase()] = q !== undefined ? q : v; return ''; }).trim();
  const words = rest.split(/\s+/).filter(Boolean);
  for (const w of words) if (parseClef(w)) props.clef = props.clef || w;
  return props;
}

/** Split a file into tunes (X: blocks). Text before the first X: is the file header. */
export function splitTunes(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tunes = [];
  let cur = null;
  for (const line of lines) {
    if (/^X:/.test(line)) { cur = []; tunes.push(cur); }
    if (cur) cur.push(line);
  }
  if (!tunes.length) tunes.push(lines);
  return tunes.map((l) => l.join('\n'));
}

/** Parse every tune in an ABC file. Returns {scores, warnings}. */
export function parseABC(text) {
  const warnings = [];
  const scores = splitTunes(text).map((t, i) => parseTune(t, (w) => warnings.push(`tune ${i + 1}: ${w}`)));
  return { scores, warnings };
}

function parseTune(text, warn) {
  const score = newScore();
  const meta = score.meta;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let inHeader = true;
  let meter = { num: 4, den: 4, symbol: 'none-given' };
  let unitLen = null;
  let key = { fifths: 0 };
  const voices = []; // in order of declaration
  const voiceById = new Map();
  let voice = null;
  let scoreDirective = '';

  function getVoice(id, props = {}) {
    let v = voiceById.get(id);
    if (!v) {
      v = { id, name: '', clef: parseClef('treble'), measures: [], cur: null, unitLen: null, tup: null, slurPending: 0,
        beamBreak: true, chord: null, annots: [], decos: [], grace: null, lastEvent: null, broken: null,
        openTies: [], lyricQueue: [], verse: 0, wDone: false, mNo: 0 };
      v.cur = newMeasure();
      voiceById.set(id, v);
      voices.push(v);
    }
    if (props.name || props.nm) v.name = abcText(props.name || props.nm);
    if (props.clef) { const c = parseClef(props.clef); if (c) v.clef = c; else warn(`unknown clef "${props.clef}"`); }
    return v;
  }
  const L = (v) => v.unitLen || unitLen || (meter.num && meter.num / meter.den < 0.75 ? F(1, 16) : F(1, 8));

  function header(field, value) {
    switch (field) {
      case 'T': if (!meta.title) meta.title = abcText(value); else meta.subtitles.push(abcText(value)); break;
      case 'C': meta.composer = meta.composer ? meta.composer + ', ' + abcText(value) : abcText(value); break;
      case 'O': meta.origin = abcText(value); break;
      case 'A': meta.area = abcText(value); break;
      case 'R': meta.rhythm = abcText(value); break;
      case 'Z': meta.transcriber = abcText(value); break;
      case 'N': meta.notes.push(abcText(value)); break;
      case 'S': meta.source = abcText(value); break;
      case 'B': meta.book = abcText(value); break;
      case 'H': meta.history.push(abcText(value)); break;
      case 'W': meta.words.push(abcText(value)); break;
      case 'Q': score.tempo = parseTempo(value); break;
      case 'L': { const m = /(\d+)\/(\d+)/.exec(value); if (m) unitLen = F(+m[1], +m[2]); else warn(`bad L: ${value}`); break; }
      case 'M': { const m = parseMeter(value); if (m) meter = m; else warn(`bad M: ${value}`); break; }
      case 'V': { const [id, ...rest] = value.trim().split(/\s+/); getVoice(id, voiceProps(rest.join(' '))); break; }
      case 'K': {
        const k = parseKeyText(value);
        key = k.key;
        if (k.clef) { if (voices.length === 0) getVoice('1'); for (const v of voices) if (!v.clefFromVoice) v.clef = k.clef; }
        break;
      }
      default: break;
    }
  }

  function closeMeasure(v, bar) {
    const m = v.cur;
    const hasContent = m.events.length > 0;
    if (!hasContent && v.measures.length === 0 && !bar.ending) {
      // a bar line before any music: only its start-repeat matters
      if (bar.startRepeat) m.startRepeat = true;
      return;
    }
    if (!hasContent && v.measures.length > 0 && !bar.ending && !m.key && !m.time) {
      // two bar tokens in a row ("|" then "[1"): merge into the previous bar
      const prev = v.measures[v.measures.length - 1];
      if (bar.endBar !== 'single') prev.endBar = bar.endBar;
      if (bar.startRepeat) m.startRepeat = true;
      return;
    }
    m.endBar = bar.endBar;
    v.measures.push(m);
    v.cur = newMeasure();
    if (bar.startRepeat) v.cur.startRepeat = true;
    if (bar.ending) v.cur.ending = { label: bar.ending };
    v.beamBreak = true;
  }

  function addEvent(v, ev) {
    if (v.chord) { ev.chord = v.chord; v.chord = null; }
    if (v.annots.length) { ev.annot = v.annots; v.annots = []; }
    if (v.decos.length) {
      for (const d of v.decos) {
        if (DYNAMICS.has(d)) ev.dyn = d;
        else if (d === 'crescendo(' || d === 'diminuendo(') ev.hairpinStart = d.startsWith('c') ? 'cresc' : 'dim';
        else if (d === 'crescendo)' || d === 'diminuendo)') ev.hairpinEnd = true;
        else if (TEXT_DECOS[d]) (ev.annot = ev.annot || []).push({ text: TEXT_DECOS[d], pos: 'above', italic: true });
        else (ev.decos = ev.decos || []).push(d);
      }
      v.decos = [];
    }
    if (v.grace) { ev.grace = v.grace; v.grace = null; }
    if (v.slurPending) { ev.slurStart = v.slurPending; v.slurPending = 0; }
    ev.beam = !v.beamBreak;
    v.beamBreak = false;
    if (v.broken) { ev.len = mul(ev.len, v.broken); v.broken = null; }
    if (v.tup) {
      ev.tuplet = { id: v.tup.id, p: v.tup.p, q: v.tup.q };
      ev.tup = F(v.tup.q, v.tup.p);
      if (--v.tup.r <= 0) v.tup = null;
    }
    // tie continuation: every pitch of this event was tied into
    if (ev.kind === 'note' && v.openTies.length) {
      const hit = ev.notes.filter((n) => v.openTies.some((t) => t.step === n.step && t.oct === n.oct));
      if (hit.length === ev.notes.length) ev.tiedFrom = true;
    }
    if (ev.kind === 'note') v.openTies = ev.notes.filter((n) => n.tie);
    v.cur.events.push(ev);
    v.lastEvent = ev;
    if (ev.kind === 'note' && !ev.tiedFrom) v.lyricQueue.push({ ev, m: v.measures.length });
  }

  let tupId = 0;
  function parseNote(s, i) {
    const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/.exec(s.slice(i));
    if (!m) return null;
    let oct = m[2] === m[2].toLowerCase() ? 5 : 4;
    for (const c of m[3]) oct += c === "'" ? 1 : -1;
    const n = { step: m[2].toUpperCase(), oct, acc: m[1] ? ACC[m[1]] : null, tie: false };
    const { len, next } = parseLength(s, i + m[0].length);
    let j = next;
    if (s[j] === '-') { n.tie = true; j++; }
    return { note: n, len, next: j };
  }

  function musicLine(v, s) {
    if (v.wDone) { v.lyricQueue = []; v.verse = 0; v.wDone = false; }
    let i = 0;
    let continued = false;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c === '%') break;
      if (c === '\\' && s.slice(i + 1).trim() === '') { continued = true; break; }
      if (c === ' ' || c === '\t') { v.beamBreak = true; i++; continue; }
      if (c === '`' || c === 'y') { i++; continue; }
      if (c === '"') {
        const e = s.indexOf('"', i + 1);
        const t = abcText(e < 0 ? s.slice(i + 1) : s.slice(i + 1, e));
        i = e < 0 ? n : e + 1;
        const pos = { '^': 'above', _: 'below', '<': 'left', '>': 'right', '@': 'above' }[t[0]];
        if (pos) v.annots.push({ text: t.slice(1), pos });
        else v.chord = v.chord ? v.chord + ' ' + t : t;
        continue;
      }
      if (c === '!' || (c === '+' && s.indexOf('+', i + 1) > i)) {
        const e = s.indexOf(c, i + 1);
        if (e < 0) { warn(`unterminated decoration in "${s}"`); break; }
        const d = s.slice(i + 1, e);
        v.decos.push(DECO_ALIAS[d] || d);
        i = e + 1;
        continue;
      }
      if (SHORT_DECO[c]) { v.decos.push(SHORT_DECO[c]); i++; continue; }
      if (c === '{') {
        const e = s.indexOf('}', i);
        if (e < 0) { warn('unterminated grace group'); break; }
        let body = s.slice(i + 1, e);
        const slash = body.startsWith('/');
        if (slash) body = body.slice(1);
        const notes = [];
        let k = 0;
        while (k < body.length) {
          const r = parseNote(body, k);
          if (r) { notes.push(r.note); k = r.next; } else k++;
        }
        if (notes.length) v.grace = { notes, slash };
        i = e + 1;
        continue;
      }
      if (c === '[' && /^\[[A-Za-z]:/.test(s.slice(i))) {
        const e = s.indexOf(']', i);
        const field = s[i + 1];
        const value = s.slice(i + 3, e < 0 ? n : e);
        inlineField(v, field, value);
        i = e < 0 ? n : e + 1;
        continue;
      }
      // bar lines (and endings written after them)
      const bm = /^(:*\[\||\[\||:*\|\]|\|\]|:+\|+:+|::+|:*\|\|:*|:+\|:*|\|+:+|\|\||\||\[(?=\d))(\d[\d,\-]*)?/.exec(s.slice(i));
      if (bm && (bm[1] !== '[' || bm[2])) {
        const tok = bm[1];
        const bar = { endBar: 'single', startRepeat: false, ending: bm[2] || null };
        const endRep = /^:/.test(tok);
        const startRep = /:$/.test(tok);
        if (tok === '[') bar.endBar = 'single';
        else if (endRep && startRep) { bar.endBar = 'repeat-end'; bar.startRepeat = true; }
        else if (endRep) bar.endBar = 'repeat-end';
        else if (startRep) { bar.endBar = tok.startsWith('||') ? 'double' : 'single'; bar.startRepeat = true; }
        else if (tok === '||') bar.endBar = 'double';
        else if (tok === '|]') bar.endBar = 'final';
        else if (tok === '[|') bar.endBar = 'thick-thin';
        closeMeasure(v, bar);
        v.openTies = v.openTies; // ties carry over bar lines
        i += bm[0].length;
        continue;
      }
      if (c === '[') {
        // chord
        const e = s.indexOf(']', i);
        if (e < 0) { warn('unterminated chord'); break; }
        const body = s.slice(i + 1, e);
        const notes = [];
        let first = null;
        let k = 0;
        while (k < body.length) {
          const r = parseNote(body, k);
          if (r) { notes.push(r.note); if (!first) first = r.len; k = r.next; } else k++;
        }
        let j = e + 1;
        const { len, next } = parseLength(s, j);
        j = next;
        if (s[j] === '-') { notes.forEach((x) => { x.tie = true; }); j++; }
        if (notes.length) addEvent(v, { kind: 'note', notes, len: mul(L(v), mul(first || F(1), len)) });
        i = j;
        continue;
      }
      if (c === '(') {
        const tm = /^\((\d)(?::(\d*)(?::(\d*))?)?/.exec(s.slice(i));
        if (tm) {
          const p = +tm[1];
          const compound = meter.num % 3 === 0 && meter.num > 3;
          const q = tm[2] ? +tm[2] : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 }[p] || (compound ? 3 : 2));
          const r = tm[3] ? +tm[3] : p;
          v.tup = { id: ++tupId, p, q, r };
          i += tm[0].length;
        } else { v.slurPending++; i++; }
        continue;
      }
      if (c === ')') { if (v.lastEvent) v.lastEvent.slurEnd = (v.lastEvent.slurEnd || 0) + 1; i++; continue; }
      if (c === '-') { if (v.lastEvent && v.lastEvent.kind === 'note') { v.lastEvent.notes.forEach((x) => { x.tie = true; }); v.openTies = v.lastEvent.notes; } i++; continue; }
      if (c === '>' || c === '<') {
        const run = /^[<>]+/.exec(s.slice(i))[0];
        const k = run.length;
        const big = F(2 ** (k + 1) - 1, 2 ** k);
        const small = F(1, 2 ** k);
        const e = v.lastEvent;
        if (e) e.len = mul(e.len, c === '>' ? big : small);
        v.broken = c === '>' ? small : big;
        i += k;
        continue;
      }
      if (/[zxZX]/.test(c)) {
        const { len, next } = parseLength(s, i + 1);
        if (c === 'Z' || c === 'X') {
          const count = /^\d/.test(s.slice(i + 1)) ? len[0] : 1;
          addEvent(v, { kind: 'rest', notes: [], len: F(meter.num || 4, meter.den || 4), rest: { measure: true, count, invisible: c === 'X' } });
          v.cur.mmCount = count;
        } else addEvent(v, { kind: 'rest', notes: [], len: mul(L(v), len), rest: { invisible: c === 'x' } });
        i = next;
        continue;
      }
      if (c === '&') { warn('voice overlay (&) is not supported; the rest of the line is skipped'); break; }
      const r = parseNote(s, i);
      if (r) {
        addEvent(v, { kind: 'note', notes: [r.note], len: mul(L(v), r.len) });
        i = r.next;
        continue;
      }
      if (c !== '\\' && c !== '$' && c !== '*') warn(`skipped "${c}" in: ${s.trim()}`);
      i++;
    }
    if (!continued) {
      const target = v.cur.events.length ? v.cur : v.measures[v.measures.length - 1];
      if (target) target.lineBreak = true;
    }
  }

  function inlineField(v, field, value) {
    switch (field) {
      case 'K': { const k = parseKeyText(value); if (value.trim() && !/^clef=/.test(value.trim())) { key = k.key; v.cur.key = k.key; } if (k.clef) v.cur.clef = k.clef; break; }
      case 'M': { const m = parseMeter(value); if (m) { meter = m; v.cur.time = m; } break; }
      case 'L': { const m = /(\d+)\/(\d+)/.exec(value); if (m) v.unitLen = F(+m[1], +m[2]); break; }
      case 'Q': if (!score.tempo) score.tempo = parseTempo(value); break;
      case 'V': { const [id, ...rest] = value.trim().split(/\s+/); voice = getVoice(id, voiceProps(rest.join(' '))); break; }
      case 'P': (v.cur.annotPart = abcText(value.trim())); break;
      default: break;
    }
  }

  function lyricLine(v, text) {
    const verse = v.verse++;
    v.wDone = true;
    const q = v.lyricQueue;
    // tokens: syllables, with separators that say what follows
    let k = 0; // index into q
    const put = (syl) => { if (k < q.length) { const ev = q[k].ev; (ev.lyrics = ev.lyrics || [])[verse] = syl; } k++; };
    let i = 0;
    let buf = '';
    const flush = (hyphen) => { if (buf !== '') { put({ text: abcText(buf.replace(/~/g, ' ')), hyphen }); buf = ''; return true; } return false; };
    while (i < text.length) {
      const c = text[i];
      if (c === '\\' && text[i + 1] === '-') { buf += '-'; i += 2; continue; }
      if (c === ' ' || c === '\t') { flush(false); i++; continue; }
      if (c === '-') { if (!flush(true)) { // "--": a syllable left blank, hyphen continues
          if (k > 0 && k - 1 < q.length) { const prev = q[k - 1].ev.lyrics && q[k - 1].ev.lyrics[verse]; if (prev) prev.hyphen = true; }
          put(null);
        } i++; continue; }
      if (c === '_') { flush(false); if (k > 0 && k - 1 < q.length) { const prev = q[k - 1].ev.lyrics && q[k - 1].ev.lyrics[verse]; if (prev) prev.extend = true; } put(null); i++; continue; }
      if (c === '*') { flush(false); put(null); i++; continue; }
      if (c === '|') { flush(false); if (k < q.length) { const m0 = k > 0 ? q[k - 1].m : -1; while (k < q.length && q[k].m <= m0) k++; } i++; continue; }
      buf += c; i++;
    }
    flush(false);
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^%%/.test(line)) {
      if (/^%%(score|staves)\b/.test(line)) scoreDirective = line;
      continue;
    }
    if (/^\s*%/.test(line)) continue;
    const fm = /^([A-Za-z]):(.*)$/.exec(line);
    if (inHeader) {
      if (!fm) { if (line.trim() === '') continue; inHeader = false; }
      else {
        header(fm[1], fm[2].trim());
        if (fm[1] === 'K') { inHeader = false; if (!voices.length) getVoice('1'); voice = voices[0]; }
        continue;
      }
    }
    if (line.trim() === '') continue;
    if (!voice) { if (!voices.length) getVoice('1'); voice = voices[0]; }
    if (fm && !/^[|:\[]/.test(line)) {
      const [f, value] = [fm[1], fm[2]];
      if (f === 'w') lyricLine(voice, value);
      else if (f === 'V') { const [id, ...rest] = value.trim().split(/\s+/); voice = getVoice(id, voiceProps(rest.join(' '))); if (voice.wDone === false && voice.cur.events.length === 0) { /* fresh */ } }
      else if (f === 'K' || f === 'M' || f === 'L' || f === 'Q' || f === 'P') inlineField(voice, f, value);
      else if (f === 'W') meta.words.push(abcText(value));
      else if (f === 'T') meta.subtitles.push(abcText(value.trim()));
      else if (f === 'N') meta.notes.push(abcText(value.trim()));
      continue;
    }
    musicLine(voice, line);
  }
  if (!voices.length) getVoice('1');
  for (const v of voices) {
    if (v.cur.events.length) { v.cur.endBar = v.cur.endBar || 'single'; v.measures.push(v.cur); }
  }

  score.initial.key = voicesInitialKey(lines) || key;
  score.initial.time = initialMeter(lines);
  // brace when the score directive groups voices with {}, or for a two-staff
  // treble+bass pair; a bracket for other multi-staff scores
  score.staves = voices.map((v) => ({ id: v.id, name: v.name, clef: v.clef }));
  if (voices.length > 1) {
    const pianoLike = voices.length === 2 && voices[0].clef.sign === 'G' && voices[1].clef.sign === 'F';
    score.group = /\{/.test(scoreDirective) || pianoLike ? 'brace' : 'bracket';
  }
  score.voiceMeasures = voices.map((v) => v.measures);
  return finalizeScore(score, warn);

  // The key and meter in force when the body begins (the header's).
  function voicesInitialKey(ls) {
    for (const l of ls) { const m = /^K:(.*)$/.exec(l); if (m) return parseKeyText(m[1]).key; }
    return null;
  }
  function initialMeter(ls) {
    for (const l of ls) { const m = /^M:(.*)$/.exec(l); if (m) return parseMeter(m[1]) || { num: 4, den: 4 }; if (/^K:/.test(l)) break; }
    return { num: 0, den: 0, symbol: 'none' };
  }
}
