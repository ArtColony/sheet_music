// The audio-to-sheet-music skill's MIDI -> ABC step
// (plugin/skills/audio-to-sheet-music/scripts/midi2abc.py), without any
// model: our samples' own notes (sm-abc-performance) go out as MIDI
// (src/play.js midiFile), come back as ABC, and must play the same notes
// (onset, length and pitch, exactly) and check clean in PostScript. Needs
// python3 (the standard library only); skipped when it is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, noPscat, runPS, psPerformances } from './pscat-run.mjs';
import { midiFile } from '../src/play.js';
import { F, add } from '../src/frac.js';
import { psLiteral } from '../src/ps.js';

const SCRIPT = path.join(root, 'plugin/skills/audio-to-sheet-music/scripts/midi2abc.py');
let python = null;
for (const p of ['python3', 'python']) {
  try { if (/Python 3\./.test(execFileSync(p, ['--version'], { encoding: 'utf8', stdio: 'pipe' }))) { python = p; break; } } catch { /* next */ }
}
const skip = noPscat || (!python && 'python3 not installed');

// not feature-tour: its triplets are off the sixteenth-note grid (midi2abc writes no tuplets)
const SAMPLES = ['twinkle', 'amazing-grace', 'ode-to-joy', 'greensleeves', 'drunken-sailor', 'camptown-races', 'mountain-king'];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'midi2abc-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

/** midi2abc on a MIDI file (bytes) with these arguments: the ABC text. */
function midi2abc(name, bytes, args = []) {
  const file = path.join(tmp, `${name}.mid`);
  writeFileSync(file, bytes);
  // -B: no __pycache__ inside plugin/
  return execFileSync(python, ['-B', SCRIPT, file, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** The notes a performance plays, as sorted "onset dur midi" strings (whole-note fractions). */
const fr = (f) => `${F(f[0], f[1])[0]}/${F(f[0], f[1])[1]}`;
const notesOf = (perf) => perf.notes.map((n) => `${fr(n.at)} ${fr(n.dur)} ${n.midi}`).sort();
/** A copy of perf with the notes moved and blurred the way a transcription is: early/late, overlapping, one track. */
function blurred(perf) {
  const jitter = [F(-1, 96), F(1, 128), F(0), F(1, 80), F(-1, 112)]; // under half a sixteenth
  const notes = perf.notes.map((n, i) => ({
    at: add(n.at, i ? jitter[i % 5] : F(0)), // the first note on time (leading silence is trimmed)
    dur: add(n.dur, jitter[(i + 2) % 5]),
    midi: n.midi, staff: 0,
  }));
  return { ...perf, notes, staves: 1 };
}

let perfs = null, outs = null, blurs = null;
const setup = () => {
  if (perfs) return;
  perfs = psPerformances(SAMPLES.map((s) => [readFileSync(path.join(root, 'samples', s + '.abc'), 'utf8')]));
  outs = SAMPLES.map((s, i) => midi2abc(s, midiFile(perfs[i], { title: perfs[i].title })));
  blurs = SAMPLES.map((s, i) => midi2abc(s + '-blur', midiFile(blurred(perfs[i]), { title: perfs[i].title })));
};

test('midi2abc: our samples come back with the same notes (onset, length, pitch)', { skip }, () => {
  setup();
  const back = psPerformances(outs.map((abc) => [abc]));
  SAMPLES.forEach((s, i) => assert.deepEqual(notesOf(back[i]), notesOf(perfs[i]), `${s}:\n${outs[i]}`));
});

test('midi2abc: notes off the grid and on one track are quantized back and split onto two staves', { skip }, () => {
  setup();
  const back = psPerformances(blurs.map((abc) => [abc]));
  SAMPLES.forEach((s, i) => assert.deepEqual(notesOf(back[i]), notesOf(perfs[i]), `${s} (blurred):\n${blurs[i]}`));
  // ode-to-joy's two hands, merged into one track, are two staves again
  const ode = blurs[SAMPLES.indexOf('ode-to-joy')];
  assert.match(ode, /^%%score \{RH LH\}$/m);
  assert.match(ode, /^V:LH clef=bass$/m);
});

test('midi2abc: what it writes checks clean (bars add up, no warnings)', { skip }, () => {
  setup();
  const all = [...outs, ...blurs];
  const out = runPS('(lib/sheet.ps) run\n' + all.map((abc) => `${psLiteral(abc)} sm-abc-check-string`).join('\n') + '\n0 0 1 1 rectfill showpage\n');
  assert.equal((out.match(/^sm-abc: ok$/gm) || []).length, all.length, out);
  assert.equal(out.match(/^sm-abc: (warning|bar) .*$/gm), null, out);
});

test('midi2abc: meter, key and pickup are recovered for simple tunes', { skip }, () => {
  setup();
  const head = (abc, k) => (new RegExp(`^${k}:(.*)$`, 'm').exec(abc) || [])[1];
  for (const s of ['twinkle', 'amazing-grace', 'ode-to-joy', 'greensleeves']) {
    const src = readFileSync(path.join(root, 'samples', s + '.abc'), 'utf8');
    const abc = outs[SAMPLES.indexOf(s)];
    assert.equal(head(abc, 'M'), head(src, 'M'), `${s}: meter`);
    assert.equal(head(abc, 'K'), head(src, 'K'), `${s}: key`);
    assert.equal(head(abc, 'Q'), head(src, 'Q'), `${s}: tempo`);
  }
  // the pickups: Amazing Grace and Greensleeves start on the last beat, Twinkle on the downbeat
  assert.match(outs[SAMPLES.indexOf('amazing-grace')], /^D2 \| G4 BG \|/m);
  assert.match(outs[SAMPLES.indexOf('greensleeves')], /^A2 \| c4 d2 \|/m);
  assert.match(outs[SAMPLES.indexOf('twinkle')], /^C2 C2 G2 G2 \| A2 A2 G4 \|/m);
  // the options win over the guesses
  const tw = midi2abc('twinkle-opts', midiFile(perfs[0]), ['--meter', '2/4', '--key', 'F', '--title', 'T', '--bars-per-line', '8']);
  assert.match(tw, /^M:2\/4$/m);
  assert.match(tw, /^K:F$/m);
  assert.match(tw, /^T:T$/m);
});

test('midi2abc: --bpm reads MIDI played freely against a default tempo; --pickup sets the first bar', { skip }, () => {
  setup();
  // Twinkle played at 100 bpm into a file that says 120: every time is 6/5 as long in beats
  const tw = perfs[0];
  const scale = (f) => F(f[0] * 6, f[1] * 5);
  const free = { ...tw, tempo: { beat: [1, 4], bpm: 120 }, notes: tw.notes.map((n) => ({ ...n, at: scale(n.at), dur: scale(n.dur) })) };
  const abc = midi2abc('twinkle-free', midiFile(free), ['--bpm', '100']);
  assert.match(abc, /^Q:1\/4=100$/m);
  assert.deepEqual(notesOf(psPerformances([[abc]])[0]), notesOf(tw));
  // Amazing Grace: the guessed pickup, the same given, and none
  const ag = perfs[SAMPLES.indexOf('amazing-grace')];
  const given = midi2abc('ag-pickup', midiFile(ag, { title: ag.title }), ['--pickup', '1/4']);
  const none = midi2abc('ag-nopickup', midiFile(ag), ['--pickup', '0']);
  assert.equal(given, outs[SAMPLES.indexOf('amazing-grace')]);
  assert.match(none, /^D2 G4 \| BG B4 \|/m);
  const out = runPS('(lib/sheet.ps) run\n' + psLiteral(none) + ' sm-abc-check-string\n0 0 1 1 rectfill showpage\n');
  assert.match(out, /^sm-abc: ok$/m);
});

test('midi2abc: the same MIDI gives the same bytes; --notes lists the notes', { skip }, () => {
  setup();
  const again = midi2abc('again', midiFile(blurred(perfs[2]), { title: perfs[2].title }));
  assert.equal(again, blurs[2]);
  const notes = JSON.parse(midi2abc('twinkle-notes', midiFile(perfs[0]), ['--notes']));
  assert.equal(notes.length, perfs[0].notes.length);
  assert.deepEqual(notes[0], ['0', '1', 60]); // [onset, length] in quarter notes, MIDI pitch
});

test('midi2abc: a file that is not MIDI fails with a message', { skip }, () => {
  assert.throws(() => midi2abc('bad', Buffer.from('not midi at all')), /not a Standard MIDI File/);
});
