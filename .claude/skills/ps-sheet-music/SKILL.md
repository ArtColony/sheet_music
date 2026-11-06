---
name: ps-sheet-music
description: Write music as ABC notation and engrave it to PDF/PNG with only pscat (the CLI or the pscat MCP tools), using the sheet_music PostScript library. Use when asked to notate, transcribe, arrange, typeset or render sheet music, lead sheets, hymns, folk tunes, exercises or worksheets, to check or fix a score, or to draw custom notation (staves, clefs, notes) in PostScript, and no Node toolchain is at hand.
---

# Sheet music with pscat alone

ABC text → `lib/sheet.ps` (parser, layout and glyphs, all PostScript) →
pscat → PDF/PNG. Nothing else runs: no Node, no network, no music font.

## Find the library

`sheet.ps` and its siblings (`sm_engrave.ps`, `sm_abc_parse.ps`, `sm_abc.ps`,
and `sm_transpose.ps` when present) live in one directory. Call it `LIB`.
Look for it in this order:

1. **Claude Code plugin:** `${CLAUDE_PLUGIN_ROOT}/lib/sheet.ps`.
2. **Codex plugin:** `ls ~/.codex/plugins/cache/*/sheet-music/*/lib/sheet.ps`
   (take the newest version).
3. **The sheet_music repository:** `lib/sheet.ps`, from the repository root.

pscat cannot tell a program where the running file is, so pass the directory
in `sm-lib-dir` (a string ending in `/`) when you run it from anywhere else:

```postscript
/sm-lib-dir (/abs/path/to/lib/) def (/abs/path/to/lib/sheet.ps) run
```

Without `sm-lib-dir`, `sheet.ps` tries `(lib/)`, then `(.sheet-music/)`,
then the current directory.

## Requires pscat

Check `pscat --version` (the CLI), or whether the pscat MCP tools
(`render_postscript`, `eval_postscript`) are available. If neither is there,
stop and ask the user to install the pscat plugin:

- Claude Code: `claude plugin install pscat --marketplace PSCatLabs/pscat`
- Codex: `codex plugin marketplace add PSCatLabs/pscat`, then install pscat
  from the Plugins directory.

## Two ways to run it

**pscat CLI.** It reads files anywhere, so it can run `LIB` in place. Always
give it an output file, or it opens a window and waits. Pass the program as
a file or with `-e`, not on stdin (stdin can hang).

```sh
pscat --pdf tune.pdf --page 612x792 -e '/sm-lib-dir (LIB/) def (LIB/sheet.ps) run (tune.abc) sm-abc-engrave-file'
pscat --png tune.png --page 612x792 --dpi 110 tune.ps     # a .ps file you wrote (below)
```

**pscat MCP tools.** They read only inside the project and pscat's own
folders, so `run` on the plugin's directory fails with `invalidfileaccess`.
Copy the library into the project once:

```sh
mkdir -p .sheet-music && cp LIB/*.ps .sheet-music/
```

then start every program with `(.sheet-music/sheet.ps) run`. It finds its
siblings in `.sheet-music/` by itself. `render_postscript` takes `width` and
`height` (the page size) and `dpi`, and returns PNGs. With `format: "pdf"` and
an `out_path` (inside the project, not in a dot-directory) it writes a PDF.
`eval_postscript` returns what the program printed, which is what you want
for checks.

`--page` (CLI) or `width`/`height` (MCP) must match the paper: letter
`612x792` (the default), a4 `595x842` (options `<< /paper /a4 >>`).

## The loop: write, check, render, look, fix

1. **Write one `.ps` file holding the call and the ABC.** The ABC after
   `sm-abc-engrave-here` is read raw, up to a line `%%SM-ABC-END` or the end
   of the file. Parentheses, backslashes and `%` need no escaping. The call
   must be the last thing on its line.

   ```postscript
   %!PS
   (.sheet-music/sheet.ps) run
   << /paper /letter >> sm-abc-engrave-here
   X:1
   T:Title
   C:Composer or Traditional
   M:3/4
   L:1/8
   Q:1/4=96
   K:G
   D2 | "G"G4 B2 | "D7"A4 F2 | "G"G6 |]
   w: A-maz-ing grace!
   ```

2. **Check it.** This prints the tunes, parse warnings, and bars that do not
   add up to the meter. It draws nothing (the dot keeps `--lint-strict`
   happy):

   ```postscript
   (.sheet-music/sheet.ps) run
   sm-abc-here
   X:1
   ...the tune...
   %%SM-ABC-END
   sm-abc-check-string 0 0 1 1 rectfill showpage
   ```

   Or check a file: `(tune.abc) sm-abc-check-file`. Output lines start with
   `sm-abc:`. Fix every `sm-abc: warning:` and every `sm-abc: bar N: ...`
   line until it prints `sm-abc: ok`. Engraving prints the same warnings too.

3. **Render a PNG and look at it** (Read the image): `--dpi 110` for the
   whole page. For small details (accidentals, ties, lyric hyphens, dots),
   render at `--dpi 300` and crop the area. Thin lines vanish in a downscaled
   preview, so do not call a stem or ledger line missing until you have seen
   it at 300 dpi. A multi-page score written with `--png out.png` becomes
   `out-001.png`, `out-002.png` …

4. **Check against the music:** beats per bar, the key signature, the
   pickup, ties, endings, and that each lyric syllable sits under its note.

5. **Write the PDF** with `--pdf` (CLI) or `render_postscript` with
   `format: "pdf"` and `out_path`.

### One-liners

| Want | Program |
|---|---|
| engrave a file | `(tune.abc) sm-abc-engrave-file` |
| with options | `(tune.abc) << /paper /a4 /staff-space 6 /breaks (auto) >> sm-abc-engrave-file` |
| the third tune of a file | `(tunes.abc) << /tune 2 >> sm-abc-engrave-file` (**0-based**) |
| list the tunes | `(tunes.abc) sm-abc-list-file 0 0 1 1 rectfill showpage` |
| check | `(tune.abc) sm-abc-check-file 0 0 1 1 rectfill showpage` |
| ABC in a string | `(X:1\nT:Scale\nK:C\nCDEF GABc|]) sm-abc-engrave-string`: short tests only, since `(` and `\` must be escaped in a string |
| transpose | `<< /transpose 2 >>` (semitones; needs `sm_transpose.ps`) |

Options: `/paper` (`/letter`, `/a4`, `[w h]` points), `/staff-space`
(points, default 5.5), `/breaks` (`(source)` keeps your lines, `(auto)` fills
them), `/tune` (0-based), `/footer (text)` (`()` for none), `/margin` `/top`
`/bottom`, `/quiet true` (no warnings), `/transpose` (semitones).

## Writing ABC

The header ends at `K:`. Each body line becomes one line of music, so put
4 bars on a line for songs and 4–8 for dance tunes.

| Want | Write |
|---|---|
| pitches | `C D E F G A B c d e f g a b c'` (`C,` an octave lower; `C` is middle C) |
| sharp / flat / natural | `^F _B =E` (lasts to the end of the bar) |
| lengths (`L:1/8`) | `A` eighth, `A2` quarter, `A3` dotted quarter, `A4` half, `A8` whole, `A/` sixteenth |
| dotted pairs | `A>B`, `A<B` |
| rests | `z2`; whole-bar `Z`; 4 bars `Z4` |
| beams | notes written together are beamed: `ABcd efga`; a space breaks the beam |
| chord, tie, slur | `[GBd]4`, `A4-A2`, `(ABc)` |
| triplet, grace | `(3ABc`, `{g}A`, `{/g}A` |
| chord symbol, text | `"Am7"A2`, `"^Fine"` above, `"_rit."` below |
| decorations | `.A` staccato, `!fermata!A`, `!trill!A`, `!accent!A`, `~A` |
| dynamics, hairpins | `!mf!A`, `!crescendo(!A ... !crescendo)!B` |
| bars, repeats, endings | `|` `||` `|]` `|:` `:|` `[1 ... :|2 ...` |
| lyrics | a `w:` line after the music line: `syl-la-ble`, `word_` holds over the next note, `*` skips one; more `w:` lines are more verses |
| two staves (piano) | `%%score {RH LH}`, `V:RH clef=treble`, `V:LH clef=bass` in the header, then alternate `V:RH` / `V:LH` blocks with the same bars |
| accented text | `\'e` `\"o` `\ss`, or type é directly |

Full table and limits: [docs/notation.md](https://github.com/ArtColony/sheet_music/blob/main/docs/notation.md)
(in the repository: `docs/notation.md`). Every procedure:
[docs/postscript-api.md](https://github.com/ArtColony/sheet_music/blob/main/docs/postscript-api.md).

## Common errors and fixes

| You see | Cause and fix |
|---|---|
| `sm-abc: error: cannot find sm_engrave.ps` | `sheet.ps` was run from elsewhere: define `/sm-lib-dir (LIB/) def` first, or copy to `.sheet-music/` |
| `invalidfileaccess` (MCP) | the file is outside the project: copy the library (and the `.abc`) into the project |
| `undefinedfilename` on `(tune.abc)` | paths are relative to pscat's current directory (MCP: the project root) |
| pscat never returns | no output flag (`--pdf`/`--png`), or the program came on stdin |
| `sm-abc: bar 5: 7/8 of a whole note, M:3/4 wants 3/4` | that bar has an eighth too many: count the lengths against `L:` |
| `sm-abc: warning: tune 1: skipped "h" in: ...` | a character the parser does not know; fix or remove it |
| a decoration or dynamic lands on the wrong note | it belongs to the note **after** it: `!crescendo)!A2`, not `A2!crescendo)!` |
| lyrics drift | count syllables per note: a melisma needs `_` per extra note, rests and tied notes take no syllable |
| staves fall out of step | every voice block needs the same number of bars, repeats and endings |
| the page is cut off or has a margin | `--page` / `width`×`height` do not match `/paper` |
| `sm-abc: error: no tune /tune 1 (0-based); the text has 1 tune(s)`, then `rangecheck` | `/tune` counts from 0; list the tunes |
| `--lint-strict` fails with a blank page | check/list draw nothing: end with `0 0 1 1 rectfill showpage` |

## Drawing your own notation

For worksheets, theory examples or anything ABC cannot say, draw with the
glyphs directly: `/sm-sp 8 def` (the staff space in points), then
`x y w sm-staff` (y = centre line), `x y sm-clef-treble` (y = the G line, one
staff space below the centre), `x y (3) (4) sm-timesig`, `x y sm-head-black`,
`x y1 y2 sm-stem` (up stems at x + 0.53·sp), `x1 x2 y sm-ledger`,
`x y sm-acc-sharp`, `x1 y1 x2 y2 1 sm-beam`, `x y1 y2 sm-bar-thin`, and
`x y (text) /Times-Roman 11 sm-text-c`. A note's height is
`centre + pos × sp / 2`, where `pos` counts staff steps from the centre line
(treble: B4 = 0, middle C = −6). docs/postscript-api.md has the whole set and
a worked worksheet example. Use your own name prefix: `sm-` belongs to the
library.

## Limits

- **ABC only.** MusicXML input is not in the PostScript library yet
  (sheet_music#5).
- One voice per staff (`&` is skipped with a warning); no macros (`m:`, `U:`);
  courtesy signatures and mid-line lyric wrapping are not drawn.
- Transposition needs `sm_transpose.ps`; without it `/transpose` is ignored
  with a warning.
- PDFs have the text as outlines (not searchable); fonts are the 35 standard
  PostScript fonts.

## Licensing music

Only notate music that is public domain (traditional, or old enough that
composer and lyricist died long ago) or that the user owns. Write your own
transcription rather than copying an edition, and record where it came from
in `S:` / `Z:`.

## Installing the library for every project

To skip the copy step, put the library where pscat's `lib/` search finds it
for both the CLI and the MCP tools: the `lib/` folder of pscat's per-user
data directory (`pscat fonts list` prints `install directory:
<data-dir>/fonts/packs`; on macOS it is `~/Library/Application Support/pscat`):

```sh
mkdir -p "<data-dir>/lib" && cp LIB/*.ps "<data-dir>/lib/"
```

Then `(lib/sheet.ps) run` works from any directory, in a project with no
`lib/` folder of its own (a project `lib/` is searched first). With the CLI
only, `PSCAT_LIB=LIB` does the same for one directory.
