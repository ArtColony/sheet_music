// Install the pinned pscat release (pscat.lock.json) into vendor/:
//   vendor/pscat/       the command-line tool for this platform (pscat, lib/, licences)
//   vendor/pscat-npm/   the WebAssembly npm package (pscat.wasm, index.js, ...)
//
// Each archive is downloaded from the GitHub release (cached in .cache/pscat/),
// checked against the SHA-256 committed in pscat.lock.json, and only then
// extracted. A mismatch is a hard failure. Idempotent: when vendor/ already
// holds the pinned version it does nothing and needs no network.
//
//   node scripts/fetch-pscat.mjs          CLI + npm package
//   node scripts/fetch-pscat.mjs --npm    npm package only (enough for the editor)
//
// The pattern follows PSCatLabs/print-shop's scripts/fetch-engine.mjs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'pscat.lock.json'), 'utf8'));
const pinned = (await readFile(path.join(root, '.pscat-version'), 'utf8')).trim();
if (pinned !== lock.version) {
  console.error(`.pscat-version (${pinned}) and pscat.lock.json (${lock.version}) disagree.`);
  process.exit(1);
}
const cache = path.join(root, '.cache/pscat');
const vendor = path.join(root, 'vendor');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function download(asset) {
  const file = path.join(cache, asset.file);
  if (existsSync(file) && sha256(await readFile(file)) === asset.sha256) return file;
  const url = lock.base + asset.file;
  const res = await fetch(url);
  if (!res.ok) throw Error(`download ${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== asset.sha256) throw Error(`SHA-256 mismatch for ${asset.file}: expected ${asset.sha256}, got ${got}`);
  await mkdir(cache, { recursive: true });
  await writeFile(file + '.part', bytes);
  await rename(file + '.part', file);
  return file;
}

async function install(asset, dest, strip) {
  const stamp = path.join(dest, '.pscat-asset');
  if (existsSync(stamp) && (await readFile(stamp, 'utf8')) === asset.sha256) return false;
  const file = await download(asset);
  if (sha256(await readFile(file)) !== asset.sha256) throw Error(`cache corrupted: ${file}`);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  execFileSync('tar', ['-xzf', file, '-C', dest, `--strip-components=${strip}`], { stdio: 'pipe' });
  await writeFile(stamp, asset.sha256);
  return true;
}

const platformKey = `${process.platform}-${process.arch}`;
const want = process.argv.includes('--npm') ? ['npm'] : ['npm', 'cli'];
try {
  for (const kind of want) {
    if (kind === 'npm') {
      const did = await install(lock.npm, path.join(vendor, 'pscat-npm'), 1);
      console.log(`pscat npm ${lock.version}: ${did ? 'installed' : 'up to date'} (vendor/pscat-npm)`);
    } else {
      const asset = lock.cli[platformKey];
      if (!asset) { console.warn(`no pscat CLI build for ${platformKey}; set PSCAT=/path/to/pscat`); continue; }
      const did = await install(asset, path.join(vendor, 'pscat'), 1);
      console.log(`pscat CLI ${lock.version} ${platformKey}: ${did ? 'installed' : 'up to date'} (vendor/pscat/pscat)`);
    }
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
