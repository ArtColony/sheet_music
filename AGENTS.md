# AGENTS.md

Guidance for coding agents (Codex, Claude Code and others) in this repo,
and for agents that use the **sheet-music** plugin it publishes.

## Using the plugin

The plugin gives an agent the PostScript music library (`lib/*.ps`) and a
skill for writing ABC and engraving it to PDF/PNG/SVG with pscat, headless.
It needs the **pscat** plugin (PSCatLabs/pscat), which provides the
interpreter and its MCP tools.

### Claude Code

```sh
claude plugin marketplace add PSCatLabs/pscat       # first: the dependency's marketplace
claude plugin marketplace add ArtColony/sheet_music
claude plugin install sheet-music@artcolony         # installs pscat@pscat with it
```

In a session: `/plugin marketplace add PSCatLabs/pscat`, `/plugin marketplace add ArtColony/sheet_music`,
`/plugin install sheet-music@artcolony`. The manifest declares
`"dependencies": ["pscat@pscat"]` and our marketplace allows that
cross-marketplace dependency (`allowCrossMarketplaceDependenciesOn`). Claude
Code installs it only if pscat's marketplace is already added. Otherwise
sheet-music installs but fails to load until you run `claude plugin install pscat@pscat`.

### ChatGPT / Codex

Plugins there have no dependency field, so install pscat first:

```sh
codex plugin marketplace add PSCatLabs/pscat
codex plugin marketplace add ArtColony/sheet_music
codex plugin add pscat@pscat
codex plugin add sheet-music@artcolony
```

Or use `/plugins` in Codex, or **Plugins** in the ChatGPT desktop app, after
adding the marketplaces. Start a new session after installing.

### Where the library is once installed

- **Claude Code:** `${CLAUDE_PLUGIN_ROOT}/lib/`. The skill text has it
  substituted as an absolute path.
- **Codex:** `~/.codex/plugins/cache/artcolony/sheet-music/<version>/lib/`.
- **pscat MCP tools:** they read files only inside the project and pscat's
  own folders. Copy the library into the project first (the skill shows how).
  The `pscat` command-line tool can read it from the plugin folder directly.

## Working in this repo

[CLAUDE.md](CLAUDE.md) has the rules; they apply to every agent. In short:

- **pscat:** use the released pscat pinned in `.pscat-version` and
  `pscat.lock.json`, installed by `npm run pscat:fetch` into `vendor/`.
  Always give the CLI an output flag (`--pdf`, `--png`, `--svg`). A bare
  `pscat file.ps` opens a window.
- **Determinism is the contract:** exact rational time, fixed-precision
  numbers, and no clock, random numbers or locale.
- **PostScript direction:** the library is the primary engraver. Prefer
  putting notation logic in `lib/*.ps`. JavaScript keeps audio playback and
  the web UI. Every PostScript name starts with `sm-`.
- **Look at what you change:** after touching `lib/sm_abc.ps` or
  `lib/sm_engrave.ps`, run `node scripts/render-samples.mjs` and inspect a
  high-dpi crop. The PostScript library is the only engraver (the
  JavaScript layout, `--engine js`, was retired in #10). Then
  run `npm test` and update goldens on purpose with
  `node scripts/update-golden.mjs`.
- **pscat problems:** log them in `docs/FRICTION.md` and file upstream as
  CLAUDE.md describes.

### The plugin

```
.claude-plugin/marketplace.json     Claude Code marketplace "artcolony" (allows the pscat dependency)
.agents/plugins/marketplace.json    Codex / ChatGPT marketplace "artcolony"
plugin/.claude-plugin/plugin.json   Claude Code manifest (dependencies: pscat@pscat)
plugin/plugin.json                  Agent Plugins manifest + OpenAI interface (no dependency field exists)
plugin/skills/<name>/SKILL.md       the skills, as real files (Codex drops symlinks); .claude/skills links here
plugin/lib/*.ps                     copies of lib/*.ps, made by scripts/build-plugin.mjs
```

- **`lib/` is the source of truth.** After changing any `lib/*.ps` or the
  version in `package.json`, run `node scripts/build-plugin.mjs`.
  `tests/plugin.test.mjs` fails while `plugin/` is out of date, and also
  checks the manifests and runs `claude plugin validate` when the CLI is
  present.
- **Release:** bump `version` in `package.json`, run the build script, and
  commit. Users get it with `claude plugin marketplace update artcolony` or
  `codex plugin marketplace upgrade artcolony`.
- **Test an install without touching your own setup:** use a throwaway
  config directory.

  ```sh
  CLAUDE_CONFIG_DIR=$(mktemp -d) sh -c 'claude plugin marketplace add PSCatLabs/pscat && claude plugin marketplace add "$PWD" && claude plugin install sheet-music@artcolony && claude plugin list'
  CODEX_HOME=$(mktemp -d) sh -c 'codex plugin marketplace add "$PWD" && codex plugin add sheet-music@artcolony && codex plugin list'
  ```
