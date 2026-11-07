// Playback events from PostScript (lib/sm_perform.ps, sm-abc-performance)
// must be exactly what the retired src/play.js performance() computed
// (frozen in tests/fixtures/reference/perform.json): every sample, every
// tune of the parse edge-case fixture, a tune made to reach the corners
// (tests/fixtures/reference/perform-corners.abc: ties over bar lines,
// carried accidentals, nested endings, a multi-measure rest, two voices),
// each at several transpositions. ABC and MusicXML text are parsed by
// PostScript (MusicXML also goes in once as the JS parser's Score literal,
// the dict path), and the MusicXML edge fixture. The JS side only turns
// these events into sound or a MIDI file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { midiFile } from '../src/index.js';
import { psLiteral } from '../src/ps.js';
import { reference } from './reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const skip = !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-perform-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const REF = reference('perform');
const XML_SCORES = reference('musicxml-parse').files;
const CORNERS = 'tests/fixtures/reference/perform-corners.abc';
const SAMPLES = readdirSync(path.join(root, 'samples')).filter((x) => /\.(abc|musicxml)$/.test(x)).sort().map((f) => `samples/${f}`);
const want = (label) => { assert.ok(REF[label], `no reference for ${label}`); return REF[label]; };

// cases: [label, PostScript operand (text or Score literal), options, reference label]
function cases() {
  const out = [];
  const semisList = [0, 2, -5];
  for (const f of SAMPLES) {
    const src = read(f);
    for (const k of semisList) {
      out.push([`${f} ${k}`, psLiteral(src), `<< /transpose ${k} >>`, `${f} ${k}`]);
      if (f.endsWith('.musicxml')) out.push([`${f} ${k} (Score literal)`, psLiteral(XML_SCORES[f].parse.score), `<< /transpose ${k} >>`, `${f} ${k}`]);
    }
  }
  const xedge = read('tests/fixtures/parse-edge.musicxml');
  for (const k of semisList) out.push([`parse-edge.musicxml ${k}`, psLiteral(xedge), `<< /transpose ${k} >>`, `tests/fixtures/parse-edge.musicxml ${k}`]);
  // a %%transpose comment in MusicXML adds to the option
  const xt = xedge.replace('<score-partwise', '<!-- %%transpose 3 -->\n<score-partwise');
  out.push(['parse-edge.musicxml %%transpose 3, /transpose -1', psLiteral(xt), '<< /transpose -1 >>', 'tests/fixtures/parse-edge.musicxml %%transpose 3, /transpose -1']);
  const edge = read('tests/fixtures/parse-edge.abc');
  const tunes = Object.keys(REF).filter((l) => l.startsWith('tests/fixtures/parse-edge.abc /tune ') && l.endsWith(' 0')).length;
  assert.equal(tunes, 3);
  for (let t = 0; t < tunes; t++) {
    for (const k of semisList) out.push([`parse-edge.abc /tune ${t} ${k}`, psLiteral(edge), `<< /tune ${t} /transpose ${k} >>`, `tests/fixtures/parse-edge.abc /tune ${t} ${k}`]);
  }
  for (const k of semisList) out.push([`corners ${k}`, psLiteral(read(CORNERS)), `<< /transpose ${k} >>`, `${CORNERS} ${k}`]);
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
  cs.forEach(([label, , , ref], i) => {
    const js = want(ref);
    assert.ok(js.notes.length > 0, `${label}: no notes`);
    assert.deepEqual(JSON.parse(lines[i]), js, `${label}: PostScript events differ from play.js`);
  });
});

test('the corners tune really has the corners (ties, repeats, endings, two staves)', () => {
  const p = want(`${CORNERS} 0`);
  assert.equal(p.staves, 2);
  assert.ok(p.notes.some((n) => n.dur[0] / n.dur[1] > 1), 'a note tied across bars');
  assert.deepEqual(p.tempo, { beat: [3, 8], bpm: 60 });
});

test('sm-abc-performance-file, the default options, and the MIDI file made from PostScript events', { skip }, () => {
  const out = pscat('(lib/sheet.ps) run (samples/greensleeves.abc) sm-abc-performance-file\n(samples/greensleeves.abc) << /transpose 2 >> sm-abc-performance-file\n');
  const [a, b] = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(a, want('samples/greensleeves.abc 0'));
  assert.deepEqual(b, want('samples/greensleeves.abc 2'));
  assert.deepEqual(b.notes.map((n) => n.midi), a.notes.map((n) => n.midi + 2));
  // midiFile takes the events as they come from PostScript
  assert.deepEqual(midiFile(a, { title: a.title }), midiFile(want('samples/greensleeves.abc 0'), { title: a.title }));
});

test('the self-contained perform document (editor playback, sheet -o x.mid) prints the same events, CLI and WebAssembly', { skip: (skip || !existsSync(path.join(root, 'vendor/pscat-npm/node.js'))) && 'pscat not installed (npm run pscat:fetch)' }, async () => {
  const { psEngineDoc, performanceFromOutput } = await import('../bin/sheet.mjs');
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const f of SAMPLES) {
    const src = read(f);
    for (const k of [0, -3]) {
      const doc = psEngineDoc(src, { perform: true, transpose: k });
      const js = want(`${f} ${k}`);
      assert.deepEqual(performanceFromOutput(r.render(doc.ps, { width: 8, height: 8 }).output), js, `${f} ${k}: WebAssembly`);
      if (k === 0) assert.deepEqual(performanceFromOutput(pscat(doc.ps)), js, `${f}: CLI`);
    }
  }
});
