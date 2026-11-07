# PostScript API

The sheet_music library is plain PostScript. With nothing but
[pscat](https://github.com/PSCatLabs/pscat) (the CLI or its MCP tools) it
parses ABC, lays out and engraves a score, checks a tune for problems, and
gives you the glyphs (clefs, noteheads, rests, accidentals ...) to draw your
own notation. This page lists every public name. The generated
[index](#index-of-public-names) at the end is checked against the source by
`tests/ps-api.test.mjs` (`node scripts/ps-api.mjs --write` refreshes it).

| File | What it holds |
|---|---|
| [`lib/sheet.ps`](../lib/sheet.ps) | the entry file: loads the rest, adds the check/list/inline helpers |
| [`lib/sm_engrave.ps`](../lib/sm_engrave.ps) | glyphs and drawing primitives |
| [`lib/sm_abc_parse.ps`](../lib/sm_abc_parse.ps) | ABC text → Score dictionary |
| [`lib/sm_abc.ps`](../lib/sm_abc.ps) | layout and engraving of a Score, the one-liners |
| [`lib/sm_transpose.ps`](../lib/sm_transpose.ps) | transposition of a Score (loaded by `sheet.ps` when present) |
| [`lib/sm_musicxml.ps`](../lib/sm_musicxml.ps) | MusicXML text → Score dictionary, and its engrave procedures (loaded by `sheet.ps` when present) |
| [`lib/sm_perform.ps`](../lib/sm_perform.ps) | playback: the notes as JSON events (loaded by `sheet.ps` when present) |

## Quick start

```sh
# from the repository root
pscat --pdf song.pdf --page 612x792 -e '(lib/sheet.ps) run (song.abc) sm-abc-engrave-file'
pscat --png song.png --page 612x792 --dpi 110 -e '(lib/sheet.ps) run (song.abc) sm-abc-engrave-file'
pscat --pdf /dev/null -e '(lib/sheet.ps) run (song.abc) sm-abc-check-file 0 0 1 1 rectfill showpage'
```

Always give pscat an output (`--pdf`, `--png`, `--svg`): without one it
opens a window and waits. `--page WxH` must match the paper the score is laid
out for, since the engraver does not set the page size itself:

| `/paper` | `--page` | MCP `width` × `height` |
|---|---|---|
| `/letter` (default) | `612x792` | 612 × 792 |
| `/a4` | `595x842` | 595 × 842 |
| `[w h]` | `wxh` | w × h |

A multi-page score written with `--png out.png` becomes `out-001.png`,
`out-002.png` … (one page: `out.png`). Add `--lint-strict` to fail on a
leftover stack or unbalanced `gsave`.

## Loading: `lib/sheet.ps` and `sm-lib-dir`

`(path/to/sheet.ps) run` loads `sm_engrave.ps`, `sm_abc_parse.ps`,
`sm_abc.ps` and, if they exist, `sm_transpose.ps`, `sm_musicxml.ps` and
`sm_perform.ps`, all into `userdict`.
pscat cannot tell a program the path of the file it is running, so
`sheet.ps` looks for its siblings in this order and uses the first directory
that has `sm_engrave.ps`:

1. **`sm-lib-dir`**, if you define it first: a string ending in `/`.
   `/sm-lib-dir (/abs/path/lib/) def (/abs/path/lib/sheet.ps) run` works
   from any current directory. This is the reliable form.
2. **`(lib/)`**: the current directory's `lib/` (the repository root), and
   pscat's own search for names starting with `lib/`: `$PSCAT_LIB`,
   `$PSCAT_HOME/lib`, the per-user pscat data directory's `lib/`, then the
   `lib/` beside the pscat binary. So with `PSCAT_LIB=/abs/path/lib`,
   `(lib/sheet.ps) run` works anywhere, and pscat's bundled libraries
   (`(lib/artkit.ps) run`) still resolve.
3. **`(.sheet-music/)`**: a copy inside the project, which is what the pscat
   MCP tools can read (they only read inside the project and pscat's own
   folders).
4. **`()`**: the current directory itself.

`sm-lib-dir` is then defined in `userdict` as the directory used. If nothing
is found, `sheet.ps` prints `sm-abc: error: cannot find sm_engrave.ps ...`
and stops with `undefinedfilename`.

| Name | Signature | |
|---|---|---|
| `sm-lib-dir` | value, `(dir/)` | where the library was loaded from (set it before running `sheet.ps` to choose) |
| `sm-sheet-version` | value, `(0.1.0)` | version of the entry file |
| `sm-sheet-dict` | value, dict | `sheet.ps`'s private temporaries (`sm-sh-*`) |

`sm_abc.ps` alone still works: when `sm-abc-parse` is not defined yet, the
engrave procedures run `sm_abc_parse.ps` from `sm-lib-dir` (default `(lib/)`).

## Engraving ABC

All the engrave procedures draw every page and end each with `showpage`.
They print the parser's warnings to stdout first (see
[Warnings](#warnings-and-checking)).

| Procedure | Stack |
|---|---|
| `sm-abc-engrave-file` | `(song.abc) sm-abc-engrave-file –` or `(song.abc) options sm-abc-engrave-file –` |
| `sm-abc-engrave-string` | `(abc text) sm-abc-engrave-string –` or `(abc text) options sm-abc-engrave-string –` |
| `sm-abc-engrave-here` | `sm-abc-engrave-here –` or `options sm-abc-engrave-here –`: the ABC is the rest of the program file |
| `sm-abc-here` | `sm-abc-here (text)`: read the rest of the program file up to a line `%%SM-ABC-END` (or the end) |
| `sm-abc-engrave` | `score sm-abc-engrave –` or `score options sm-abc-engrave –`: a Score dict you already have |

### Options

A dictionary; every key is optional.

| Key | Value | Default |
|---|---|---|
| `/paper` | `/letter`, `/a4`, or `[width height]` in points | `/letter` |
| `/staff-space` (or `/sp`) | staff space in points; the whole score scales with it | `5.5` |
| `/breaks` | `(source)` keeps the ABC's line ends; `(auto)` fills lines | `(source)` |
| `/tune` | which tune of a file with several `X:` tunes, **0-based** (`/tune 0` is the first; `sm-abc-list-file` shows the numbers) | `0` |
| `/footer` | credit line at the bottom of the last page; `()` for none | from `S:`, `Z:` and the rights |
| `/margin` `/top` `/bottom` | page margins in points | `50` `46` `44` |
| `/annotations` | reader's marks, `[<< /page 1 /type (text) /x 100 /y 500 /rgb [1 0 0] /text (breathe) >> ...]`; `/type` also `(circle)` / `(highlight)` with `/w /h` | the tune's `%%annotation` lines |
| `/transpose` | semitones (`2`, `-12`); a tune's `%%transpose` adds to it | `0` |
| `/quiet` | `true` stops the warnings being printed | `false` |

```postscript
(lib/sheet.ps) run
(samples/greensleeves.abc) << /paper /a4 /staff-space 6 /breaks (auto) >> sm-abc-engrave-file
% render with --page 595x842
```

### ABC inside the program file

An agent can write one `.ps` file holding both the call and the music.
`sm-abc-engrave-here` reads the lines that follow its own line, up to a line
`%%SM-ABC-END` or the end of the file, and engraves them. The call must be the
last thing on its line. The ABC is read raw: parentheses, backslashes and
`%` need no escaping.

```postscript
%!PS
(lib/sheet.ps) run
<< /footer (Exercise 3) >> sm-abc-engrave-here
X:1
T:Triplets
M:3/4
L:1/8
K:G
(3GAB c2 d2 | (ed) B2 G2 | A6 |]
%%SM-ABC-END
```

To check before engraving, read the text first and use it twice:

```postscript
(lib/sheet.ps) run
sm-abc-here
X:1
T:Check me
M:2/4
L:1/8
K:F
(3FGA B2 | c4 |]
%%SM-ABC-END
dup sm-abc-check-string sm-abc-engrave-string
```

`sm-abc-engrave-string` takes ABC in an ordinary PostScript string,
`(X:1\nT:Scale\nK:C\nCDEF GABc|]) sm-abc-engrave-string`. That is fine for a
line or two, but a string literal needs balanced parentheses and doubled
backslashes: a triplet `(3ABc` or an accent `\'e` breaks it. Use the
`currentfile` form above for real tunes. `sm-abc-readsrc`
(`file (marker) sm-abc-readsrc (text)`) is the reader underneath: it returns
the lines of `file` up to one equal to `marker`, or to the end of the file
when the marker is `null`.

## Warnings and checking

The parser skips what it cannot read and says so in `sm-abc-warnings`
(`[(tune 1: ...) ...]`, from the last parse). The engrave procedures print
each one to stdout as `sm-abc: warning: tune 1: ...`. `sm-abc-print-warnings`
(`options sm-abc-print-warnings –`) is the procedure that does this: it
prints nothing when `options` has `/quiet true`.

| Procedure | Stack | Prints |
|---|---|---|
| `sm-abc-list-file` | `(song.abc) sm-abc-list-file –` | one line per tune |
| `sm-abc-list-string` | `(abc text) sm-abc-list-string –` | the same |
| `sm-abc-check-file` | `(song.abc) sm-abc-check-file –` | the list, every warning, bars whose length disagrees with the meter, a summary, and `sm-abc: ok` when there is nothing to fix |
| `sm-abc-check-string` | `(abc text) sm-abc-check-string –` | the same |

The check prints a `sm-abc: /tune N:` header before each tune's bar notes in a file with several tunes; the parser's own warnings count tunes from 1 (`tune 1:` is `/tune 0`).

The check and list procedures draw nothing. Under `--lint-strict` a program
that draws nothing fails as a blank page, so paint a dot:
`... sm-abc-check-file 0 0 1 1 rectfill showpage`.

```
$ pscat --pdf /dev/null -e '(lib/sheet.ps) run (samples/feature-tour.abc) sm-abc-check-file 0 0 1 1 rectfill showpage'
sm-abc: 1 tune
sm-abc: /tune 0  X:1  "Feature Tour"  M:4/4  K:2#  bars 16  staves 1
sm-abc: bar 10: 7/8 of a whole note, M:3/4 wants 3/4
sm-abc: check: 1 tune(s), 0 warning(s), 1 bar(s) off the meter
```

Every bar that is too long is reported. A short bar is reported unless it is
the pickup (bar number 0), the last bar, ends at a double or repeat bar line
(`||`, `:|`: it completes a pickup), or makes a whole bar with a short
neighbour (a bar split around a section start). Multi-measure rests and free
meter (`M:none`) are not checked. (`feature-tour.abc` bar 10 really is an
eighth too long.)
`K:2#` is the key signature (two sharps; `3b` three flats). The meter shown is
the first one.

## The Score

The parsers (ABC: `lib/sm_abc_parse.ps`, MusicXML: `lib/sm_musicxml.ps`)
build one dictionary per tune, and the layout (`sm-abc-engrave`), the
transposition and the playback take it. Strings are UTF-8 bytes, fractions
`[num den]` reduced, an absent value `null` or a missing key. `sm-abc-json`
prints it with the keys sorted. The model (it was the JavaScript parsers'
`src/score.js`, retired in #10):

```
score = <<
  /meta    << /title /subtitles [] /composer /origin /area /book /history /rhythm /transcriber /notes [] /source /words [] /rights >>
  /tempo   << /text /beat [n d] or null /bpm >> or null
  /staves  [ << /id /name /clef << /sign (G)|(F)|(C) /line /octave >> >> ... ]
  /group   (brace) | (bracket) | null
  /initial << /key << /fifths >> /time << /num /den /symbol /text >> >>
  /measures [ <<
    /staves [ << /events [event ...] >> ... ]      one entry per staff
    /key /time /clefs [clef or null ...]           changes that take effect here (optional)
    /startRepeat bool  /endBar (single)|(double)|(final)|(thick-thin)|(repeat-end)
    /ending << /label /closed /span >>             a volta bracket starting here (optional)
    /lineBreak bool  /number  /mmCount  /part /pickup
  >> ... ]
>>
event = << /kind (note)|(rest) /dur [n d] (sounding) /type [n d] (written) /dots
  /notes [ << /step /oct /acc /alter /tie >> ... ] /beam bool
  optional: /tuplet << /p /q /id /first /last /closed >>  /grace << /notes /slash >>
            /decos []  /dyn  /hairpinStart /hairpinEnd  /chord  /annot
            /lyrics [<< /text /hyphen /extend >> ...]  /slurStart /slurEnd  /tiedFrom
            /rest << /measure /count /invisible >>  /len /tup /spacer >>
```

## Parsing ABC

From [`lib/sm_abc_parse.ps`](../lib/sm_abc_parse.ps). A Score is the
dictionary described [above](#the-score) (`/meta /initial /staves /measures
/tempo /group`); strings are UTF-8 bytes, fractions `[num den]`.

| Procedure | Stack |
|---|---|
| `sm-abc-parse` | `(abc text) sm-abc-parse score`: the first tune |
| `sm-abc-parse-all` | `(abc text) sm-abc-parse-all [score ...]`: every tune |
| `sm-abc-parse-file` | `(path.abc) sm-abc-parse-file score` |
| `sm-abc-parse-file-all` | `(path.abc) sm-abc-parse-file-all [score ...]` |
| `sm-abc-warnings` | value: `[(text) ...]` from the last parse |
| `sm-abc-annotations` | `(abc text) tune sm-abc-annotations [<< ... >> ...]`: the `%%annotation` marks of tune (0-based), in the `/annotations` option's form |
| `sm-abc-json` | `any sm-abc-json –`: print a value as JSON (keys sorted) to stdout |

```postscript
(lib/sheet.ps) run
(samples/twinkle.abc) sm-abc-parse-file /meta get /title get =    % Twinkle, Twinkle, Little Star
```

### Score metadata as JSON

Also in [`lib/sm_abc_parse.ps`](../lib/sm_abc_parse.ps) (#9). `sm-score-meta`
prints what a program around the engraver needs to know about a text without
engraving it, as one line of JSON (keys sorted, then a newline): the title
and composer for the PDF, the key after transposition, the list of tunes,
the reader's marks and the parse warnings. `sheet` (`bin/sheet.mjs`) and the
editor run it first (`src/psdoc.js` `metaPS` writes the document, `readMeta`
reads the line) and write the engraving document from it: there is no
parser in JavaScript. `tests/ps-meta.test.mjs` checks it against what the
retired JS parser gave (`scoreMeta`, frozen in
`tests/fixtures/reference/meta.json`) for every sample and fixture, every
tune, transposed 0, +2 and −5.

| Procedure | Stack |
|---|---|
| `sm-score-meta` | `(text) [options] sm-score-meta –`: print the JSON line |
| `sm-score-meta-file` | `(path) [options] sm-score-meta-file –`: the same for a file |
| `sm-score-meta-dict` | `(text) [options] sm-score-meta-dict dict`: the same keys as a dictionary, printing nothing |

Options: `/tune` (0-based), `/transpose` (semitones; the tune's
`%%transpose` adds to it) and `/format` (`(abc)` or `(musicxml)`; without it
the text is sniffed: MusicXML when, after white space, it starts with
`<?xml` or holds `<score-partwise` or `<score-timewise` in its first 2000
bytes). MusicXML needs
`lib/sm_musicxml.ps` and a transposition `lib/sm_transpose.ps`; both are run
from `sm-lib-dir` (else `lib/`) when they are not loaded.

| Key | Value |
|---|---|
| `title` | the chosen tune's title, `Untitled` when it has none (`null` with an `error`) |
| `composer` | its `C:` lines (`""` when none) |
| `format` | `abc` or `musicxml` |
| `tune` | the `/tune` asked for |
| `tunes` | `[{ "index": 0, "title": "...", "x": "1" }, ...]`: every tune; `x` is the `X:` number as written, `null` without one (and for MusicXML) |
| `sourceTranspose` | the tune's `%%transpose` (else the file header's), as `sm-abc-tune-transpose` |
| `transpose` | the total: `/transpose` plus `sourceTranspose` |
| `transposed` | `{ "key": "D", "semis": 2 }`: the major key the signature shows after transposing, or `null` when the total is 0 |
| `annotations` | the tune's `%%annotation` marks: the `/annotations` option's keys (positions and colour rounded to 2 decimals) plus `line` (0-based, counted from the tune's `X:` line; in the whole text for MusicXML) and `color` as written (`red`, `#1f5fbf`) |
| `warnings` | the parser's warnings, as `sm-abc-warnings` / `sm-musicxml-warnings` |
| `error` | `null`, or why there is no score: `no tune number 4 (the input has 1)`, or the MusicXML parser's reason (`not a MusicXML score (no <score-partwise>)`) |

```
$ pscat --pdf /dev/null -e '(lib/sheet.ps) run (samples/twinkle.abc) << /transpose 2 >> sm-score-meta-file'
{"annotations":[],"composer":"French traditional (1761)","error":null,"format":"abc","sourceTranspose":0,"title":"Twinkle, Twinkle, Little Star","transpose":2,"transposed":{"key":"D","semis":2},"tune":0,"tunes":[{"index":0,"title":"Twinkle, Twinkle, Little Star","x":"1"}],"warnings":[]}
```

pscat's CLI prints its own `pscat: wrote ...` line on stdout right after
the program's output (pscat#1058); skip lines that start with `pscat: `.
Whether a reader's mark falls on a page the score has is known only once
it is laid out: the engrave procedures print
`sm-abc: warning: annotation on page 3, but the score has 1` for one that
does not (unless `/quiet true`).

## MusicXML

From [`lib/sm_musicxml.ps`](../lib/sm_musicxml.ps) (#5), which `sheet.ps`
loads. It reads an uncompressed `score-partwise` document (`.musicxml` or
`.xml`; unzip a `.mxl` first) into the same Score the ABC parser builds, so
the same layout engraves it. It began as a port of the JavaScript parser
(`src/musicxml.js`, retired in #10) and still gives that parser's Score for
every sample and fixture (`tests/ps-musicxml.test.mjs`). It reads: parts and
multi-staff parts (one voice per staff, the first found), keys, meters
(common/cut, `3+2`, `senza-misura`), clefs, notes, rests, chords, dots, ties,
slurs, tuplets, beams (or automatic beaming when a part has none),
accidentals, grace notes, fermatas, articulations, ornaments, bowings,
dynamics, wedges, words, metronome marks, chord symbols (`<harmony>`), lyrics,
barlines, repeats, endings and `new-system` breaks. The XML reader handles
attributes in either quote, self-closing tags, the five named entities and
numeric ones (`&#233;`, `&#x1F3B5;`, written out as UTF-8), comments, CDATA,
processing instructions and the DOCTYPE.

```sh
pscat --pdf song.pdf --page 612x792 -e '(lib/sheet.ps) run (song.musicxml) sm-musicxml-engrave-file'
```

| Procedure | Stack |
|---|---|
| `sm-musicxml-engrave-file` | `(song.musicxml) sm-musicxml-engrave-file –` or `(song.musicxml) options sm-musicxml-engrave-file –` |
| `sm-musicxml-engrave-string` | `(xml text) sm-musicxml-engrave-string –` or `(xml text) options sm-musicxml-engrave-string –` |
| `sm-musicxml-engrave-here` | `sm-musicxml-engrave-here –` or `options sm-musicxml-engrave-here –`: the MusicXML is the rest of the program file, up to a line `%%SM-ABC-END` (in `sheet.ps`) |
| `sm-musicxml-here` | `sm-musicxml-here (text)`: read that text without engraving it (in `sheet.ps`) |
| `sm-musicxml-check-file` | `(song.musicxml) sm-musicxml-check-file –`: a summary line, the warnings, bars off the meter and `sm-abc: ok`, or the parse error (in `sheet.ps`) |
| `sm-musicxml-check-string` | `(xml text) sm-musicxml-check-string –`: the same |
| `sm-musicxml-parse` | `(xml text) sm-musicxml-parse score` |
| `sm-musicxml-parse-file` | `(path.musicxml) sm-musicxml-parse-file score` |
| `sm-musicxml-warnings` | value: `[(text) ...]` from the last parse (`staff 1: only one voice per staff is engraved; voice 2 was skipped`) |
| `sm-musicxml-error` | value: why the last parse failed, or `null` |

The options are [`sm-abc-engrave`'s](#options) (`/tune` does not apply). The
engrave procedures print the warnings as `sm-abc: warning: ...` unless
`/quiet true`. A comment line `<!-- %%transpose N -->` adds to `/transpose`,
and `<!-- %%annotation ... -->` lines become the `/annotations` (both read by
`sm_abc_parse.ps`, which `sheet.ps` loads).

A document the parser cannot read (malformed XML, no `<score-partwise>`, a
`score-timewise` file) raises `syntaxerror` with the reason as the offending
command, `sm-musicxml: not a MusicXML score (no <score-partwise>)`, and leaves
the reason in `sm-musicxml-error`. Catch it with `stopped`:

```postscript
(lib/sheet.ps) run
{ (notes.xml) sm-musicxml-parse-file } stopped { sm-musicxml-error = } { /score exch def } ifelse
```

```
$ pscat --pdf /dev/null -e '(lib/sheet.ps) run (samples/frere-jacques.musicxml) sm-musicxml-check-file 0 0 1 1 rectfill showpage'
sm-abc: musicxml  "Frère Jacques"  M:4/4  K:0  bars 8  staves 1
sm-abc: check: 1 score, 0 warning(s), 0 bar(s) off the meter
sm-abc: ok
```

## Transposing

From [`lib/sm_transpose.ps`](../lib/sm_transpose.ps) (#6), which `sheet.ps`
loads. The engrave procedures take `/transpose semitones` in their options,
and for ABC text a `%%transpose N` line in the tune (else in the file header)
adds to it. The new key is the one with the fewest accidentals; notes, key
changes and chord symbols are respelled in it. Written pitch for transposing
instruments: B♭ clarinet or trumpet `2`, E♭ alto sax `9`, F horn `7`, an
octave down `-12`.

```postscript
(lib/sheet.ps) run
(samples/twinkle.abc) << /transpose 2 >> sm-abc-engrave-file      % in D
```

| Procedure | Stack |
|---|---|
| `sm-score-transpose` | `score semis sm-score-transpose score`: transposes the Score **in place** and sets `score /transposed << /semis /key (D) >>` |
| `sm-abc-tune-transpose` | `(abc text) tune sm-abc-tune-transpose n`: the `%%transpose` of that tune (0-based), else the file header's, else 0 (in `sm_abc_parse.ps`) |
| `sm-transpose-fifths-shift` | `semis fifths sm-transpose-fifths-shift df`: the line-of-fifths shift that leaves a key of `fifths` with the fewest accidentals |
| `sm-transpose-pitch` | `(step) oct alter semis df respell sm-transpose-pitch << /step /oct /alter >>`: move one pitch |
| `sm-transpose-chord` | `(text) df sm-transpose-chord (text)`: chord symbols, `(Am7) 2` → `(Bm7)`, `(Bb/D) 2` → `(C/E)` |

## Playback: the notes as JSON events

From [`lib/sm_perform.ps`](../lib/sm_perform.ps) (#8), which `sheet.ps`
loads. `sm-abc-performance` prints what a tune sounds like as one line of
JSON on stdout, so a program that cannot run PostScript itself (the editor's
Web Audio player, `src/play.js midiFile`, any MIDI writer) only turns events
into sound. It began as a port of `src/play.js`'s `performance()` (retired
in #10), and `tests/ps-perform.test.mjs` checks that it still gives exactly
that function's events for every sample, transposed or not.

- **Repeats** `|: :|` and **1st/2nd endings** (`[1`, `[2`, `[1,3`, `[1-3`)
  are played out; **ties** join notes, also over bar lines.
- **Pitch** comes from the key signature and the accidentals carried through
  the bar, as written; a note tied over the bar keeps its accidental.
- Grace notes, D.C./D.S., dynamics and articulations are not performed. A
  multi-measure rest lasts its bars; an empty bar lasts the meter.
- **Time** is exact: `at`, `dur` and `length` are fractions of a whole note,
  `[num, den]` reduced, from the start. Seconds = fraction × 4 × 60 / bpm
  when the beat is a quarter; in general fraction × 60 / (bpm × beat).

| Procedure | Stack |
|---|---|
| `sm-abc-performance` | `(abc text) [options] sm-abc-performance –` or `score [options] sm-abc-performance –`: print the JSON line |
| `sm-abc-performance-file` | `(song.abc) [options] sm-abc-performance-file –`: the same for a file |
| `sm-score-performance` | `score sm-score-performance dict`: the performance as a dictionary (same keys), printing nothing |

Options are `/tune` (0-based, ABC text) and `/transpose` (semitones; for ABC
text the tune's `%%transpose` adds to it), as for the engrave procedures. A
Score dict given directly (e.g. from `sm-musicxml-parse`) is transposed in
place.

```
$ pscat --pdf /dev/null -e '(lib/sheet.ps) run (samples/twinkle.abc) sm-abc-performance-file'
{"length":[12,1],"notes":[{"at":[0,1],"dur":[1,4],"midi":60,"staff":0},{"at":[1,4],"dur":[1,4],"midi":60,"staff":0},...],"staves":1,"tempo":{"beat":[1,4],"bpm":100},"title":"Twinkle, Twinkle, Little Star"}
```

| Key | Value |
|---|---|
| `notes` | `[{ "at": [n,d], "dur": [n,d], "midi": 60, "staff": 0 }, ...]`, sorted by time, then staff, then pitch. `midi` 60 is middle C. `staff` is the staff index: each ABC voice (`V:`) is a staff, so it is also the voice (one MIDI track each) |
| `length` | `[n,d]`: when the last bar ends |
| `tempo` | `{ "beat": [1,4], "bpm": 100 }`: from `Q:` (default a quarter = 100) |
| `staves` | number of staves |
| `title` | the tune's title (`Untitled` when it has none) |

## Glyphs and drawing primitives

From [`lib/sm_engrave.ps`](../lib/sm_engrave.ps). The conventions:

- **Units.** Callers pass positions in **points** (page space, origin at the
  lower left). Each glyph is drawn in **staff spaces**: `sm-sp` points is the
  distance between two staff lines. Set `/sm-sp 8 def` before drawing; the
  default is 5.5 (the engraver sets it from `/staff-space`).
- **Vertical position.** A note's staff position `pos` counts staff steps
  (line, space, line ...) from the centre line: `y = centre + pos × sm-sp / 2`.
  On a treble staff pos 0 is B4, −2 G4, −6 middle C (first ledger line below);
  on a bass staff pos 0 is D3.
- **Origins.** A glyph's origin is its musical reference point: the centre of
  a notehead, the G line for the treble clef, the F line for the bass clef,
  the C line for the alto clef, the centre line for the staff, rests and time
  signatures.
- **Ink.** Every glyph calls `sm-ink` (default `0 setgray`); redefine it,
  e.g. `/sm-ink { 0.6 0 0 setrgbcolor } def`, to colour what follows.
- **Names.** Every library name starts with `sm-`, and procedures keep their
  temporaries in global `sm-` names (`sm-th`, `sm-bt` ...; PostScript has no
  locals). Use another prefix for your own names, or a dictionary of your own.

### Helpers

| Procedure | Stack | |
|---|---|---|
| `sm-sp` | value | staff space in points (default 5.5) |
| `sm-ink` | `– sm-ink –` | sets the colour; called by every glyph |
| `sm-at` | `x y sm-at –` | `gsave`, move the origin to (x, y), scale to staff spaces, `sm-ink`; pair with `grestore` |
| `sm-disc` | `x y r sm-disc –` | filled circle (current units) |
| `sm-ellipse` | `cx cy a b angle sm-ellipse –` | append an ellipse to the path |
| `sm-nib` | `w angle squash sm-nib –` | stroke the current path with a broad, slanted pen (thick and thin curves) |
| `sm-ribbon` | `[x0 y0 w0 x1 y1 w1 ...] sm-ribbon –` | fill a smooth stroke through knots, each with its own width |
| `sm-mtx` | value | a scratch matrix used by `sm-ellipse`, `sm-nib`, `sm-annot-circle` |
| `sm-r2` | `x sm-r2 x'` | round to 2 decimals (all positions the layout draws go through it, so CLI and WebAssembly agree) |

```postscript
/sm-sp 10 def
100 100 sm-at 0 0 1 sm-disc grestore          % a disc of radius one staff space at (100, 100)
```

### Staff, bar lines, ledger lines

| Procedure | Stack | |
|---|---|---|
| `sm-staff` | `x y w sm-staff –` | five lines from x, `w` points long; `y` is the centre line |
| `sm-ledger` | `x1 x2 y sm-ledger –` | one ledger line at height y |
| `sm-bar-thin` | `x y1 y2 sm-bar-thin –` | thin bar line from y1 to y2 (the staff: centre ± 2 sp) |
| `sm-bar-thick` | `x y1 y2 sm-bar-thick –` | thick bar line (final bar, repeats) |
| `sm-repeat-dots` | `x y sm-repeat-dots –` | the two dots of a repeat; y = staff centre |

```postscript
/sm-sp 8 def
60 600 400 sm-staff
460 600 16 sub 600 16 add sm-bar-thin
```

### Noteheads, stems, flags, beams, dots

Heads are centred on (x, y). Half-width: 0.59 sp for black and half heads,
0.82 sp for whole and breve. An up stem goes on the right at
`x + 0.53 sp`, from `y + 0.18 sp` up to about `y + 3.5 sp`; a down stem on
the left at `x − 0.53 sp`, down to about `y − 3.5 sp`.

| Procedure | Stack | |
|---|---|---|
| `sm-head-black` | `x y sm-head-black –` | quarter and shorter |
| `sm-head-half` | `x y sm-head-half –` | |
| `sm-head-whole` | `x y sm-head-whole –` | |
| `sm-head-breve` | `x y sm-head-breve –` | |
| `sm-head-x` | `x y sm-head-x –` | an x head (percussion, unpitched) |
| `sm-dot` | `x y sm-dot –` | augmentation dot; put it in a space (pos odd) |
| `sm-stem` | `x y1 y2 sm-stem –` | stem from y1 to y2, all in points |
| `sm-flags` | `x y n up sm-flags –` | `n` flags at the stem tip (x, y); `up` true for an up stem. x is the stem's centre minus half its width (0.06 sp) |
| `sm-flag-up-path` | `– sm-flag-up-path –` | the path of one flag, in staff spaces at the tip (used by `sm-flags`) |
| `sm-beam` | `x1 y1 x2 y2 dir sm-beam –` | a beam between two stem tips; `dir` 1 for up stems (the beam hangs below the tip line), −1 for down. For a second beam, move the tips 0.75 sp inwards (toward the heads) |

```postscript
/sm-sp 8 def
100 600 sm-head-black 100 0.53 8 mul add 600 1.44 add 600 28 add sm-stem
```

### Rests

`y` is the staff centre for all of them.

| Procedure | Stack | |
|---|---|---|
| `sm-rest-whole` | `x y sm-rest-whole –` | hangs from the line above the centre |
| `sm-rest-half` | `x y sm-rest-half –` | sits on the centre line |
| `sm-rest-quarter` | `x y sm-rest-quarter –` | |
| `sm-rest-flagged` | `x y n sm-rest-flagged –` | n = 1 eighth, 2 sixteenth, 3 thirty-second |
| `sm-rest-hook` | `– sm-rest-hook –` | one hook of a flagged rest, in staff spaces at the current origin (used by `sm-rest-flagged`) |
| `sm-mmrest` | `x1 x2 y (count) sm-mmrest –` | multi-measure rest bar with its count above |

### Accidentals

Centred on the note's line or space: place them to the left of the head
(about 1.5–1.6 sp before its centre).

| Procedure | Stack |
|---|---|
| `sm-acc-sharp` | `x y sm-acc-sharp –` |
| `sm-acc-flat` | `x y sm-acc-flat –` |
| `sm-acc-natural` | `x y sm-acc-natural –` |
| `sm-acc-dsharp` | `x y sm-acc-dsharp –` (double sharp) |
| `sm-acc-dflat` | `x y sm-acc-dflat –` (double flat) |

A key signature is a row of these: on a treble staff the sharps go at
pos 4 1 5 2 −1 3 0 (F C G D A E B), the flats at pos 0 3 −1 2 −2 1 −3,
about 1 sp apart.

### Clefs and time signatures

| Procedure | Stack | |
|---|---|---|
| `sm-clef-treble` | `x y sm-clef-treble –` | x = left edge, y = the G line (centre − 1 sp) |
| `sm-clef-treble8` | `x y sm-clef-treble8 –` | treble with an 8 below (tenor voice, guitar) |
| `sm-clef-bass` | `x y sm-clef-bass –` | y = the F line (centre + 1 sp) |
| `sm-clef-alto` | `x y sm-clef-alto –` | y = the C line; for a tenor clef put it on the fourth line (centre + 1 sp) |
| `sm-clef-treble-knots` | value | the treble clef's ribbon knots (x y width ...) |
| `sm-timesig` | `x y (num) (den) sm-timesig –` | centred at x; y = staff centre |
| `sm-ts-digits` | `x y (str) sm-ts-digits –` | one row of time-signature digits centred at (x, y) |
| `sm-tsfont` | `– sm-tsfont –` | selects the digits' font (in staff-space units) |
| `sm-ts-common` | `x y sm-ts-common –` | common time C |
| `sm-ts-cut` | `x y sm-ts-cut –` | cut time |
| `sm-ts-c-path` | `– sm-ts-c-path –` | the C's path in staff spaces (used by the two above) |

```postscript
/sm-sp 8 def
60 600 300 sm-staff
66 600 8 sub sm-clef-treble      100 600 (3) (4) sm-timesig
60 540 300 sm-staff
66 540 8 add sm-clef-bass        100 540 sm-ts-common
```

### Ties, slurs, tuplets, voltas, brackets

| Procedure | Stack | |
|---|---|---|
| `sm-tie` | `x1 y1 x2 y2 h sm-tie –` | tie or slur between two points, bulging `h` points (positive above, negative below) |
| `sm-tuplet` | `x1 x2 y (n) bracket up sm-tuplet –` | tuplet number centred over x1..x2, with a bracket when `bracket` is true; y = the bracket line, `up` true when it is above the notes |
| `sm-volta` | `x1 x2 y (label) closed sm-volta –` | ending bracket at height y; `closed` draws the right-hand drop |
| `sm-brace` | `x ytop ybot sm-brace –` | piano brace, right edge at x |
| `sm-bracket` | `x ytop ybot sm-bracket –` | square bracket (choir, ensemble), left of x |

### Articulations, ornaments, dynamics

`y` is where the mark's centre goes (about 1.2 sp outside the head or the
stem end).

| Procedure | Stack |
|---|---|
| `sm-art-staccato` | `x y sm-art-staccato –` |
| `sm-art-tenuto` | `x y sm-art-tenuto –` |
| `sm-art-accent` | `x y sm-art-accent –` |
| `sm-art-marcato` | `x y sm-art-marcato –` |
| `sm-art-fermata` | `x y up sm-art-fermata –`: `up` true above the staff, false for the inverted one below |
| `sm-art-trill` | `x y sm-art-trill –` (tr) |
| `sm-art-roll` | `x y sm-art-roll –` |
| `sm-art-uppermordent` | `x y sm-art-uppermordent –` |
| `sm-art-lowermordent` | `x y sm-art-lowermordent –` (with the vertical stroke) |
| `sm-mordent-path` | `– sm-mordent-path –`: the zigzag path in staff spaces |
| `sm-art-upbow` | `x y sm-art-upbow –` |
| `sm-art-downbow` | `x y sm-art-downbow –` |
| `sm-art-segno` | `x y sm-art-segno –` |
| `sm-art-coda` | `x y sm-art-coda –` |
| `sm-art-breath` | `x y sm-art-breath –` (a comma) |
| `sm-grace-slash` | `x y sm-grace-slash –`: the acciaccatura slash, centred at (x, y) |
| `sm-dynamic` | `x y (mf) sm-dynamic –`: bold italic, left edge at x, baseline at y |
| `sm-hairpin` | `x1 x2 y open-right sm-hairpin –`: crescendo when `open-right` is true, diminuendo when false |

### Text, lyrics, chord symbols, tempo

Text uses only the 35 standard PostScript fonts (`/Times-Roman`,
`/Times-Bold`, `/Times-Italic`, `/Helvetica`, `/NewCenturySchlbk-Bold` ...).
A text argument `t` is a string, or an array mixing strings and accented
letters `[(base) (accent) raise]`, e.g. `[(Caf) [(e) (\302) 0] ]` for
"Café" (`\302` acute, `\301` grave, `\303` circumflex, `\310` dieresis,
`\304` tilde in StandardEncoding; `raise` in points). pscat cannot
re-encode fonts, so this is how accents are drawn
([FRICTION #1](FRICTION.md)); the parser does it for ABC text automatically.

| Procedure | Stack | |
|---|---|---|
| `sm-text-l` | `x y t font size sm-text-l –` | left-aligned at x, baseline y |
| `sm-text-c` | `x y t font size sm-text-c –` | centred on x |
| `sm-text-r` | `x y t font size sm-text-r –` | right-aligned at x |
| `sm-show` | `t sm-show –` | show `t` at the current point (font already set) |
| `sm-tw` | `t sm-tw w` | width of `t` in the current font |
| `sm-compose` | `(base) (accent) raise sm-compose –` | show one accented letter at the current point |
| `sm-setf` | `font size sm-setf –` | `findfont scalefont setfont` |
| `sm-lyric` | `x y (syl) sm-lyric –` | a syllable centred at x |
| `sm-lyric-font` `sm-lyric-size` | values | `/Times-Roman`, `10.5`; define them before loading to change |
| `sm-lyric-hyphen` | `x1 x2 y sm-lyric-hyphen –` | hyphen midway between two syllable centres |
| `sm-lyric-extend` | `x1 x2 y sm-lyric-extend –` | melisma extender line |
| `sm-chordsym` | `x y (root) acc (kind) (bass) bacc sm-chordsym –` | chord symbol; `acc`/`bacc` 1 sharp, −1 flat, 0 none; `(bass)` empty for no slash bass: `100 700 (B) -1 (m7) () 0 sm-chordsym` is B♭m7 |
| `sm-chacc` | `acc sm-chacc –` | the small accidental of a chord symbol at the current point |
| `sm-chord-font` `sm-chord-size` | values | `/Times-Roman`, `11` |
| `sm-tempo` | `x y (text) value dots (= 96) sm-tempo –` | tempo mark: `value` 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth (0 for text only), `dots` 0 or 1: `60 740 (Allegro) 4 0 ( = 120) sm-tempo` |

### Reader's marks

Points and `r g b` colour; what `%%annotation` lines draw.

| Procedure | Stack |
|---|---|
| `sm-annot-text` | `x y t r g b sm-annot-text –`: an italic note, baseline at y |
| `sm-annot-circle` | `x y w h r g b sm-annot-circle –`: an ellipse inside the box |
| `sm-annot-highlight` | `x y w h r g b sm-annot-highlight –`: a filled box (draw it before the music, in a pale colour) |

## Drawing your own notation with the glyphs

For worksheets, theory examples, fingering charts or anything ABC does not
describe, draw directly. This page is a note-naming worksheet: two staves,
clefs, a time signature, notes with stems and a ledger line, accidentals, a
dot, beamed eighths, a rest and bar lines. Render it from the repository root
with `pscat --png sheet.png --page 612x792 --dpi 150 exercise.ps`.
`tests/ps-api.test.mjs` renders this exact block.

<!-- example: glyph-exercise -->
```postscript
%!PS
% A note-naming worksheet drawn straight from the glyphs (612x792 points).
(lib/sheet.ps) run                 % the glyphs alone: (lib/sm_engrave.ps) run
/sm-sp 8 def                       % staff space in points: every glyph scales with it
% Your own names: any prefix but sm- (that one belongs to the library).
/ex-y 0 def                        % centre line of the current staff
/ex-y-of { 2 div sm-sp mul ex-y add } def      % pos (staff steps from the centre line) -> y
% x pos ex-stem : stem up for notes below the centre line, down from it
/ex-stem {
  /ex-p exch def /ex-x exch def
  ex-p 0 lt
  { ex-x 0.53 sm-sp mul add  ex-p 2 div 0.18 add sm-sp mul ex-y add  ex-p 2 div 3.5 add sm-sp mul ex-y add }
  { ex-x 0.53 sm-sp mul sub  ex-p 2 div 0.18 sub sm-sp mul ex-y add  ex-p 2 div 3.5 sub sm-sp mul ex-y add }
  ifelse sm-stem
} def
% x pos ex-ledgers : ledger lines below (pos <= -6) or above (pos >= 6) the staff
/ex-ledgers {
  /ex-lp exch def /ex-lx exch def
  -6 -2 ex-lp { ex-lx 1.05 sm-sp mul sub ex-lx 1.05 sm-sp mul add 3 -1 roll ex-y-of sm-ledger } for
  6 2 ex-lp { ex-lx 1.05 sm-sp mul sub ex-lx 1.05 sm-sp mul add 3 -1 roll ex-y-of sm-ledger } for
} def
% x pos ex-quarter / ex-half
/ex-quarter { 2 copy ex-ledgers 2 copy ex-y-of sm-head-black ex-stem } def
/ex-half    { 2 copy ex-ledgers 2 copy ex-y-of sm-head-half ex-stem } def
% x ex-bar : a bar line through the current staff
/ex-bar { ex-y 2 sm-sp mul sub ex-y 2 sm-sp mul add sm-bar-thin } def

306 740 (Name the notes) /Times-Bold 20 sm-text-c
306 718 (Write each letter on the line under its note.) /Times-Italic 11 sm-text-c

% ---- staff 1: treble clef, 4/4, the C major scale in quarter notes
/ex-y 640 def
60 ex-y 492 sm-staff
66 ex-y sm-sp sub sm-clef-treble   % origin: the G line, one space below the centre
104 ex-y (4) (4) sm-timesig
[-6 -5 -4 -3 -2 -1 0 1] { } forall % C4 .. C5 as staff positions
8 -1 1 { /ex-i exch def /ex-pp exch def
  ex-i 1 sub 52 mul 140 add ex-i 4 gt { 20 add } if   % x: 52 points apart, a gap after the bar
  dup ex-pp ex-quarter
  2 sm-sp mul sub ex-y 6 sm-sp mul sub moveto 4 sm-sp mul 0 rlineto 0.6 setlinewidth stroke
} for
350 ex-bar
551 ex-y 2 sm-sp mul sub ex-y 2 sm-sp mul add sm-bar-thick
545 ex-y 2 sm-sp mul sub ex-y 2 sm-sp mul add sm-bar-thin

% ---- staff 2: accidentals, a dotted half, beamed eighths, a rest
/ex-y 520 def
60 ex-y 492 sm-staff
66 ex-y sm-sp sub sm-clef-treble
104 ex-y sm-ts-common
% a sharp before F (pos -3), a flat before B (pos 0)
150 -3 ex-quarter  150 1.6 sm-sp mul sub -3 ex-y-of sm-acc-sharp
200  0 ex-quarter  200 1.5 sm-sp mul sub  0 ex-y-of sm-acc-flat
250 -2 ex-half     250 1.2 sm-sp mul add -1 ex-y-of sm-dot
330 ex-bar
% four beamed eighths, stems up: heads, stems to one tip line, then the beam
/ex-tip ex-y 2 sm-sp mul add def
[ 360 -4  392 -3  424 -2  456 -1 ] aload pop
4 { /ex-p exch def /ex-x exch def
  ex-x ex-p ex-y-of sm-head-black
  ex-x 0.53 sm-sp mul add ex-p 2 div 0.18 add sm-sp mul ex-y add ex-tip sm-stem
} repeat
360 0.53 sm-sp mul add ex-tip 456 0.53 sm-sp mul add ex-tip 1 sm-beam
500 ex-y sm-rest-quarter
551 ex-y 2 sm-sp mul sub ex-y 2 sm-sp mul add sm-bar-thick
545 ex-y 2 sm-sp mul sub ex-y 2 sm-sp mul add sm-bar-thin
150 ex-y 7 sm-sp mul sub (F sharp) /Times-Roman 10 sm-text-c
200 ex-y 7 sm-sp mul sub (B flat) /Times-Roman 10 sm-text-c
showpage
```

Tips:

- Work in staff positions and convert once (`ex-y-of` above); that keeps
  ledger lines, dots (odd positions) and stem directions simple.
- Look at the result at `--dpi 300` and crop: 1-pixel stems and ledger lines
  vanish in a downscaled preview.
- To mix drawn notation with an engraved tune on one page, draw first and
  engrave a tune on its own page; `sm-abc-engrave` always ends pages with
  `showpage`.

## Index of public names

Generated from `lib/*.ps`: every name defined at the start of a line, less the
private prefixes `sm-ae-` (layout), `sm-abcp-` (ABC parser), `sm-mxp-`
(MusicXML parser), `sm-rb-` (ribbon), `sm-sh-` (`sheet.ps`), `sm-tr-`
(transposition) and `sm-pf-` (performance).

<!-- ps-api:index:begin (generated by node scripts/ps-api.mjs --write; do not edit) -->

| Name | Kind | Defined in | Source comment |
|---|---|---|---|
| `sm-sheet-version` | value | [lib/sheet.ps](../lib/sheet.ps#L60) |  |
| `sm-sheet-dict` | value | [lib/sheet.ps](../lib/sheet.ps#L61) |  |
| `sm-lib-dir` | value | [lib/sheet.ps](../lib/sheet.ps#L77) |  |
| `sm-abc-here` | proc | [lib/sheet.ps](../lib/sheet.ps#L245) |  |
| `sm-abc-engrave-here` | proc | [lib/sheet.ps](../lib/sheet.ps#L249) | [options] sm-abc-engrave-here - |
| `sm-abc-list-string` | proc | [lib/sheet.ps](../lib/sheet.ps#L253) |  |
| `sm-abc-list-file` | proc | [lib/sheet.ps](../lib/sheet.ps#L254) |  |
| `sm-abc-check-string` | proc | [lib/sheet.ps](../lib/sheet.ps#L255) |  |
| `sm-abc-check-file` | proc | [lib/sheet.ps](../lib/sheet.ps#L256) |  |
| `sm-musicxml-here` | proc | [lib/sheet.ps](../lib/sheet.ps#L259) | sm-musicxml-here (text): as sm-abc-here, up to a line %%SM-ABC-END or EOF |
| `sm-musicxml-engrave-here` | proc | [lib/sheet.ps](../lib/sheet.ps#L261) | [options] sm-musicxml-engrave-here - |
| `sm-musicxml-check-string` | proc | [lib/sheet.ps](../lib/sheet.ps#L265) |  |
| `sm-musicxml-check-file` | proc | [lib/sheet.ps](../lib/sheet.ps#L266) |  |
| `sm-r2` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L63) |  |
| `sm-abc-engrave` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L1606) |  |
| `sm-abc-readsrc` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L1621) | file (marker) sm-abc-readsrc (text): lines up to one equal to marker (or EOF) |
| `sm-abc-print-warnings` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L1638) |  |
| `sm-abc-engrave-string` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L1645) |  |
| `sm-abc-engrave-file` | proc | [lib/sm_abc.ps](../lib/sm_abc.ps#L1682) |  |
| `sm-abc-warnings` | value | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1404) |  |
| `sm-abc-parse-all` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1405) |  |
| `sm-abc-parse` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1406) |  |
| `sm-abc-parse-file-all` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1407) |  |
| `sm-abc-parse-file` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1408) |  |
| `sm-abc-json` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1409) |  |
| `sm-abc-annotations` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1410) |  |
| `sm-abc-tune-transpose` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1411) |  |
| `sm-score-meta-dict` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1413) | (text) [options] sm-score-meta-dict dict : what sm-score-meta prints, as a dictionary |
| `sm-score-meta` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1415) | (text) [options] sm-score-meta - : print the score's metadata as one JSON line |
| `sm-score-meta-file` | proc | [lib/sm_abc_parse.ps](../lib/sm_abc_parse.ps#L1417) | (path) [options] sm-score-meta-file - : the same for a file |
| `sm-sp` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L18) |  |
| `sm-ink` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L19) |  |
| `sm-mtx` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L22) |  |
| `sm-at` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L24) | x y sm-at -  : gsave, move origin to (x,y) and scale to staff spaces |
| `sm-disc` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L26) | x y r sm-disc -  : filled circle |
| `sm-ellipse` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L28) | cx cy a b angle sm-ellipse -  : append an ellipse to the current path |
| `sm-nib` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L37) | w angle squash sm-nib -  : stroke the current path with that pen |
| `sm-ribbon` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L52) |  |
| `sm-staff` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L101) | x y w sm-staff - : five lines, y is the centre line, w in points |
| `sm-ledger` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L110) | x1 x2 y sm-ledger - : one ledger line at height y (points) |
| `sm-bar-thin` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L115) | Thin barline from y1 to y2 at x.  x y1 y2 sm-bar-thin |
| `sm-bar-thick` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L119) |  |
| `sm-repeat-dots` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L124) | x y sm-repeat-dots - : the two dots of a repeat sign, y = staff centre |
| `sm-head-black` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L131) |  |
| `sm-head-half` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L134) |  |
| `sm-head-whole` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L138) |  |
| `sm-head-breve` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L142) |  |
| `sm-head-x` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L149) | Small x for percussion / unpitched: x y sm-head-x |
| `sm-dot` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L154) | augmentation dot: x y sm-dot |
| `sm-stem` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L158) | x y1 y2 sm-stem - (points) |
| `sm-flag-up-path` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L163) |  |
| `sm-flags` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L170) | x y n up sm-flags - : n flags at the stem tip (x,y). up is a boolean. |
| `sm-beam` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L182) |  |
| `sm-rest-whole` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L194) | x y sm-rest-whole : y = staff centre; hangs from the line above the centre |
| `sm-rest-half` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L195) |  |
| `sm-rest-quarter` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L196) |  |
| `sm-rest-hook` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L207) |  |
| `sm-rest-flagged` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L214) | x y n sm-rest-flagged : n = 1 (eighth), 2 (16th), 3 (32nd); y = staff centre |
| `sm-acc-sharp` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L228) |  |
| `sm-acc-flat` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L236) |  |
| `sm-acc-natural` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L248) |  |
| `sm-acc-dsharp` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L256) |  |
| `sm-acc-dflat` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L262) |  |
| `sm-clef-treble-knots` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L272) |  |
| `sm-clef-treble` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L301) |  |
| `sm-clef-treble8` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L307) |  |
| `sm-clef-bass` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L313) |  |
| `sm-clef-alto` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L329) |  |
| `sm-tsfont` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L348) |  |
| `sm-ts-digits` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L351) |  |
| `sm-timesig` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L357) | x y (num) (den) sm-timesig : y = staff centre |
| `sm-ts-c-path` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L363) |  |
| `sm-ts-common` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L370) |  |
| `sm-ts-cut` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L374) |  |
| `sm-tie` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L383) | x1 y1 x2 y2 h sm-tie - |
| `sm-art-staccato` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L400) | x y sm-art-staccato etc. (y = where the mark's centre goes) |
| `sm-art-tenuto` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L401) |  |
| `sm-art-accent` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L402) |  |
| `sm-art-marcato` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L406) |  |
| `sm-art-fermata` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L410) | x y up sm-art-fermata : up = true for above the staff |
| `sm-art-trill` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L416) |  |
| `sm-art-roll` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L421) |  |
| `sm-art-upbow` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L425) |  |
| `sm-art-downbow` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L428) |  |
| `sm-art-segno` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L432) |  |
| `sm-art-coda` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L437) |  |
| `sm-art-breath` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L441) |  |
| `sm-compose` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L452) |  |
| `sm-tw` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L459) |  |
| `sm-show` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L464) |  |
| `sm-setf` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L470) |  |
| `sm-text-l` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L471) |  |
| `sm-text-c` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L472) |  |
| `sm-text-r` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L473) |  |
| `sm-lyric-font` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L475) |  |
| `sm-lyric-size` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L476) |  |
| `sm-lyric` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L477) |  |
| `sm-lyric-hyphen` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L480) |  |
| `sm-lyric-extend` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L486) | Melisma extender line: x1 x2 y sm-lyric-extend |
| `sm-brace` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L492) | x ytop ybot sm-brace : curly brace whose right edge is at x |
| `sm-bracket` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L508) | x ytop ybot sm-bracket : square bracket with hooks, left of x |
| `sm-volta` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L523) |  |
| `sm-tuplet` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L534) | x1 x2 y (n) bracket? up? sm-tuplet  -- y is the bracket line |
| `sm-mmrest` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L550) | Multi-measure rest: x1 x2 y (count) sm-mmrest   (y = staff centre) |
| `sm-chord-font` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L564) |  |
| `sm-chord-size` | value | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L565) |  |
| `sm-chacc` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L566) |  |
| `sm-chordsym` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L575) |  |
| `sm-tempo` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L585) |  |
| `sm-mordent-path` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L606) |  |
| `sm-art-uppermordent` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L609) |  |
| `sm-art-lowermordent` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L610) |  |
| `sm-hairpin` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L615) | Hairpin: x1 x2 y open-at-right? sm-hairpin  (cresc: true; dim: false) |
| `sm-dynamic` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L624) | Dynamics: x y (mf) sm-dynamic  -- left edge at x, baseline at y |
| `sm-grace-slash` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L626) | Slashed grace-note stroke: x y sm-grace-slash (centre of the slash) |
| `sm-annot-text` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L634) | x y t r g b sm-annot-text   -- an italic note, baseline at y |
| `sm-annot-circle` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L638) | x y w h r g b sm-annot-circle   -- an ellipse drawn inside the box |
| `sm-annot-highlight` | proc | [lib/sm_engrave.ps](../lib/sm_engrave.ps#L648) | x y w h r g b sm-annot-highlight   -- a pale box, drawn under the music |
| `sm-musicxml-warnings` | value | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L957) |  |
| `sm-musicxml-error` | value | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L958) |  |
| `sm-musicxml-parse` | proc | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L960) | (xml text) sm-musicxml-parse score |
| `sm-musicxml-parse-file` | proc | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L977) | (path.musicxml) sm-musicxml-parse-file score |
| `sm-musicxml-engrave-string` | proc | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L979) | (xml text) [options] sm-musicxml-engrave-string - |
| `sm-musicxml-engrave-file` | proc | [lib/sm_musicxml.ps](../lib/sm_musicxml.ps#L995) | (path.musicxml) [options] sm-musicxml-engrave-file - |
| `sm-score-performance` | proc | [lib/sm_perform.ps](../lib/sm_perform.ps#L332) |  |
| `sm-abc-performance` | proc | [lib/sm_perform.ps](../lib/sm_perform.ps#L333) |  |
| `sm-abc-performance-file` | proc | [lib/sm_perform.ps](../lib/sm_perform.ps#L338) |  |
| `sm-score-transpose` | proc | [lib/sm_transpose.ps](../lib/sm_transpose.ps#L203) |  |
| `sm-transpose-fifths-shift` | proc | [lib/sm_transpose.ps](../lib/sm_transpose.ps#L204) |  |
| `sm-transpose-pitch` | proc | [lib/sm_transpose.ps](../lib/sm_transpose.ps#L205) |  |
| `sm-transpose-chord` | proc | [lib/sm_transpose.ps](../lib/sm_transpose.ps#L209) |  |

<!-- ps-api:index:end -->
