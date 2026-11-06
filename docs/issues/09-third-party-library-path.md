# Third-party PostScript libraries: let a program find its own files, and let a plugin's library be read by pscat-mcp

*Draft for PSCatLabs/pscat (not filed yet). Found while making
ArtColony/sheet_music's engraver usable by agents that have only pscat
(sheet_music#7).*

## What we are doing

sheet_music is a PostScript library: `lib/sheet.ps` runs four sibling files
(glyphs, an ABC parser, layout, transposition) and engraves ABC to PDF with
nothing but pscat. We want it usable from:

- the pscat CLI, run from any directory;
- the pscat MCP tools (`render_postscript`, `eval_postscript`);
- a Claude Code / Codex plugin that depends on the pscat plugin and ships
  the `.ps` files in its own plugin directory.

## What we found (pscat 0.7.0-rc.4, macOS arm64)

- A program cannot learn the path of the file it is running: `currentfile`
  has no name (`currentfile 99 string cvs` gives `--nostringval--`) and there
  is no `currentfilename`-style operator. So `(path/to/lib/sheet.ps) run`
  cannot load `path/to/lib/sm_engrave.ps` without being told the directory;
  we ask callers to define `/sm-lib-dir (path/to/lib/) def` first.
- Names starting with `lib/` go through the resource resolver (#598):
  `PSCAT_TRACE_RESOURCES=1` shows the order `$PSCAT_LIB`, `$PSCAT_HOME/lib`,
  the current directory, the per-user data directory's `lib/`
  (`~/Library/Application Support/pscat/lib` here), the `lib/` beside the
  binary, then the embedded copy. This is very useful, but:
  - it is not documented in `--help`, the release README or `pscat-mcp --help`
    (`PSCAT_LIB` and `PSCAT_TRACE_RESOURCES` appear only in the binary's
    strings);
  - `PSCAT_LIB` takes one directory, not a path list
    (`PSCAT_LIB=/nonexistent:/real/lib` finds nothing), so two libraries
    cannot both use it;
  - the per-user `lib/` works for both the CLI and the MCP server (verified
    with a probe file), so it is the one place a library can be installed for
    every caller, but nothing creates it or says it is meant for users.
- `pscat-mcp` reads only its working directory, the pscat data directories
  and `--allow-read` directories. A plugin that depends on the pscat plugin
  cannot add its own directory: `--allow-read` is a flag of the pscat plugin's
  server command line and has no environment variable. So `(…/plugins/cache/
  …/sheet-music/lib/sheet.ps) run` fails with `invalidfileaccess` in the MCP
  tools; our skill has to copy the library into the project first.

## Requests (any one helps; 1 and 3 together solve it)

1. **Document the `lib/` search order** and `PSCAT_LIB` /
   `PSCAT_TRACE_RESOURCES` in `pscat --help`, the release README and the
   pscat skill, including that the per-user data directory's `lib/` is a
   supported place for third-party libraries (and how to find it: today
   `pscat fonts list` prints `install directory: <user-data>/fonts/packs`).
2. **The running file's path**: e.g. `currentfilename` (the path a file
   object was opened with, or the name `run` was given) or a `/CurrentFile`
   entry, so a library can load its siblings: `currentfilename
   dirname (sm_engrave.ps) concat run`. Safe under `--read-root`: it only
   reveals a path the program already used.
3. **A way for another plugin's library to be readable by pscat-mcp**, e.g.
   - `PSCAT_LIB` as a path list (`:`/`;`) that the resolver searches and that
     pscat-mcp adds to its read roots; or
   - a `<user-data>/lib/<package>/` convention plus `pscat lib install DIR
     [--name NAME]` / `pscat lib list`, so a plugin's setup step installs its
     library once and `(lib/<package>/sheet.ps) run` works in the CLI and the
     MCP tools from any project; or
   - `PSCAT_MCP_ALLOW_READ` (a path list) mirroring `--allow-read`, which a
     dependent plugin could set.

## Repro

```sh
mkdir -p /tmp/a/lib && printf '(found) =\n' > /tmp/a/lib/probe.ps
cd /tmp && PSCAT_TRACE_RESOURCES=1 PSCAT_LIB=/tmp/a/lib pscat --pdf /dev/null -e '(lib/probe.ps) run'
#   pscat: resource lib/probe.ps <- pscat-lib (/tmp/a/lib/probe.ps)
PSCAT_LIB=/nope:/tmp/a/lib pscat --pdf /dev/null -e '(lib/probe.ps) run'
#   undefinedfilename
pscat --pdf /dev/null -e 'currentfile 99 string cvs ='
#   --nostringval--
```
