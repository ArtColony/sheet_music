// The files whose engraving tests/golden.json pins (scripts/update-golden.mjs
// writes it, tests/ps-engine.test.mjs checks it): every sample, keyed by its
// name, and every test fixture, keyed fixtures/<name>.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scores = (dir) => readdirSync(path.join(root, dir)).filter((f) => /\.(abc|musicxml)$/.test(f)).sort();

export const SAMPLES = scores('samples').map((f) => ({ key: f, file: path.join(root, 'samples', f), sample: true }));
export const FIXTURES = scores('tests/fixtures').map((f) => ({ key: `fixtures/${f}`, file: path.join(root, 'tests/fixtures', f), sample: false }));
export const GOLDEN_FILES = [...SAMPLES, ...FIXTURES];
