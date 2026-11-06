# sheet_music

Deterministic sheet-music engraving with [pscat](https://github.com/PSCatLabs/pscat).
Write a tune in **ABC notation** (or bring **MusicXML**), get an engraved score as
**PDF**, from the command line or in a one-page browser editor. Part of
[ArtColony](https://github.com/ArtColony).

**Site:** <https://artcolony.github.io/sheet_music/>: [gallery](https://artcolony.github.io/sheet_music/#gallery),
[editor](https://artcolony.github.io/sheet_music/editor.html),
[pscat notes](https://artcolony.github.io/sheet_music/friction.html).

```
ABC / MusicXML ──parse──▶ score model ──layout──▶ PostScript ──pscat──▶ PDF · PNG · SVG
 src/abc.js                src/score.js   src/layout.js   lib/sm_engrave.ps   CLI or WebAssembly
 src/musicxml.js
```

- **Deterministic.** Durations are exact rationals; every coordinate is written
  with fixed precision, with no locale or clock involved. The same input gives
  the same PostScript bytes (`npm test` holds golden hashes; the editor's
  output was checked against them in Chrome), and pscat turns it into the same
  PDF bytes through the command-line tool or its WebAssembly build
  (`npm test` checks that parity and run-to-run reproducibility on every sample).
- **No music font.** Clefs, noteheads, rests, accidentals, flags, ties and the brace
  are PostScript paths in [`lib/sm_engrave.ps`](lib/sm_engrave.ps). Text uses
  only the PostScript standard 35 fonts that every pscat build has.
- **No dependencies.** Plain ES modules, Node 22+, and the pinned pscat release.

## Quick start

```sh
npm run pscat:fetch                      # pscat 0.7.0-rc.4 into vendor/, SHA-256 checked
node bin/sheet.mjs samples/amazing-grace.abc            # -> samples/amazing-grace.pdf
node bin/sheet.mjs my-tune.abc -o out/my-tune.pdf --paper a4
node bin/sheet.mjs my-tune.abc -o my-tune.png --dpi 150 # page PNGs
node bin/sheet.mjs my-tune.abc -o my-tune.ps            # just the PostScript
node bin/sheet.mjs song.musicxml --engine wasm -o song.pdf  # same PDF, via WebAssembly
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
import { toPostScript } from './src/index.js';
const lib = fs.readFileSync('lib/sm_engrave.ps', 'utf8');
const { ps, pages, size, warnings } = toPostScript(abcText, { lib, paper: 'a4' });
// then: pscat --pdf out.pdf file.ps, or createRenderer().render(ps, { pdf: true })
```

### The PostScript engraver (`--engine ps`)

`node bin/sheet.mjs song.abc --engine ps -o song.ps` writes a **self-contained
PostScript file**: the glyph library, [`lib/sm_abc.ps`](lib/sm_abc.ps) (layout
in PostScript), a short driver and the ABC source itself, verbatim after
`currentfile`. pscat lays the music out and draws it; no JavaScript is involved
in the page. `-o song.pdf` / `.png` / `.svg` render it with the pscat CLI,
`--engine ps-wasm` with the WebAssembly build (byte-identical PDFs; every drawn
position is rounded to two decimals with `sm-r2`, and the layout uses no
transcendental operators). Until `lib/sm_abc_parse.ps` exists the driver
engraves the Score that the JS parser wrote into the file (`psLiteral`); once
`sm-abc-parse` is defined it parses the embedded ABC instead.

From PostScript, by hand: `score sm-abc-engrave`, or `score << /paper /a4
/staff-space 6 /breaks (auto) >> sm-abc-engrave`; with the parser loaded,
`(song.abc) sm-abc-engrave-file`. See the header of `lib/sm_abc.ps`.

It covers the title block, tempo, clefs, key and time signatures (also
mid-line changes), proportional spacing, line and page breaks, stems, flags,
beams, chords, accidentals, ledger lines, dots, rests, multi-measure rests, bar
lines, repeats, voltas, chord symbols, lyrics with hyphens and extenders, ties,
several staves with a brace or bracket, and the footer. Slurs, tuplets, grace
notes, decorations, dynamics, hairpins and `%%annotation` marks are still JS
only. Transposition, playback/MIDI, share links and the editor's live preview
stay on the JS engraver, which remains the reference.

## The editor

[`site/editor.html`](site/editor.html) is built into one HTML file
(`dist/editor.html`) that inlines the engraver, the glyph library, the samples
and pscat's JavaScript glue, and loads `pscat.wasm` from beside it. It renders
as you type, shows parse warnings and PostScript errors, and downloads the
source, a MIDI file or a PDF. **View PS** opens the PostScript the score
became in a scrolling window: the score part is nothing but calls into the
glyph library (`x y sm-head-black`, `x y1 y2 sm-stem` …), and clicking any
`sm-` name jumps to its definition. The gallery's *View PostScript* links
open the same window ([`site/ps-viewer.js`](site/ps-viewer.js)). **Transpose** moves the score up
or down (respelled in the new key, chord symbols too). **Play** plays it in the
browser, with repeats, endings and ties (space bar). **Share link** copies a
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
npm test                    # parser units, golden hashes, CLI/WASM PDF parity
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
