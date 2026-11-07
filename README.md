# sheet_music

Deterministic sheet-music engraving with [pscat](https://github.com/PSCatLabs/pscat).
Write a tune in **ABC notation** (or bring **MusicXML**), get an engraved score as
**PDF**, from the command line or in a one-page browser editor. Part of
[ArtColony](https://github.com/ArtColony).

**Site:** <https://artcolony.github.io/sheet_music/>: [gallery](https://artcolony.github.io/sheet_music/#gallery),
[editor](https://artcolony.github.io/sheet_music/editor.html),
[pscat notes](https://artcolony.github.io/sheet_music/friction.html).

```
one .ps file: lib/*.ps + driver + the ABC text ──pscat──▶ parse ▶ layout ▶ draw ──▶ PDF · PNG · SVG
               (or the MusicXML text)                     lib/sm_abc_parse.ps          CLI or WebAssembly
                                                          (sm_musicxml.ps)
                                                          lib/sm_abc.ps, sm_engrave.ps
                                                ──pscat──▶ sm-abc-performance ──▶ JSON note events ──▶ Web Audio / MIDI (src/play.js)
```

The engraver is the PostScript library in [`lib/`](lib/): pscat parses the
ABC or MusicXML, transposes, lays out and draws the score, and works out the
notes it sounds. JavaScript only builds the document, turns those notes into
sound or a MIDI file, and runs the web page. The original JavaScript layout
(`src/layout.js`, `--engine js`) and parsers (`src/abc.js`, `src/musicxml.js`)
were retired once the PostScript ones matched them on every sample (#10);
the tests hold golden hashes of the PostScript engraver's documents and PDFs,
and the retired parsers' results, frozen, for the PostScript parsers to match.

- **Deterministic.** Durations are exact rationals; every coordinate is written
  with fixed precision, with no locale or clock involved. The same input gives
  the same PostScript bytes (`npm test` holds golden hashes; the editor's
  output was checked against them in Chrome), and pscat turns it into the same
  PDF bytes through the command-line tool or its WebAssembly build
  (`npm test` checks that parity and run-to-run reproducibility on every sample).
- **No music font.** Clefs, noteheads, rests, accidentals, flags, ties and the brace
  are PostScript paths in [`lib/sm_engrave.ps`](lib/sm_engrave.ps). Text uses
  only the PostScript standard 35 fonts that every pscat build has.
- **Parsers in PostScript.** [`lib/sm_abc_parse.ps`](lib/sm_abc_parse.ps)
  (`(abc text) sm-abc-parse`, `(file.abc) sm-abc-parse-file`) and
  [`lib/sm_musicxml.ps`](lib/sm_musicxml.ps) (`sm-musicxml-parse`) build the
  Score inside pscat. `tests/ps-parse.test.mjs` and `tests/ps-musicxml.test.mjs`
  check every sample and fixture against what the retired JS parsers built
  (`tests/fixtures/reference/`).
- **No dependencies.** Plain ES modules, Node 22+, and the pinned pscat release.

## Install the plugin (Claude Code, ChatGPT / Codex)

The **sheet-music** plugin gives an agent the PostScript library and a skill
for writing tunes as ABC and engraving them with pscat, headless: no Node
and no checkout of this repo. It **depends on the [pscat plugin](https://github.com/PSCatLabs/pscat)**,
which provides the interpreter and its MCP tools.

**Claude Code.** Add pscat's marketplace first, then this one, then install.
pscat comes in automatically as a dependency:

```sh
claude plugin marketplace add PSCatLabs/pscat
claude plugin marketplace add ArtColony/sheet_music
claude plugin install sheet-music@artcolony      # also installs pscat@pscat
```

In a session, the same steps are `/plugin marketplace add PSCatLabs/pscat`,
`/plugin marketplace add ArtColony/sheet_music` and `/plugin install sheet-music@artcolony`.
If pscat's marketplace was not added first, the install still succeeds, but
`claude plugin list` shows sheet-music as *failed to load: Dependency
"pscat@pscat" is not installed*. Add the marketplace and run
`claude plugin install pscat@pscat`.

**ChatGPT / Codex.** Plugins there cannot declare dependencies, so install
pscat yourself, before sheet-music:

```sh
codex plugin marketplace add PSCatLabs/pscat
codex plugin marketplace add ArtColony/sheet_music
codex plugin add pscat@pscat
codex plugin add sheet-music@artcolony
```

Or, after adding the two marketplaces, run `/plugins` in Codex (or open
**Plugins** in the ChatGPT desktop app) and install **pscat**, then
**Sheet music**. Start a new session afterwards. The skill checks for pscat
first and says how to install it if it is missing.

**Updating:** `claude plugin marketplace update artcolony` or
`codex plugin marketplace upgrade artcolony`.

The plugin lives in [`plugin/`](plugin/), with marketplaces in
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and
[`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json).
See [AGENTS.md](AGENTS.md) for how it is built and tested.

## Quick start

```sh
npm run pscat:fetch                      # pscat 0.7.0-rc.4 into vendor/, SHA-256 checked
node bin/sheet.mjs samples/amazing-grace.abc            # -> samples/amazing-grace.pdf
node bin/sheet.mjs my-tune.abc -o out/my-tune.pdf --paper a4
node bin/sheet.mjs my-tune.abc -o my-tune.png --dpi 150 # page PNGs
node bin/sheet.mjs my-tune.abc -o my-tune.ps            # the self-contained PostScript
node bin/sheet.mjs my-tune.abc -o my-tune.mid           # MIDI, from the notes PostScript plays
node bin/sheet.mjs song.musicxml --engine ps-wasm -o song.pdf  # same PDF, via WebAssembly
```

Options: `--tune N` (files with several `X:` tunes; `--list` shows them),
`--transpose N` (semitones; e.g. `+2` for a B♭ instrument, `+9` alto sax),
`--paper letter|a4`, `--staff-space PT` (default 5.5), `--breaks source|auto`
(keep the input's line breaks, or fill lines), `--footer TEXT`, `--no-source`.

**PDFs carry their source.** Each PDF has the ABC or MusicXML it was engraved
from attached (any PDF reader lists it, marked as the document's source), and
its title, composer and subject in the document info. So a PDF is also an
input: `node bin/sheet.mjs score.pdf -o score.abc` unpacks the source,
`node bin/sheet.mjs score.pdf --transpose 2 -o in-d.pdf` re-engraves it, and
the editor's *Open* reads it back. pscat has no `pdfmark`
([#1032](https://github.com/PSCatLabs/pscat/issues/1032)), so
[`src/pdfmeta.js`](src/pdfmeta.js) appends this as a standard PDF incremental
update; the pages pscat drew are untouched and the output stays deterministic.

From JavaScript:

```js
import { psEngineDoc } from './bin/sheet.mjs';          // reads lib/*.ps from disk
const { ps, size } = psEngineDoc(abcText, { paper: 'a4' });
// then: pscat --pdf out.pdf file.ps, or createRenderer().render(ps, { pdf: true })
// (in a browser: selfContainedPS from src/psdoc.js, given the lib/*.ps texts and
//  meta: readMeta() of what the metaPS() document printed, i.e. sm-score-meta)
```

### The PostScript engraver (the default)

`node bin/sheet.mjs song.abc -o song.ps` writes a **self-contained
PostScript file**: the glyph library, [`lib/sm_abc.ps`](lib/sm_abc.ps) (layout
in PostScript), a short driver and the ABC source itself, verbatim after
`currentfile`. pscat lays the music out and draws it; no JavaScript is involved
in the page. `-o song.pdf` / `.png` / `.svg` render it with the pscat CLI,
`--engine ps-wasm` with the WebAssembly build (byte-identical PDFs; every drawn
position is rounded to two decimals with `sm-r2`, and the layout uses no
transcendental operators). The file also carries
[`lib/sm_abc_parse.ps`](lib/sm_abc_parse.ps), so pscat parses the embedded
ABC too (tune by `--tune`, `%%annotation` marks included), and MusicXML
with [`lib/sm_musicxml.ps`](lib/sm_musicxml.ps). The title, composer and key
for the file's header and the PDF's metadata, the tune list and the warnings
come from a first PostScript run as well (`sm-score-meta`), so `sheet` and
the editor parse nothing in JavaScript.

**With pscat alone** (no Node): `pscat --pdf song.pdf --page 612x792 -e
'(lib/sheet.ps) run (song.abc) sm-abc-engrave-file'`. [`lib/sheet.ps`](lib/sheet.ps)
loads the whole library; `(song.abc) sm-abc-check-file` prints parse
warnings and bars that do not add up, and the ABC can sit in the same `.ps`
file after `sm-abc-engrave-here`. Every procedure, glyphs included, is in
[`docs/postscript-api.md`](docs/postscript-api.md); the `ps-sheet-music` skill
drives it with the pscat CLI or MCP tools.

From PostScript, by hand: `score sm-abc-engrave`, or `score << /paper /a4
/staff-space 6 /breaks (auto) >> sm-abc-engrave`; or straight from the
ABC file, with no JavaScript at all, `(lib/sm_engrave.ps) run (lib/sm_abc.ps)
run (song.abc) sm-abc-engrave-file` (it loads `lib/sm_abc_parse.ps` itself;
`(song.abc) << /tune 1 >> sm-abc-engrave-file` for the second tune). See the header
of `lib/sm_abc.ps`. Transposition runs in PostScript too
([`lib/sm_transpose.ps`](lib/sm_transpose.ps), `score semis sm-score-transpose`):
`--transpose N` and `%%transpose` work, and from PostScript
`(song.abc) << /transpose 2 >> sm-abc-engrave-file` adds to the file's `%%transpose`.

It covers everything the retired JS layout drew: title block, tempo, clefs, key and
time signatures (also mid-line changes), spacing, line and page breaks, stems,
beams, chords, accidentals, ledger lines, dots, rests, multi-measure rests,
bars, repeats, voltas, chord symbols, text annotations, decorations, dynamics,
hairpins, slurs, ties, tuplets, grace notes, lyrics, several staves, the footer
and `%%annotation` marks; every sample's page was pixel-identical to the JS
engraver's (checked at 150 and 600 dpi) when that was retired, and
`tests/ps-engine.test.mjs` pins the PDFs by hash since. Playback reads the notes from PostScript as well:
[`lib/sm_perform.ps`](lib/sm_perform.ps) `sm-abc-performance` prints them as
JSON events (repeats, endings, ties, exact times), and the editor and
`-o song.mid` only turn them into sound or a MIDI file
(`tests/ps-perform.test.mjs`: the same events the retired `src/play.js`
`performance()` gave).

## The editor

[`site/editor.html`](site/editor.html) is built into one HTML file
(`dist/editor.html`) that inlines the PostScript library, the JS modules, the
samples and pscat's JavaScript glue, and loads `pscat.wasm` from beside it. As
you type, it puts the ABC into a self-contained PostScript document, which
pscat's WebAssembly build parses, lays out and draws; it shows the parser's
warnings and PostScript errors, and downloads the source, a MIDI file or a
PDF. **View PS** opens that document in a scrolling window (the library, then
the driver and your ABC), and clicking any `sm-` name jumps to its definition. The gallery's *View PostScript* links
open the same window ([`site/ps-viewer.js`](site/ps-viewer.js)). **Transpose** moves the score up
or down (respelled in the new key, chord symbols too). **Play** plays it in the
browser, with repeats, endings and ties (space bar); the notes come from
PostScript (`sm-abc-performance`), JavaScript only makes the sound. **Share link** copies a
link with the whole score compressed into the part after `#`, so nothing is
uploaded and anyone with the link sees the same score. **Open** (or drop a
file) reads `.abc`, `.musicxml`, or a PDF made here. **Annotate** adds a reader's marks (text
notes, circles, highlights) by clicking or dragging on the score; they are
saved as `%%annotation` lines in the source, so they appear in the PDF and in
`bin/sheet.mjs` output too. `dist/sheet-music-editor-offline.html` also
carries the WebAssembly (gzipped, ~7 MB) and works straight from disk with no
network.

```sh
npm run build && npm run serve           # http://localhost:8765/editor.html
```

## Notation support

ABC 2.1 as used for folk tunes, hymns and simple keyboard music, plus a
MusicXML subset; [`docs/notation.md`](docs/notation.md) has the full table and
what is not supported yet.

## Samples

All in [`samples/`](samples/): public-domain tunes transcribed for this
project and dedicated to the public domain (CC0 1.0); provenance in
[`samples/SOURCES.md`](samples/SOURCES.md).

| | |
|---|---|
| `amazing-grace.abc` | hymn, two verses of lyrics, melismas, pickup |
| `greensleeves.abc` | minor key, accidentals, two strains |
| `drunken-sailor.abc` | Dorian mode, repeats, part labels |
| `ode-to-joy.abc` | piano: two staves with brace, 1st/2nd endings |
| `frere-jacques.musicxml` | MusicXML: lyrics with accents, harmony, round entries |
| `camptown-races.abc` | Stephen Foster (1850), from his 1850 edition: verse and chorus, dotted rhythms |
| `mountain-king.abc` | Grieg's theme set for **bassoon** (for Alex): bass and tenor clef, articulations, example annotations |
| `twinkle.abc` | lyrics and chord symbols |
| `feature-tour.abc` | test piece: tuplets, grace notes, 16ths, dynamics, hairpins, key/meter/clef changes, multi-measure rest |

## Development

```sh
npm test                    # parsers vs. the frozen references, golden hashes, CLI/WASM PDF parity
node scripts/render-samples.mjs   # renders/*.png + renders/contact-sheet.png: look at them
node scripts/update-golden.mjs    # after an intended change to the output
npm run build               # dist/ (the GitHub Pages site)
```

Agent skills for writing and rendering scores, and for working on the
engraver, are in [`.claude/skills/`](.claude/skills/). `CLAUDE.md` has the
project rules.

## pscat

Pinned in `.pscat-version` and `pscat.lock.json` (release assets by SHA-256),
following [PSCatLabs/print-shop](https://github.com/PSCatLabs/print-shop)'s
engine-fetch pattern. What was hard or missing is logged in
[`docs/FRICTION.md`](docs/FRICTION.md), and the issues it led to are filed on
[PSCatLabs/pscat](https://github.com/PSCatLabs/pscat/issues).

## Licence

Code: MIT ([LICENSE](LICENSE)). Samples: CC0 1.0. pscat (fetched, not
vendored in git): MIT or Apache-2.0, with OFL-1.1 / LPPL-1.3c fonts. The
site ships its notices in `engine/`.
