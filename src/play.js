// Playback: a Score -> the notes it sounds, in order, with exact times.
//
// Times are Fracs of a whole note from the start (so the result is the same
// on every machine); the caller turns them into seconds with the tempo.
// Repeats and 1st/2nd endings are played out; ties join notes; pitches come
// from the key signature and accidentals carried through the bar, as written.
// Grace notes, D.C./D.S. and dynamics are not performed.
//
// midiFile() writes the result as a Standard MIDI File (format 1, one track
// per staff).
//
// The editor and `sheet -o x.mid` take the events from PostScript instead
// (lib/sm_perform.ps sm-abc-performance prints exactly this structure as
// JSON); performance() stays as the reference that tests/ps-perform.test.mjs
// compares it with, and for `--engine js`.
import { F, add, mul, ZERO, cmp, val } from './frac.js';
import { SHARP_ORDER, FLAT_ORDER } from './score.js';

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER = { sharp: 1, dsharp: 2, flat: -1, dflat: -2, natural: 0 };

function keyAlters(fifths) {
  const a = {};
  for (let k = 0; k < Math.abs(fifths); k++) a[(fifths > 0 ? SHARP_ORDER : FLAT_ORDER)[k]] = fifths > 0 ? 1 : -1;
  return a;
}

function endingNumbers(label) {
  const out = [];
  for (const part of String(label).split(/[,\s]+/)) {
    const r = /^(\d+)(?:-(\d+))?/.exec(part);
    if (!r) continue;
    for (let n = +r[1]; n <= +(r[2] || r[1]); n++) out.push(n);
  }
  return out.length ? out : [1];
}

/** Indices of the measures in the order they are played (repeats and endings). */
export function playOrder(measures) {
  const order = [];
  let start = 0, pass = 1, guard = 0;
  for (let i = 0; i < measures.length && guard++ < 10000;) {
    const m = measures[i];
    if (m.startRepeat && start !== i) { start = i; pass = 1; }
    if (m.ending && !endingNumbers(m.ending.label).includes(pass)) { i += m.ending.span || 1; continue; }
    order.push(i);
    if (m.endBar === 'repeat-end') {
      const more = measures.slice(start, i + 1).some((x) => x.ending && endingNumbers(x.ending.label).includes(pass + 1))
        || measures.slice(i + 1).some((x, k) => x.ending && endingNumbers(x.ending.label).includes(pass + 1) && k < 8);
      if (pass === 1 || more) { pass++; i = start; continue; }
      start = i + 1; pass = 1;
    }
    i++;
  }
  return order;
}

function measureLength(m, time) {
  let len = ZERO;
  for (const st of m.staves) {
    const l = st.events.reduce((a, e) => (e.grace ? a : add(a, e.dur)), ZERO);
    if (cmp(l, len) > 0) len = l;
  }
  if (m.mmCount > 1) len = mul(len, F(m.mmCount));
  if (!len[0] && time && time.num) len = F(time.num, time.den);
  return len;
}

/**
 * The notes a score sounds: { notes: [{ at, dur, midi, staff }], length,
 * tempo: { beat, bpm } } with at/dur/length as Fracs of a whole note.
 */
export function performance(score) {
  const ms = score.measures;
  const order = playOrder(ms);
  // key and time in force at each measure, in written order
  const keyAt = [], timeAt = [];
  let key = score.initial.key, time = score.initial.time;
  ms.forEach((m, i) => { if (m.key) key = m.key; if (m.time) time = m.time; keyAt[i] = key; timeAt[i] = time; });
  const notes = [];
  let t = ZERO;
  const held = score.staves.map(() => new Map()); // tied-over notes: "step/oct" -> note
  for (const i of order) {
    const m = ms[i];
    const kA = keyAlters(keyAt[i].fifths || 0);
    m.staves.forEach((st, s) => {
      const carry = {}; // accidentals carried through the bar: "step/oct" -> alter
      let at = t;
      const nextHeld = new Map();
      for (const e of st.events) {
        if (e.grace) continue;
        if (e.kind === 'note') {
          for (const n of e.notes) {
            const id = n.step + '/' + n.oct;
            if (n.acc) carry[id] = ALTER[n.acc] ?? 0;
            const prev = held[s].get(id) || nextHeld.get(id);
            // a note tied over the bar line keeps its pitch (and accidental)
            const alter = id in carry ? carry[id] : prev && !n.acc ? null : kA[n.step] || 0;
            const midi = alter === null ? prev.midi : 12 * (n.oct + 1) + PC[n.step] + alter;
            let note;
            if (prev && prev.midi === midi && cmp(add(prev.at, prev.dur), at) === 0) { prev.dur = add(prev.dur, e.dur); note = prev; }
            else { note = { at, dur: e.dur, midi, staff: s }; notes.push(note); }
            held[s].delete(id); nextHeld.delete(id);
            if (n.tie) nextHeld.set(id, note);
          }
        }
        at = add(at, e.dur);
      }
      held[s] = nextHeld;
    });
    t = add(t, measureLength(m, timeAt[i]));
  }
  notes.sort((a, b) => cmp(a.at, b.at) || a.staff - b.staff || a.midi - b.midi);
  const tp = score.tempo && score.tempo.bpm ? { beat: score.tempo.beat || F(1, 4), bpm: score.tempo.bpm } : { beat: F(1, 4), bpm: 100 };
  return { notes, length: t, tempo: tp, staves: score.staves.length };
}

/** Seconds per whole note at the performance's tempo. */
export const wholeSeconds = (perf) => 60 / perf.tempo.bpm / val(perf.tempo.beat);

/** A Standard MIDI File (Uint8Array) for a performance. */
export function midiFile(perf, { title = '', program = 0 } = {}) {
  const PPQ = 480;
  const ticks = (f) => Math.round(val(f) * 4 * PPQ);
  const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (id, data) => [...Array.from(id, (c) => c.charCodeAt(0)), ...u32(data.length), ...data];
  const track = (events) => {
    events.sort((a, b) => a.t - b.t || a.order - b.order);
    const out = []; let now = 0;
    for (const ev of events) { out.push(...vlq(ev.t - now), ...ev.bytes); now = ev.t; }
    out.push(0, 0xff, 0x2f, 0);
    return chunk('MTrk', out);
  };
  const usPerQuarter = Math.round(wholeSeconds(perf) / 4 * 1e6);
  const name = Array.from(new TextEncoder().encode(title));
  const conductor = [{ t: 0, order: 0, bytes: [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] }];
  if (name.length) conductor.push({ t: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] });
  const tracks = [track(conductor)];
  for (let s = 0; s < perf.staves; s++) {
    const ch = s & 15;
    const evs = [{ t: 0, order: 0, bytes: [0xc0 | ch, program & 127] }];
    for (const n of perf.notes) {
      if (n.staff !== s || n.midi < 0 || n.midi > 127) continue;
      evs.push({ t: ticks(n.at), order: 2, bytes: [0x90 | ch, n.midi, 80] });
      evs.push({ t: ticks(add(n.at, n.dur)), order: 1, bytes: [0x80 | ch, n.midi, 0] });
    }
    tracks.push(track(evs));
  }
  return Uint8Array.from([...chunk('MThd', [0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255]), ...tracks.flat()]);
}
