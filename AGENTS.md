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

### Transcribing audio (the audio-to-sheet-music skill)

The plugin's second skill turns a recording or a MIDI file into ABC and then
into a score. The ABC goes to the same engraving loop as `ps-sheet-music`.
It runs on the user's machine and needs more than pscat:

- **MIDI only:** `python3` (standard library). Nothing else.
- **Audio:** a virtual environment made by the skill's `scripts/setup.sh VENV`
  (about 300 MB; `--with-separation` / `--with-piano` add PyTorch, about 1 GB).
  Then run `VENV/bin/python scripts/transcribe.py --check`, which lists each
  step as `ok` / `MISS` / `opt`. Ask the user before installing, and use only the venv.
- **Hugging Face:** the pinned models (Basic Pitch ONNX, Demucs `adefossez/HTDemucs`,
  the ByteDance piano checkpoint) are public and not gated. No account or
  token is needed. If the user logs in anyway, they run `VENV/bin/hf auth login`
  themselves, in a terminal. An agent never asks for the token in chat,
  never writes it to the repo, and never accepts a model's terms for the user.
- **Hugging Face's agent skill (optional, not a dependency):** in Claude Code,
  `/plugin marketplace add huggingface/skills` and
  `/plugin install hf-cli@huggingface-skills`. In Codex, `hf skills add hf-cli --global`
  (into `~/.agents/skills`). It is deliberately not in `dependencies`: a
  missing dependency stops the whole sheet-music plugin from loading, and
  the notation skill does not need Hugging Face.

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
- **PostScript direction:** the library is the engraver. Notation logic
  lives in `lib/*.ps`: parsing (`lib/sm_abc_parse.ps`, `lib/sm_musicxml.ps`),
  transposition, layout, drawing and the playback events. JavaScript keeps
  audio/MIDI output and the web UI; there is no JS parser (`src/abc.js` and
  `src/musicxml.js` were retired in #10). Every PostScript name starts with `sm-`.
- **Look at what you change:** after touching `lib/sm_abc.ps`,
  `lib/sm_engrave.ps` or the parsers, run `node scripts/render-samples.mjs` and inspect a
  high-dpi crop. The PostScript library is the only engraver (the
  JavaScript layout, `--engine js`, was retired in #10). Then
  run `npm test` and update goldens on purpose with
  `node scripts/update-golden.mjs`. The parser, metadata, playback and
  transposition tests compare against the retired JS code's frozen results
  (`tests/fixtures/reference/`); they cannot be regenerated, so a parser
  change that is meant to differ updates the expectation in the test.
- **pscat problems:** log them in `docs/FRICTION.md` and file upstream as
  CLAUDE.md describes.

### The plugin

```
.claude-plugin/marketplace.json     Claude Code marketplace "artcolony" (allows the pscat dependency)
.agents/plugins/marketplace.json    Codex / ChatGPT marketplace "artcolony"
plugin/.claude-plugin/plugin.json   Claude Code manifest (dependencies: pscat@pscat)
plugin/plugin.json                  Agent Plugins manifest + OpenAI interface (no dependency field exists)
plugin/skills/<name>/SKILL.md       the skills, as real files (Codex drops symlinks); .claude/skills links here
plugin/skills/audio-to-sheet-music/scripts/   midi2abc.py (deterministic, stdlib), transcribe.py + setup.sh + requirements.txt (the ML side)
plugin/lib/*.ps                     copies of lib/*.ps, made by scripts/build-plugin.mjs
```

- **`lib/` is the source of truth.** After changing any `lib/*.ps` or the
  version in `package.json`, run `node scripts/build-plugin.mjs`.
  `tests/plugin.test.mjs` fails while `plugin/` is out of date, and also
  checks the manifests and runs `claude plugin validate` when the CLI is
  present.
- **Skill scripts live only in `plugin/`.** The build script does not copy
  them. `tests/plugin.test.mjs` checks that they are real, executable files
  named in their SKILL.md, and that every model is pinned to a Hub commit
  and a SHA-256. `tests/midi2abc.test.mjs` round-trips the samples' MIDI
  through `midi2abc.py`. It skips when there is no `python3`, and it runs
  Python with `-B`, so no `__pycache__` lands in `plugin/`.
- **Release:** bump `version` in `package.json`, run the build script, and
  commit. Users get it with `claude plugin marketplace update artcolony` or
  `codex plugin marketplace upgrade artcolony`.
- **Test an install without touching your own setup:** use a throwaway
  config directory.

  ```sh
  CLAUDE_CONFIG_DIR=$(mktemp -d) sh -c 'claude plugin marketplace add PSCatLabs/pscat && claude plugin marketplace add "$PWD" && claude plugin install sheet-music@artcolony && claude plugin list'
  CODEX_HOME=$(mktemp -d) sh -c 'codex plugin marketplace add "$PWD" && codex plugin add sheet-music@artcolony && codex plugin list'
  ```
