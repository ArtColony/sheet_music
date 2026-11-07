// Transposition, playback (performance + MIDI) and the source carried in PDFs.
// The notes and the transposition come from PostScript (lib/sm_perform.ps,
// lib/sm_transpose.ps); JavaScript writes the MIDI file and the PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { midiFile, embedSource, extractSource } from '../src/index.js';
import { pdfString } from '../src/pdfmeta.js';
import { psMeta } from '../bin/sheet.mjs';
import { psValues, psPerformances, noPscat as skip } from './pscat-run.mjs';
import { psLiteral } from '../src/ps.js';

const tune = (body, k = 'C') => `X:1\nT:t\nM:4/4\nL:1/4\nK:${k}\n${body}\n`;
const performance = (src, opts = {}) => psPerformances([[src, opts]])[0];
// the sounding MIDI numbers of each [text, transpose], in one pscat run
const pitchesOf = (cases) => psPerformances(cases.map(([src, transpose = 0]) => [src, { transpose }])).map((p) => p.notes.map((n) => n.midi));
const pitches = (src, transpose = 0) => pitchesOf([[src, transpose]])[0];

test('transpose picks the key with fewest accidentals and spells by it', { skip }, () => {
  // F major up a tone: G major; C up a semitone: Db (5 flats), not C# (7 sharps); down a tone: Bb
  assert.deepEqual(psValues(['2 -1 sm-transpose-fifths-shift', '1 0 sm-transpose-fifths-shift', '-2 0 sm-transpose-fifths-shift']), [2, -5, -2]);
  assert.equal(psMeta(tune('F G ^G A |'), { transpose: 2 }).transposed.key, 'D');
});

test('transposed notes sound the interval, accidentals included', { skip }, () => {
  const src = tune('C ^F =B _E | ^G2 G2 |');
  const src2 = tune('B, ^C D E | F G A B |', 'D');
  const ks = [1, 2, -3, 5, 7, -12, 11], ks2 = [1, -1, 6, -6];
  const [base, ...rest] = pitchesOf([[src], ...ks.map((k) => [src, k])]);
  ks.forEach((k, i) => assert.deepEqual(rest[i], base.map((m) => m + k), `transpose ${k}`));
  const [base2, ...rest2] = pitchesOf([[src2], ...ks2.map((k) => [src2, k])]);
  ks2.forEach((k, i) => assert.deepEqual(rest2[i], base2.map((m) => m + k), `D major ${k}`));
});

test('%%transpose in the source adds to the option', { skip }, () => {
  const src = tune('C D E F |').replace('K:C', '%%transpose -2\nK:C');
  assert.deepEqual(pitchesOf([['%%transpose -2\n\n' + tune('C D E F |')], [src], [src, 2]]), [[58, 60, 62, 63], [58, 60, 62, 63], [60, 62, 64, 65]]); // file header, tune, plus the option
});

test('chord symbols move with the music', { skip }, () => {
  // df is in fifths: -5 = up a semitone
  const cases = [['Am7', 2, 'Bm7'], ['Bb/D', 2, 'C/E'], ['F#m', -5, 'Gm'], ['Eb', 7, 'E'], ['N.C.', 2, 'N.C.']];
  assert.deepEqual(psValues(cases.map(([c, df]) => `${psLiteral(c)} ${df} sm-transpose-chord`)), cases.map((c) => c[2]));
});

test('performance: key signature, accidentals through the bar, ties over the bar line', { skip }, () => {
  const [a, b] = psPerformances([[tune('F ^F F =F |', 'G')], [tune('A2 z ^C- | C C z2 |')]]);
  assert.deepEqual(a.notes.map((n) => n.midi), [66, 66, 66, 65]);
  // ^C tied over the bar keeps its sharp; the next C in that bar is natural
  assert.deepEqual(b.notes.map((n) => [n.midi, n.dur[0] / n.dur[1]]), [[69, 0.5], [61, 0.5], [60, 0.25]]);
});

test('repeats and endings are played out', { skip }, () => {
  // bars 1, 2 (first ending), 1 again, 3 (second ending)
  const p = performance(tune('|: C D E F |1 G4 :|2 c4 |]'));
  assert.deepEqual(p.notes.map((n) => n.midi), [60, 62, 64, 65, 67, 60, 62, 64, 65, 72]);
  assert.deepEqual(p.notes.map((n) => n.at[0] / n.at[1]), [0, 0.25, 0.5, 0.75, 1, 2, 2.25, 2.5, 2.75, 3]);
});

test('MIDI file: header, tracks, tempo', { skip }, () => {
  const perf = performance(tune('C D E F |').replace('L:1/4', 'L:1/4\nQ:1/4=120'));
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
