#!/usr/bin/env node
// Keep plugin/ (the Claude Code + ChatGPT/Codex plugin) in step with the repo.
//
//   node scripts/build-plugin.mjs          copy lib/*.ps and LICENSE in, set versions
//   node scripts/build-plugin.mjs --check  exit 1 if plugin/ is out of date
//
// lib/ is the source of truth for the PostScript library; plugin/lib/ holds
// real copies because Codex drops symlinks when it caches a plugin. Skills
// live in plugin/skills/ (real files) and .claude/skills/ links to them.
// Both manifests take their version from package.json.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const stale = [];

function want(rel, content) {
  const file = path.join(root, rel);
  const have = existsSync(file) ? readFileSync(file) : null;
  if (have && Buffer.compare(have, Buffer.from(content)) === 0) return;
  stale.push(rel);
  if (!check) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); }
}

/** The plugin's copy of the library: every lib/*.ps, nothing else. */
export function libFiles() {
  return readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.ps')).sort();
}

const libs = libFiles();
for (const f of libs) want(`plugin/lib/${f}`, readFileSync(path.join(root, 'lib', f)));
const pdir = path.join(root, 'plugin/lib');
if (existsSync(pdir)) {
  for (const f of readdirSync(pdir)) {
    if (libs.includes(f)) continue;
    stale.push(`plugin/lib/${f} (not in lib/)`);
    if (!check) rmSync(path.join(pdir, f));
  }
}
want('plugin/LICENSE', readFileSync(path.join(root, 'LICENSE')));
for (const m of ['plugin/.claude-plugin/plugin.json', 'plugin/plugin.json']) {
  const j = JSON.parse(readFileSync(path.join(root, m), 'utf8'));
  j.version = version;
  want(m, JSON.stringify(j, null, 2) + '\n');
}

if (check && stale.length) {
  console.error(`plugin/ is out of date (run node scripts/build-plugin.mjs):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
if (!check) console.error(stale.length ? `plugin: updated ${stale.length} file(s)` : 'plugin: up to date');
