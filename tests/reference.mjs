// The frozen JavaScript reference (tests/fixtures/reference/*.json): what
// src/abc.js, src/musicxml.js, src/index.js scoreMeta, src/play.js
// performance() and src/transpose.js computed for every sample and fixture
// before they were retired (#10, made by scripts/freeze-js-reference.mjs,
// in the history). The PostScript parsers, metadata, playback and
// transposition are tested against it. Large results (every sample
// transposed eight ways) are kept as the SHA-256 of their canonical JSON.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reference');

/** A reference file, parsed: abc-parse, musicxml-parse, meta, perform, transpose. */
export const reference = (name) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));

/** JSON text with object keys sorted. */
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));

/** SHA-256 of a value's canonical JSON (parse PostScript's output first, so number formatting does not matter). */
export const refHash = (v) => createHash('sha256').update(canon(v)).digest('hex');
