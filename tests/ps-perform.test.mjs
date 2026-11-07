// Playback events from PostScript (lib/sm_perform.ps, sm-abc-performance)
// must be exactly what src/play.js performance() computes: every sample,
// every tune of the parse edge-case fixture, a tune made to reach the
// corners (ties over bar lines, carried accidentals, nested endings, a
// multi-measure rest, two voices), each at several transpositions. ABC is
// parsed by PostScript; MusicXML goes in as the JS parser's Score literal.
// The JS side only turns these events into sound or a MIDI file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, performanceOf, midiFile } from '../src/index.js';
import { splitTunes } from '../src/abc.js';
import { psLiteral } from '../src/ps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-perform-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const read = (f) => readFileSync(path.join(root, f), 'utf8');

const CORNERS = `X:1
T:Corners
M:3/4
L:1/8
Q:3/8=60
K:Bb
V:1
|: ^c2 c2- c2 | c6- | c2 =B2 B2 :|1 [CEG]6 :|2 _e2 e2 (3fga |]
Z2 | "Am" A4 z2 |[M:2/4] B,4 |
V:2 clef=bass
|: C,6 | D,6- | D,6 :|1 E,6 :|2 F,6 |]
Z2 | A,,4 z2 |[M:2/4] B,,4 |
`;

// cases: [label, PostScript operand (text or Score literal), options, JS performanceOf args]
function cases() {
  const out = [];
  const semisList = [0, 2, -5];
  for (const f of readdirSync(path.join(root, 'samples')).filter((x) => /\.(abc|musicxml)$/.test(x)).sort()) {
    const src = read('samples/' + f);
    for (const k of semisList) {
      const operand = f.endsWith('.musicxml') ? psLiteral(parse(src).scores[0]) : psLiteral(src);
      out.push([`${f} ${k}`, operand, `<< /transpose ${k} >>`, [src, { transpose: k }]]);
    }
  }
  const edge = read('tests/fixtures/parse-edge.abc');
  splitTunes(edge).forEach((_, t) => {
    for (const k of semisList) out.push([`parse-edge.abc /tune ${t} ${k}`, psLiteral(edge), `<< /tune ${t} /transpose ${k} >>`, [edge, { tune: t, transpose: k }]]);
  });
  for (const k of semisList) out.push([`corners ${k}`, psLiteral(CORNERS), `<< /transpose ${k} >>`, [CORNERS, { transpose: k }]]);
  return out;
}

function pscat(prog) {
  const file = path.join(tmp, `p${Math.random().toString(36).slice(2)}.ps`);
  writeFileSync(file, prog);
  const r = spawnSync(PSCAT, ['--pdf', path.join(tmp, 'out.pdf'), file], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw Error(`pscat failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout.replace(/^pscat: .*\n/gm, '');
}

test('sm-abc-performance prints exactly play.js\'s events (samples, fixture, corners; transposed)', { skip }, () => {
  const cs = cases();
  const prog = ['(lib/sheet.ps) run', ...cs.map(([, operand, opts]) => `${operand} ${opts} sm-abc-performance`)].join('\n') + '\n';
  const lines = pscat(prog).split('\n').filter((l) => l.startsWith('{'));
  assert.equal(lines.length, cs.length, 'one JSON line per case');
  cs.forEach(([label, , , [src, opts]], i) => {
    const js = JSON.parse(JSON.stringify(performanceOf(src, opts)));
    assert.ok(js.notes.length > 0, `${label}: no notes`);
    assert.deepEqual(JSON.parse(lines[i]), js, `${label}: PostScript events differ from play.js`);
  });
});

test('the corners tune really has the corners (ties, repeats, endings, two staves)', () => {
  const p = performanceOf(CORNERS);
  assert.equal(p.staves, 2);
  assert.ok(p.notes.some((n) => n.dur[0] / n.dur[1] > 1), 'a note tied across bars');
  assert.deepEqual(p.tempo, { beat: [3, 8], bpm: 60 });
});

test('sm-abc-performance-file, the default options, and the MIDI file made from PostScript events', { skip }, () => {
  const out = pscat('(lib/sheet.ps) run (samples/greensleeves.abc) sm-abc-performance-file\n(samples/greensleeves.abc) << /transpose 2 >> sm-abc-performance-file\n');
  const [a, b] = out.trim().split('\n').map((l) => JSON.parse(l));
  const src = read('samples/greensleeves.abc');
  assert.deepEqual(a, JSON.parse(JSON.stringify(performanceOf(src))));
  assert.deepEqual(b.notes.map((n) => n.midi), a.notes.map((n) => n.midi + 2));
  // midiFile takes the events as they come from PostScript
  assert.deepEqual(midiFile(a, { title: a.title }), midiFile(performanceOf(src), { title: a.title }));
});

test('the self-contained perform document (editor playback, sheet -o x.mid) prints the same events, CLI and WebAssembly', { skip: (skip || !existsSync(path.join(root, 'vendor/pscat-npm/node.js'))) && 'pscat not installed (npm run pscat:fetch)' }, async () => {
  const { psEngineDoc, performanceFromOutput } = await import('../bin/sheet.mjs');
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const f of readdirSync(path.join(root, 'samples')).filter((x) => /\.(abc|musicxml)$/.test(x)).sort()) {
    const src = read('samples/' + f);
    for (const k of [0, -3]) {
      const doc = psEngineDoc(src, { perform: true, transpose: k });
      const js = JSON.parse(JSON.stringify(performanceOf(src, { transpose: k })));
      assert.deepEqual(performanceFromOutput(r.render(doc.ps, { width: 8, height: 8 }).output), js, `${f} ${k}: WebAssembly`);
      if (k === 0) assert.deepEqual(performanceFromOutput(pscat(doc.ps)), js, `${f}: CLI`);
    }
  }
});
