// What the ABC parser (lib/sm_abc_parse.ps) makes of the notation: the Score
// sm-abc-parse builds, printed with sm-abc-json (Fracs are [num den]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psLiteral } from '../src/ps.js';
import { psValues, noPscat as skip } from './pscat-run.mjs';

const val = (f) => f[0] / f[1];
// every tune of every text, in one pscat run
const parseAll = (texts) => psValues(texts.map((t) => `${psLiteral(t)} sm-abc-parse-all`));
const parse = (text) => parseAll([text])[0][0];
const tune = (body, head = 'X:1\nT:t\nM:4/4\nL:1/8\nK:C\n') => parse(head + body);
const events = (s, staff = 0) => s.measures.flatMap((m) => m.staves[staff].events);

test('keys: majors, modes and clefs', { skip }, () => {
  const keys = ['G', 'Bb', 'Em', 'D mix', 'Ddor', 'A dorian', 'F#m', 'none', 'C clef=bass'];
  const scores = parseAll(keys.map((k) => `X:1\nK:${k}\nC|\n`)).map((s) => s[0]);
  assert.deepEqual(scores.map((s) => s.initial.key.fifths), [1, -2, 1, 1, 0, 1, 3, 0, 0]);
  assert.equal(scores[8].staves[0].clef.sign, 'F');
});

test('lengths, dots and ties split from unshowable lengths', { skip }, () => {
  const s = tune('C2 D/ E3 F5 |');
  const ev = events(s);
  assert.deepEqual(ev.map((e) => [val(e.type), e.dots]), [[1 / 4, 0], [1 / 16, 0], [1 / 4, 1], [1 / 2, 0], [1 / 8, 0]]);
  // F5 = half tied to eighth
  assert.equal(ev[3].notes[0].tie, true);
  assert.equal(ev[4].tiedFrom, true);
});

test('broken rhythm and beaming by spacing', { skip }, () => {
  const ev = events(tune('A>B c<d e f g a|'));
  assert.deepEqual(ev.slice(0, 4).map((e) => val(e.dur)), [3 / 16, 1 / 16, 1 / 16, 3 / 16]);
  assert.equal(ev[1].beam, true); // A>B written together
  assert.equal(ev[2].beam, false); // space before c
  assert.equal(ev[5].beam, false);
});

test('triplets scale time but keep the written note value', { skip }, () => {
  const ev = events(tune('(3ABc d2 e2 f2|'));
  assert.equal(val(ev[0].dur), 1 / 12);
  assert.equal(val(ev[0].type), 1 / 8);
  assert.equal(ev[0].tuplet.p, 3);
  assert.ok(ev[0].tuplet.first && ev[2].tuplet.last);
});

test('chords, accidentals, decorations, chord symbols, grace notes', { skip }, () => {
  const ev = events(tune('"Am7"!fermata![^ce_g]2 {/d}=c4 .A2|'));
  assert.equal(ev[0].chord, 'Am7');
  assert.deepEqual(ev[0].decos, ['fermata']);
  assert.deepEqual(ev[0].notes.map((n) => n.acc), ['sharp', null, 'flat']);
  assert.equal(ev[1].grace.slash, true);
  assert.equal(ev[1].notes[0].acc, 'natural');
  assert.deepEqual(ev[2].decos, ['staccato']);
});

test('bar lines, repeats and endings', { skip }, () => {
  const s = tune('|: A8 |1 B8 :|2 c8 || d8 |]');
  assert.equal(s.measures.length, 4);
  assert.equal(s.measures[0].startRepeat, true);
  assert.equal(s.measures[1].ending.label, '1');
  assert.equal(s.measures[1].endBar, 'repeat-end');
  assert.equal(s.measures[1].ending.closed, true);
  assert.equal(s.measures[2].ending.label, '2');
  assert.equal(s.measures[2].endBar, 'double');
  assert.equal(s.measures[3].endBar, 'final');
});

test('lyrics: hyphens, melisma, skips and tied notes', { skip }, () => {
  const ev = events(tune('A2 B2- B2 c2 | d2 e2 f4 |\nw: syl-la-ble_ * end\n')).filter((e) => e.kind === 'note');
  const ly = ev.map((e) => (e.lyrics && e.lyrics[0] ? e.lyrics[0].text : null));
  // the tied B2 continuation takes no syllable
  assert.deepEqual(ly, ['syl', 'la', null, 'ble', null, null, 'end']);
  assert.equal(ev[0].lyrics[0].hyphen, true);
  assert.equal(ev[3].lyrics[0].extend, true);
});

test('pickup measure is numbered 0', { skip }, () => {
  const s = tune('D2 | G8 | A8 |');
  assert.equal(s.measures[0].number, 0);
  assert.equal(s.measures[1].number, 1);
});

test('voices become staves; %%score braces', { skip }, () => {
  const s = tune('V:1\nC8|\nV:2\nC,8|\n', 'X:1\nT:t\nM:4/4\nL:1/8\n%%score {1 2}\nV:1 clef=treble\nV:2 clef=bass\nK:C\n');
  assert.equal(s.staves.length, 2);
  assert.equal(s.staves[1].clef.sign, 'F');
  assert.equal(s.group, 'brace');
});

test('several tunes in one file', { skip }, () => {
  const [scores] = parseAll(['X:1\nT:One\nK:C\nC|\n\nX:2\nT:Two\nK:G\nG|\n']);
  assert.deepEqual(scores.map((s) => s.meta.title), ['One', 'Two']);
});

test('text escapes become accented letters', { skip }, () => {
  const s = tune('C|', "X:1\nT:Fr\\`ere et caf\\'e\nK:C\n");
  assert.equal(s.meta.title, 'Frère et café');
});
