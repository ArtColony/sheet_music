// The Claude Code / ChatGPT (Codex) plugin in plugin/: in step with lib/,
// consistent manifests, and the dependency on the pscat plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

test('plugin/ is in step with lib/ and package.json (scripts/build-plugin.mjs --check)', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-plugin.mjs'), '--check'], { stdio: 'pipe' });
});

test('manifests agree, and the plugin depends on pscat', () => {
  const version = json('package.json').version;
  const cc = json('plugin/.claude-plugin/plugin.json');
  const ap = json('plugin/plugin.json');
  const ccm = json('.claude-plugin/marketplace.json');
  const cxm = json('.agents/plugins/marketplace.json');
  assert.equal(cc.name, 'sheet-music');
  for (const m of [ap]) { assert.equal(m.name, cc.name); assert.equal(m.version, version); }
  assert.equal(cc.version, version);
  assert.deepEqual(cc.dependencies, ['pscat@pscat']);
  // a dependency from another marketplace installs only if ours allows it
  assert.ok(ccm.allowCrossMarketplaceDependenciesOn.includes('pscat'));
  assert.equal(ccm.plugins[0].name, cc.name);
  assert.equal(ccm.plugins[0].source, './plugin');
  assert.equal(cxm.name, ccm.name);
  assert.equal(cxm.plugins[0].name, cc.name);
  assert.equal(cxm.plugins[0].source.path, './plugin');
  // the open schema is closed: only these top-level fields
  const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  for (const k of Object.keys(ap)) assert.ok(allowed.includes(k), `plugin/plugin.json: ${k} is not an Agent Plugins field`);
});

test('plugin skills are real files (Codex drops symlinks) and name pscat as a requirement', () => {
  const dir = path.join(root, 'plugin/skills');
  for (const s of readdirSync(dir)) {
    const f = path.join(dir, s, 'SKILL.md');
    assert.ok(existsSync(f), `${s}: no SKILL.md`);
    assert.ok(!lstatSync(path.join(dir, s)).isSymbolicLink() && !lstatSync(f).isSymbolicLink(), `${s} must not be a symlink`);
    assert.match(readFileSync(f, 'utf8'), /pscat/, `${s} should say it needs pscat`);
  }
});

test('claude plugin validate passes (when the claude CLI is installed)', (t) => {
  let ok = true;
  try { execFileSync('claude', ['--version'], { stdio: 'pipe' }); } catch { ok = false; }
  if (!ok) return t.skip('claude CLI not installed');
  for (const p of ['.', 'plugin']) execFileSync('claude', ['plugin', 'validate', p], { cwd: root, stdio: 'pipe' });
});
