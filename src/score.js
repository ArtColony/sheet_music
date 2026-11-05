// The Score model shared by every input format, and its finalisation.
//
// score = {
//   meta: { title, subtitles[], composer, origin, rhythm, transcriber, notes[], source, words[], rights },
//   tempo: { text, beat: Frac|null, bpm } | null,
//   staves: [{ id, name, clef: { sign: 'G'|'F'|'C', line, octave } }],
//   group: 'brace' | 'bracket' | null,
//   initial: { key: { fifths }, time: { num, den, symbol? } },
//   measures: [{
//     staves: [{ events: [Event] }],      one entry per staff
//     key?, time?, clefs?: [clef?]         changes that take effect here
//     startRepeat, endBar: 'single'|'double'|'final'|'thick-thin'|'repeat-end',
//     ending?: { label, closed, span },    a volta bracket starting here
//     lineBreak, number, mmCount
//   }]
// }
// Event = { kind: 'note'|'rest', dur: Frac (sounding), type: Frac, dots,
//   notes: [{ step, oct, acc, tie }], beam, tuplet?, grace?, decos?, dyn?,
//   chord?, annot?, lyrics?: [{ text, hyphen, extend }], slurStart?, slurEnd?,
//   rest?: { measure, count, invisible } }
import { F, add, mul, ZERO, cmp, noteValues, eq } from './frac.js';

export function newScore() {
  return {
    meta: { title: '', subtitles: [], composer: '', origin: '', area: '', rhythm: '', transcriber: '', notes: [], history: [], source: '', book: '', words: [], rights: '' },
    tempo: null,
    staves: [],
    group: null,
    initial: { key: { fifths: 0 }, time: { num: 4, den: 4 } },
    measures: [],
  };
}
export function newMeasure() { return { events: [], startRepeat: false, endBar: null, lineBreak: false }; }

const MAJOR = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7, 'G#': 8, 'D#': 9, 'A#': 10, Fb: -8 };
const MODE = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5 };

export function parseClef(name) {
  if (!name) return null;
  const n = name.toLowerCase().replace(/^clef=/, '');
  if (n === 'treble' || n === 'g' || n === 'g2') return { sign: 'G', line: 2, octave: 0 };
  if (n === 'treble-8' || n === 'treble8' || n === 'tenor-8' || n === 'g2-8' || n === 'treble_8') return { sign: 'G', line: 2, octave: -1 };
  if (n === 'bass' || n === 'f' || n === 'f4') return { sign: 'F', line: 4, octave: 0 };
  if (n === 'alto' || n === 'c' || n === 'c3') return { sign: 'C', line: 3, octave: 0 };
  if (n === 'tenor' || n === 'c4') return { sign: 'C', line: 4, octave: 0 };
  return null;
}

/** "G", "Em", "D mix", "Bb dorian clef=bass", "none" -> { key: {fifths}, clef } */
export function parseKeyText(text) {
  const out = { key: { fifths: 0 }, clef: null };
  let t = text.trim();
  const cm = /(?:^|\s)(?:clef=)?(treble-8|treble|bass|alto|tenor)\b/i.exec(t);
  if (cm) { out.clef = parseClef(cm[1]); t = t.replace(cm[0], ' ').trim(); }
  t = t.replace(/\b\w+=\S+/g, '').trim();
  if (!t || /^none/i.test(t) || /^H[Pp]/.test(t)) return out;
  const m = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(t);
  if (!m) return out;
  const tonic = m[1] + m[2];
  const mode = m[3].toLowerCase();
  const modeKey = mode === '' ? 'maj' : mode === 'm' ? 'm' : mode.slice(0, 3);
  let fifths = MAJOR[tonic];
  if (fifths === undefined) fifths = 0;
  fifths += MODE[modeKey] ?? 0;
  if (fifths > 7) fifths -= 12; if (fifths < -7) fifths += 12;
  out.key.fifths = fifths;
  return out;
}

/**
 * Turn a parser's per-voice measure lists (score.voiceMeasures) into
 * score.measures: note values, tied splits, tuplet groups, endings, numbers.
 */
export function finalizeScore(score, warn = () => {}) {
  const vms = score.voiceMeasures || [];
  delete score.voiceMeasures;
  const count = Math.max(0, ...vms.map((m) => m.length));
  const measures = [];
  for (let i = 0; i < count; i++) {
    const top = vms[0][i] || newMeasure();
    const m = {
      staves: vms.map((ms) => ({ events: ((ms[i] && ms[i].events) || []).flatMap(finalizeEvent) })),
      startRepeat: !!top.startRepeat,
      endBar: top.endBar || 'single',
      lineBreak: !!top.lineBreak,
      mmCount: top.mmCount || 0,
    };
    for (const ms of vms) {
      const mm = ms[i];
      if (!mm) continue;
      if (mm.key && !m.key) m.key = mm.key;
      if (mm.time && !m.time) m.time = mm.time;
      if (mm.ending && !m.ending) m.ending = { ...mm.ending };
      if (mm.annotPart && !m.part) m.part = mm.annotPart;
    }
    m.clefs = vms.map((ms) => (ms[i] && ms[i].clef) || null);
    measures.push(m);
  }
  score.measures = measures;
  // a voice that ran short gets whole-measure rests
  let time = score.initial.time;
  for (const m of measures) {
    if (m.time) time = m.time;
    for (const st of m.staves) {
      if (!st.events.length) st.events.push(restEvent(time, true));
    }
  }
  numberMeasures(score);
  markEndings(score);
  groupTuplets(score);
  return score;
}

function restEvent(time, invisibleIfNone) {
  const len = time.num ? F(time.num, time.den) : F(1);
  return { kind: 'rest', notes: [], dur: len, type: F(1), dots: 0, rest: { measure: true, count: 1, invisible: false }, beam: false };
}

// Written length (ev.len) and tuplet scale (ev.tup) -> type/dots/dur.
// A length one note cannot show becomes tied notes (or consecutive rests).
function finalizeEvent(ev) {
  if (ev.type) return [ev]; // already final (MusicXML gives types)
  const tup = ev.tup || F(1);
  if (ev.rest && ev.rest.measure) {
    return [{ ...ev, dur: ev.len, type: F(1), dots: 0 }];
  }
  const parts = noteValues(ev.len);
  if (parts.length <= 1) {
    const p = parts[0] || { type: F(1, 4), dots: 0 };
    return [{ ...ev, type: p.type, dots: p.dots, dur: mul(ev.len, tup) }];
  }
  return parts.map((p, i) => {
    const len = mul(p.type, p.dots === 2 ? F(7, 4) : p.dots === 1 ? F(3, 2) : F(1));
    const last = i === parts.length - 1;
    const e = { ...ev, type: p.type, dots: p.dots, dur: mul(len, tup) };
    e.notes = ev.notes.map((n) => ({ ...n, tie: last ? n.tie : true }));
    if (i > 0) {
      e.beam = true; e.tiedFrom = true;
      delete e.chord; delete e.annot; delete e.lyrics; delete e.grace; delete e.decos; delete e.dyn; delete e.slurStart;
    }
    if (!last) delete e.slurEnd;
    return e;
  });
}

function numberMeasures(score) {
  // A first measure shorter than the meter is a pickup and gets number 0.
  let n = 1;
  let time = score.initial.time;
  score.measures.forEach((m, i) => {
    if (m.time) time = m.time;
    if (i === 0 && time.num) {
      const len = m.staves[0].events.reduce((a, e) => add(a, e.dur), ZERO);
      if (cmp(len, F(time.num, time.den)) < 0 && score.measures.length > 1) { m.number = 0; m.pickup = true; return; }
    }
    m.number = n;
    n += Math.max(1, m.mmCount || 1);
  });
}

// An ending runs from its first measure to the first measure that closes it:
// a repeat end, a double/final bar, the measure before another ending or a
// start repeat, or the end of the piece. Endings before a repeat end are
// closed on the right; the last ending is left open.
function markEndings(score) {
  const ms = score.measures;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (!m.ending) continue;
    let j = i;
    let closed = false;
    for (; j < ms.length; j++) {
      if (j > i && (ms[j].ending || ms[j].startRepeat)) { j--; break; }
      const b = ms[j].endBar;
      if (b === 'repeat-end') { closed = true; break; }
      if (b === 'double' || b === 'final' || b === 'thick-thin') { closed = b !== 'final'; break; }
      if (j - i >= 3 && !closed) { break; }
    }
    if (j >= ms.length) j = ms.length - 1;
    m.ending.span = j - i + 1;
    m.ending.closed = closed;
  }
}

function groupTuplets(score) {
  for (let s = 0; s < score.staves.length; s++) {
    let prev = null;
    for (const m of score.measures) {
      for (const e of m.staves[s].events) {
        if (e.tuplet) {
          if (!prev || prev.tuplet.id !== e.tuplet.id) e.tuplet.first = true;
          else delete prev.tuplet.last;
          e.tuplet.last = true;
          prev = e;
        } else prev = null;
      }
    }
  }
}

/** Display accidental for the key signature (sharps or flats) of a step. */
export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
