// Transposition, playback (performance + MIDI) and the source carried in PDFs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, performanceOf, midiFile, playOrder, transposeChord, fifthsShift, embedSource, extractSource, toPostScript } from '../src/index.js';
import { pdfString } from '../src/pdfmeta.js';

const lib = readFileSync(new URL('../lib/sm_engrave.ps', import.meta.url), 'utf8');
const tune = (body, k = 'C') => `X:1\nT:t\nM:4/4\nL:1/4\nK:${k}\n${body}\n`;
const pitches = (src, transpose = 0) => performanceOf(src, { transpose }).notes.map((n) => n.midi);

test('transpose picks the key with fewest accidentals and spells by it', () => {
  assert.equal(fifthsShift(2, -1), 2);   // F major up a tone: G major
  assert.equal(fifthsShift(1, 0), -5);   // C up a semitone: Db (5 flats), not C# (7 sharps)
  assert.equal(fifthsShift(-2, 0), -2);  // down a tone: Bb
  const s = parse(tune('F G ^G A |')).scores[0];
  const r = toPostScript(tune('F G ^G A |'), { lib, transpose: 2 });
  assert.equal(r.transposed.key, 'D');
  assert.ok(s);
});

test('transposed notes sound the interval, accidentals included', () => {
  const src = tune('C ^F =B _E | ^G2 G2 |');
  const base = pitches(src);
  for (const k of [1, 2, -3, 5, 7, -12, 11]) assert.deepEqual(pitches(src, k), base.map((m) => m + k), `transpose ${k}`);
  const src2 = tune('B, ^C D E | F G A B |', 'D');
  for (const k of [1, -1, 6, -6]) assert.deepEqual(pitches(src2, k), pitches(src2).map((m) => m + k), `D major ${k}`);
});

test('%%transpose in the source adds to the option', () => {
  const src = tune('C D E F |').replace('K:C', '%%transpose -2\nK:C');
  assert.deepEqual(pitches('%%transpose -2\n\n' + tune('C D E F |')), [58, 60, 62, 63]); // file header
  assert.deepEqual(pitches(src), [58, 60, 62, 63]);
  assert.deepEqual(pitches(src, 2), [60, 62, 64, 65]);
});

test('chord symbols move with the music', () => {
  assert.equal(transposeChord('Am7', 2), 'Bm7');
  assert.equal(transposeChord('Bb/D', 2), 'C/E');
  assert.equal(transposeChord('F#m', -5), 'Gm'); // df is in fifths: -5 = up a semitone
  assert.equal(transposeChord('Eb', 7), 'E');
  assert.equal(transposeChord('N.C.', 2), 'N.C.');
});

test('performance: key signature, accidentals through the bar, ties over the bar line', () => {
  assert.deepEqual(pitches(tune('F ^F F =F |', 'G')), [66, 66, 66, 65]);
  // ^C tied over the bar keeps its sharp; the next C in that bar is natural
  const p = performanceOf(tune('A2 z ^C- | C C z2 |')).notes.map((n) => [n.midi, n.dur[0] / n.dur[1]]);
  assert.deepEqual(p, [[69, 0.5], [61, 0.5], [60, 0.25]]);
});

test('repeats and endings are played out', () => {
  const s = parse(tune('|: C D E F |1 G4 :|2 c4 |]')).scores[0];
  assert.deepEqual(playOrder(s.measures), [0, 1, 0, 2]);
  assert.equal(performanceOf(tune('|: C D E F |1 G4 :|2 c4 |]')).notes.length, 10);
});

test('MIDI file: header, tracks, tempo', () => {
  const perf = performanceOf(tune('C D E F |').replace('L:1/4', 'L:1/4\nQ:1/4=120'));
  const m = midiFile(perf, { title: 't' });
  assert.equal(String.fromCharCode(...m.slice(0, 4)), 'MThd');
  assert.equal(m[9], 1);  // format 1
  assert.equal(m[11], 2); // conductor + one staff
  const i = m.findIndex((b, k) => b === 0xff && m[k + 1] === 0x51);
  assert.equal((m[i + 3] << 16) | (m[i + 4] << 8) | m[i + 5], 500000); // 120 bpm
});

test('PDFs carry their source and readable info', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n106\n%%EOF\n');
  const src = 'X:1\nT:Frère Jacques\nK:F\nFGAF|\n';
  const out = embedSource(pdf, { source: src, filename: 'frere.abc', title: 'Frère Jacques', mime: 'text/vnd.abc' });
  assert.deepEqual(extractSource(out), { filename: 'frere.abc', text: src });
  const tail = new TextDecoder('latin1').decode(out.slice(pdf.length));
  assert.match(tail, /\/Title <FEFF0046007200E8/);
  assert.match(tail, /\/Prev 106 >>/);
  // the xref offsets point at the objects
  for (const [, off, n] of tail.matchAll(/^(\d{10}) 00000 n $/gm).map((m, k) => [m, +m[1], k])) {
    assert.match(new TextDecoder('latin1').decode(out.slice(off, off + 12)), /^\d+ 0 obj/, `entry ${n}`);
  }
  assert.equal(extractSource(pdf), null);
  assert.equal(pdfString('a (b)'), '(a \\(b\\))');
});

test('PostScript viewer highlighting', async () => {
  const { highlight } = await import('../site/ps-viewer.js');
  const h = highlight('306 726 (Grieg \\(1875\\)) /Times-Bold 20 sm-text-c % title');
  assert.match(h, /<span class="n">306<\/span>/);
  assert.match(h, /<span class="s">\(Grieg \\\(1875\\\)\)<\/span>/);
  assert.match(h, /<span class="l">\/Times-Bold<\/span>/);
  assert.match(h, /<span class="sm" data-sm="sm-text-c">sm-text-c<\/span>/);
  assert.match(h, /<span class="c">% title<\/span>/);
  assert.equal(highlight('a < b'), 'a &lt; b');
});

test('psLiteral writes array holes as null, like JSON', async () => {
  const { psLiteral } = await import('../src/ps.js');
  const a = []; a[1] = 'x';
  assert.equal(psLiteral(a), '[null (x)]');
  assert.equal(psLiteral({ b: 1, a: [1, 2], u: undefined }), '<< /a [1 2] /b 1 >>');
});
