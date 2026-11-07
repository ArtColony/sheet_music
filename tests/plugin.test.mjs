// The Claude Code / ChatGPT (Codex) plugin in plugin/: in step with lib/,
// consistent manifests, and the dependency on the pscat plugin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
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

test('each plugin skill is linked from .claude/skills', () => {
  for (const s of readdirSync(path.join(root, 'plugin/skills'))) {
    const link = path.join(root, '.claude/skills', s);
    assert.ok(lstatSync(link).isSymbolicLink(), `.claude/skills/${s} should link to plugin/skills/${s}`);
    assert.equal(readlinkSync(link), `../../plugin/skills/${s}`);
  }
});

test('skill scripts are real, executable files the SKILL.md names, and they compile', () => {
  const dir = path.join(root, 'plugin/skills');
  let python = null;
  for (const p of ['python3', 'python']) { try { execFileSync(p, ['--version'], { stdio: 'pipe' }); python = p; break; } catch { /* next */ } }
  for (const s of readdirSync(dir)) {
    const sdir = path.join(dir, s, 'scripts');
    if (!existsSync(sdir)) continue;
    const skill = readFileSync(path.join(dir, s, 'SKILL.md'), 'utf8');
    const files = readdirSync(sdir).filter((f) => f !== '__pycache__'); // gitignored, never shipped
    for (const f of files) {
      const st = lstatSync(path.join(sdir, f));
      assert.ok(st.isFile() && !st.isSymbolicLink(), `${s}/scripts/${f} must be a real file`);
      if (/\.(py|sh)$/.test(f)) {
        assert.ok(st.mode & 0o100, `${s}/scripts/${f} should be executable`);
        assert.ok(skill.includes(f), `${s}/SKILL.md should name ${f}`);
      }
      // no bytecode left behind: compile into memory only
      if (python && f.endsWith('.py')) execFileSync(python, ['-B', '-c', 'import sys; compile(open(sys.argv[1]).read(), sys.argv[1], "exec")', path.join(sdir, f)], { stdio: 'pipe' });
    }
  }
});

test('audio-to-sheet-music pins every model to a Hub commit and a SHA-256', () => {
  const py = readFileSync(path.join(root, 'plugin/skills/audio-to-sheet-music/scripts/transcribe.py'), 'utf8');
  const skill = readFileSync(path.join(root, 'plugin/skills/audio-to-sheet-music/SKILL.md'), 'utf8');
  const rows = [...py.matchAll(/^ {4}'([\w-]+)': \('([\w.-]+\/[\w.-]+)', '([0-9a-f]+)',\s*'([^']+)', '([0-9a-f]+)', (\d+)\),/gm)];
  assert.deepEqual(rows.map((r) => r[1]).sort(), ['basic-pitch', 'htdemucs', 'piano']);
  for (const [, name, repo, rev, , sha] of rows) {
    assert.match(rev, /^[0-9a-f]{40}$/, `${name}: revision is a commit`);
    assert.match(sha, /^[0-9a-f]{64}$/, `${name}: sha256`);
    assert.ok(skill.includes(repo) && skill.includes(rev.slice(0, 7)), `${name}: SKILL.md's model table names ${repo} at ${rev.slice(0, 7)}`);
  }
  // never a token in the plugin
  assert.doesNotMatch(py + skill, /hf_[A-Za-z0-9]{30,}/);
});

test('claude plugin validate passes (when the claude CLI is installed)', (t) => {
  let ok = true;
  try { execFileSync('claude', ['--version'], { stdio: 'pipe' }); } catch { ok = false; }
  if (!ok) return t.skip('claude CLI not installed');
  for (const p of ['.', 'plugin']) execFileSync('claude', ['plugin', 'validate', p], { cwd: root, stdio: 'pipe' });
});
