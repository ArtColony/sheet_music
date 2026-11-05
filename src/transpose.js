// Transposition of a parsed Score by a number of semitones.
//
// Pitches are moved along the line of fifths (F C G D A E B = -1..5, a sharp
// is +7, a flat -7), so spelling follows the new key: up a tone from F major
// gives G major with F#, not Gb. The fifths shift is chosen once, from the
// first key, so that key has the fewest accidentals (at most 6); every key
// change, explicit accidental and chord symbol then moves by the same shift.
// Notes without an accidental stay without one: they follow the new key
// signature and any accidental earlier in the bar exactly as before.

const LOF = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER = { sharp: 1, dsharp: 2, flat: -1, dflat: -2, natural: 0 };
const ACC_OF = { 1: 'sharp', 2: 'dsharp', '-1': 'flat', '-2': 'dflat', 0: 'natural' };

const mod = (a, n) => ((a % n) + n) % n;

/** Line-of-fifths position -> { step, alter }. */
function fromLof(p) {
  const i = mod(p + 1, 7);
  return { step: LETTERS[i], alter: (p + 1 - i) / 7 };
}

/** The fifths shift for `semis` that leaves `fifths` with the fewest accidentals. */
export function fifthsShift(semis, fifths = 0) {
  const base = mod(7 * semis, 12); // 7 fifths = 1 semitone (mod 12)
  const cands = [base, base - 12];
  cands.sort((a, b) => Math.abs(fifths + a) - Math.abs(fifths + b) || a - b);
  return cands[0];
}

/** Move one pitch: { step, oct, alter } by semis, along the fifths shift df. */
export function movePitch({ step, oct, alter }, semis, df, respell = true) {
  const midi = 12 * oct + PC[step] + alter + semis;
  let { step: s, alter: a } = fromLof(LOF[step] + 7 * alter + df);
  if (respell && Math.abs(a) > 2) { // a triple accidental: respell enharmonically
    const r = fromLof(LOF[step] + 7 * alter + df - 12 * Math.sign(a));
    s = r.step; a = r.alter;
  }
  return { step: s, alter: a, oct: (midi - PC[s] - a) / 12 };
}

const CHORD_RE = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/;
const accOfChord = { '#': 1, '♯': 1, b: -1, '♭': -1, '': 0 };
function chordRoot(letter, acc, df) {
  let p = LOF[letter] + 7 * (accOfChord[acc] || 0) + df;
  while (p > 5 + 7) p -= 12; // keep chord names to one sharp or flat
  while (p < -1 - 7) p += 12;
  const { step, alter } = fromLof(p);
  return step + (alter > 0 ? '#' : alter < 0 ? 'b' : '');
}

/** "Am7" -> "Bm7" (df = +2). Text that is not a chord name is returned unchanged. */
export function transposeChord(text, df) {
  return text.split(' ').map((t) => {
    const m = CHORD_RE.exec(t);
    if (!m) return t;
    return chordRoot(m[1], m[2], df) + m[3] + (m[4] ? '/' + chordRoot(m[4], m[5], df) : '');
  }).join(' ');
}

const keyName = (f) => fromLof(f).step + (f > 5 ? '#' : f < -1 ? 'b' : '');

/** Transpose a Score in place by `semis` semitones (any integer). Returns it. */
export function transposeScore(score, semis) {
  semis = Math.trunc(semis || 0);
  if (!semis) return score;
  const df = fifthsShift(semis, score.initial.key.fifths || 0);
  const moveKey = (k) => {
    if (!k) return;
    let f = (k.fifths || 0) + df;
    if (f > 7) f -= 12; if (f < -7) f += 12;
    k.fifths = f;
  };
  moveKey(score.initial.key);
  const moveNote = (n) => {
    const alter = n.acc ? ALTER[n.acc] ?? 0 : 0;
    const p = movePitch({ step: n.step, oct: n.oct, alter }, semis, df, !!n.acc);
    n.step = p.step; n.oct = p.oct;
    if (n.acc) n.acc = ACC_OF[p.alter];
  };
  for (const m of score.measures) {
    if (m.key && m.key !== score.initial.key) moveKey(m.key);
    for (const st of m.staves) {
      for (const e of st.events) {
        for (const n of e.notes || []) moveNote(n);
        if (e.grace) for (const n of e.grace.notes) moveNote(n);
        if (e.chord) e.chord = transposeChord(e.chord, df);
      }
    }
  }
  score.transposed = { semis, key: keyName(score.initial.key.fifths) };
  return score;
}

/** `%%transpose N` in an ABC tune (or a MusicXML comment): semitones, or 0. */
export function sourceTranspose(src) {
  const m = /^[ \t]*(?:<!--[ \t]*)?%%transpose[ \t]+([+-]?\d+)/m.exec(src);
  return m ? parseInt(m[1], 10) : 0;
}
