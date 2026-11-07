// Playback output: the notes PostScript plays, turned into a MIDI file.
//
// lib/sm_perform.ps sm-abc-performance prints a tune's notes as one JSON
// line: { notes: [{ at, dur, midi, staff }], length, tempo: { beat, bpm },
// staves, title }, with at/dur/length/beat as Fracs ([num den]) of a whole
// note from the start, so the result is the same on every machine. Repeats
// and endings are played out, ties joined, pitches taken from the key
// signature and the accidentals carried through the bar. The editor plays
// those events with Web Audio (wholeSeconds gives the tempo) and
// `sheet -o x.mid` writes them with midiFile (format 1, one track per staff).
import { add, val } from './frac.js';

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
