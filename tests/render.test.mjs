// End-to-end determinism: every sample's PostScript must match its golden
// SHA-256 (tests/golden.json), render lint-clean with the pinned pscat CLI,
// give byte-identical PDFs on repeated runs, and the WebAssembly build must
// write exactly the same PDF bytes as the CLI.
//
// After an intended change to the output: node scripts/update-golden.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPostScript } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = readFileSync(path.join(root, 'lib/sm_engrave.ps'), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const golden = JSON.parse(readFileSync(path.join(root, 'tests/golden.json'), 'utf8'));
const PSCAT = process.env.PSCAT || path.join(root, 'vendor/pscat/pscat');
const samples = readdirSync(path.join(root, 'samples')).filter((f) => /\.(abc|musicxml)$/.test(f)).sort();

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sheet-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('every sample has a golden hash', () => {
  assert.deepEqual(Object.keys(golden.ps).sort(), samples);
});

for (const f of samples) {
  test(`${f}: PostScript is deterministic and matches golden`, () => {
    const src = readFileSync(path.join(root, 'samples', f), 'utf8');
    const a = toPostScript(src, { lib: LIB });
    const b = toPostScript(src, { lib: LIB });
    assert.equal(a.ps, b.ps);
    assert.deepEqual(a.warnings, [], `warnings: ${a.warnings.join('; ')}`);
    assert.equal(sha(a.ps), golden.ps[f], 'PostScript changed; if intended run node scripts/update-golden.mjs');
  });
}

test('pscat CLI and WebAssembly agree, and PDFs reproduce', { skip: !existsSync(PSCAT) && 'pscat CLI not installed (npm run pscat:fetch)' }, async () => {
  const { createRenderer } = await import(path.join(root, 'vendor/pscat-npm/node.js'));
  const r = await createRenderer();
  for (const f of samples) {
    const src = readFileSync(path.join(root, 'samples', f), 'utf8');
    const { ps, size } = toPostScript(src, { lib: LIB });
    const psFile = path.join(tmp, f + '.ps');
    writeFileSync(psFile, ps);
    const page = `${Math.round(size[0])}x${Math.round(size[1])}`;
    const run = (out) => execFileSync(PSCAT, ['--lint-strict', '--page', page, '--pdf', out, psFile], { stdio: 'pipe' });
    run(path.join(tmp, f + '.1.pdf'));
    run(path.join(tmp, f + '.2.pdf'));
    const p1 = readFileSync(path.join(tmp, f + '.1.pdf'));
    const p2 = readFileSync(path.join(tmp, f + '.2.pdf'));
    assert.ok(p1.equals(p2), `${f}: CLI PDF differs between runs`);
    r.render(ps, { width: size[0], height: size[1], pdf: true });
    const w = Buffer.from(r.pdf());
    assert.ok(w.equals(p1), `${f}: WebAssembly PDF differs from the CLI's`);
    if (golden.pdf && golden.pdf[f]) assert.equal(sha(p1), golden.pdf[f], `${f}: PDF bytes changed`);
  }
});
