import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseABC } from '../src/abc.js';
import { parseKeyText } from '../src/score.js';
import { val } from '../src/frac.js';

const tune = (body, head = 'X:1\nT:t\nM:4/4\nL:1/8\nK:C\n') => {
  const { scores, warnings } = parseABC(head + body);
  return { s: scores[0], warnings };
};
const events = (s, staff = 0) => s.measures.flatMap((m) => m.staves[staff].events);

test('keys: majors, modes and clefs', () => {
  assert.equal(parseKeyText('G').key.fifths, 1);
  assert.equal(parseKeyText('Bb').key.fifths, -2);
  assert.equal(parseKeyText('Em').key.fifths, 1);
  assert.equal(parseKeyText('D mix').key.fifths, 1);
  assert.equal(parseKeyText('Ddor').key.fifths, 0);
  assert.equal(parseKeyText('A dorian').key.fifths, 1);
  assert.equal(parseKeyText('F#m').key.fifths, 3);
  assert.equal(parseKeyText('none').key.fifths, 0);
  assert.equal(parseKeyText('C clef=bass').clef.sign, 'F');
});

test('lengths, dots and ties split from unshowable lengths', () => {
  const { s } = tune('C2 D/ E3 F5 |');
  const ev = events(s);
  assert.deepEqual(ev.map((e) => [val(e.type), e.dots]), [[1 / 4, 0], [1 / 16, 0], [1 / 4, 1], [1 / 2, 0], [1 / 8, 0]]);
  // F5 = half tied to eighth
  assert.equal(ev[3].notes[0].tie, true);
  assert.equal(ev[4].tiedFrom, true);
});

test('broken rhythm and beaming by spacing', () => {
  const { s } = tune('A>B c<d e f g a|');
  const ev = events(s);
  assert.deepEqual(ev.slice(0, 4).map((e) => val(e.dur)), [3 / 16, 1 / 16, 1 / 16, 3 / 16]);
  assert.equal(ev[1].beam, true); // A>B written together
  assert.equal(ev[2].beam, false); // space before c
  assert.equal(ev[5].beam, false);
});

test('triplets scale time but keep the written note value', () => {
  const { s } = tune('(3ABc d2 e2 f2|');
  const ev = events(s);
  assert.equal(val(ev[0].dur), 1 / 12);
  assert.equal(val(ev[0].type), 1 / 8);
  assert.equal(ev[0].tuplet.p, 3);
  assert.ok(ev[0].tuplet.first && ev[2].tuplet.last);
});

test('chords, accidentals, decorations, chord symbols, grace notes', () => {
  const { s } = tune('"Am7"!fermata![^ce_g]2 {/d}=c4 .A2|');
  const ev = events(s);
  assert.equal(ev[0].chord, 'Am7');
  assert.deepEqual(ev[0].decos, ['fermata']);
  assert.deepEqual(ev[0].notes.map((n) => n.acc), ['sharp', null, 'flat']);
  assert.equal(ev[1].grace.slash, true);
  assert.equal(ev[1].notes[0].acc, 'natural');
  assert.deepEqual(ev[2].decos, ['staccato']);
});

test('bar lines, repeats and endings', () => {
  const { s } = tune('|: A8 |1 B8 :|2 c8 || d8 |]');
  assert.equal(s.measures.length, 4);
  assert.equal(s.measures[0].startRepeat, true);
  assert.equal(s.measures[1].ending.label, '1');
  assert.equal(s.measures[1].endBar, 'repeat-end');
  assert.equal(s.measures[1].ending.closed, true);
  assert.equal(s.measures[2].ending.label, '2');
  assert.equal(s.measures[2].endBar, 'double');
  assert.equal(s.measures[3].endBar, 'final');
});

test('lyrics: hyphens, melisma, skips and tied notes', () => {
  const { s } = tune('A2 B2- B2 c2 | d2 e2 f4 |\nw: syl-la-ble_ * end\n');
  const ev = events(s).filter((e) => e.kind === 'note');
  const ly = ev.map((e) => (e.lyrics && e.lyrics[0] ? e.lyrics[0].text : null));
  // the tied B2 continuation takes no syllable
  assert.deepEqual(ly, ['syl', 'la', null, 'ble', null, null, 'end']);
  assert.equal(ev[0].lyrics[0].hyphen, true);
  assert.equal(ev[3].lyrics[0].extend, true);
});

test('pickup measure is numbered 0', () => {
  const { s } = tune('D2 | G8 | A8 |');
  assert.equal(s.measures[0].number, 0);
  assert.equal(s.measures[1].number, 1);
});

test('voices become staves; %%score braces', () => {
  const { s } = tune('V:1\nC8|\nV:2\nC,8|\n', 'X:1\nT:t\nM:4/4\nL:1/8\n%%score {1 2}\nV:1 clef=treble\nV:2 clef=bass\nK:C\n');
  assert.equal(s.staves.length, 2);
  assert.equal(s.staves[1].clef.sign, 'F');
  assert.equal(s.group, 'brace');
});

test('several tunes in one file', () => {
  const { scores } = parseABC('X:1\nT:One\nK:C\nC|\n\nX:2\nT:Two\nK:G\nG|\n');
  assert.deepEqual(scores.map((s) => s.meta.title), ['One', 'Two']);
});

test('text escapes become accented letters', () => {
  const { s } = tune('C|', "X:1\nT:Fr\\`ere et caf\\'e\nK:C\n");
  assert.equal(s.meta.title, 'Frère et café');
});
