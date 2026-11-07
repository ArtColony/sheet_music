---
name: sheet-music
description: Write a tune or song as ABC notation (or MusicXML) and engrave it to PDF/PNG with this repo's deterministic engraver and pscat. Use when asked to notate, transcribe, arrange, typeset or render sheet music, lead sheets, hymns, folk tunes, piano pieces, or to turn a melody into a PDF score, and when checking or fixing how a score looks.
---

# Writing and rendering sheet music

The pipeline: **ABC or MusicXML → `bin/sheet.mjs` → PostScript → pscat → PDF/PNG.**
ABC is the authoring format: compact, plain text, and what you should write
unless the user hands you MusicXML.

**No Node, only pscat?** Use the `ps-sheet-music` skill: the same engraver
in PostScript, `(lib/sheet.ps) run (tune.abc) sm-abc-engrave-file` with the
pscat CLI or MCP tools, plus `sm-abc-check-file` to list warnings and bars
that do not add up (docs/postscript-api.md).

## Setup (once)

```sh
npm run pscat:fetch        # pinned pscat CLI + WebAssembly into vendor/ (SHA-256 checked)
```

## The loop: write, render, look, fix

1. Write the tune to a `.abc` file (template below).
2. Render a PNG and **look at it** (Read the image). Warnings print on stderr. Fix every one:
   ```sh
   node bin/sheet.mjs tune.abc -o renders/tune.png --dpi 110
   ```
   For small details (accidentals, ties, lyric hyphens), render at `--dpi 300`
   and crop: thin lines disappear in a downscaled preview.
3. Check against the music: count beats per bar, the key signature, the
   pickup, ties, endings, and that each lyric syllable sits under its note.
4. When it is right, write the PDF:
   ```sh
   node bin/sheet.mjs tune.abc -o tune.pdf            # Letter; --paper a4
   ```
   `-o tune.ps` gives the PostScript; `--engine wasm` renders through pscat's
   WebAssembly build (same PDF bytes).

## Template

```abc
X:1
T:Title
T:Subtitle (optional)
C:Composer or "Traditional"
O:Words: Lyricist (year)
S:Where the music comes from
Z:Transcribed by ..., licence
M:3/4
L:1/8
Q:1/4=96
K:G
D2 | "G"G4 B2 | "D7"A4 F2 | "G"G6 |]
w: A-maz-ing grace!
```

The header ends at `K:`. Each body line becomes one line of music (a system),
so put 4 bars on a line for songs and 4–8 for dance tunes. Lines too long
for the page are split evenly; `--breaks auto` ignores the source lines and
fills them.

## ABC essentials

| Want | Write |
|---|---|
| middle C up two octaves | `C D E F G A B c d e f g a b c'` (`C,` octave below) |
| sharp / flat / natural | `^F _B =E` (stays for the rest of the bar, as in printed music) |
| lengths (with `L:1/8`) | `A` eighth, `A2` quarter, `A3` dotted quarter, `A4` half, `A8` whole, `A/` sixteenth |
| dotted pairs | `A>B` (= `A3/2 B/2`), `A<B` |
| rests | `z2`; whole-bar rest `Z`; 4 bars rest `Z4` |
| beams | notes written together are beamed: `ABcd efga`; a space breaks the beam |
| chord | `[GBd]4` |
| tie, slur | `A4-A2`, `(ABc)` |
| triplet | `(3ABc` |
| grace | `{g}A`, slashed `{/g}A` |
| chord symbol | `"Am7"A2` (before the note; `"Bb/D"` works) |
| text above / below | `"^Fine"`, `"_rit."` |
| decorations | `.A` staccato, `!fermata!A`, `!trill!A`, `!accent!A`, `~A` roll |
| dynamics, hairpins | `!mf!A`, `!crescendo(!A ... !crescendo)!B` |
| bar lines | `\|`, `\|\|`, `\|]` (final), `\|:` `:\|` repeats, `[1 ... :\|2 ...` endings |
| part label | a `P:Chorus` line in the body |
| lyrics | `w:` line after the music line: `syl-la-ble` hyphenates, `word_` holds over the next note, `*` skips a note, `\|` jumps to the next bar; more `w:` lines are more verses |
| piano / two staves | `%%score {RH LH}` + `V:RH clef=treble` / `V:LH clef=bass` in the header; then alternate `V:RH` and `V:LH` blocks, each block the same bars |
| accented text | type it directly (é) or `\'e` |
| reader's marks | `%%annotation page=1 type=text x=120 y=540 color=red text="breathe"` (also `type=circle`/`highlight` with `w= h=`; points from the page's lower left. To place one, render to `.ps` and read the coordinates of nearby calls: `sm-bar-thin` lines give bar x positions and staff top/bottom y, `sm-head-*` give note x y. Marks stay put if paper, size or line breaks change) |

Full table and limits: `docs/notation.md`.

## Pitfalls (each one has bitten before)

- **Decorations, chord symbols and dynamics belong to the note after them.**
  `A2!crescendo)!` attaches to the next note, not `A2`; write `!crescendo)!A2`.
- **Bar lengths must add up** to the meter; a short first bar is a pickup (numbered 0),
  and the last bar should complete it.
- **Lyrics** align to notes, skipping rests and tied-over notes. A melisma
  (one syllable over several notes, e.g. beamed `B/G/`) needs `_` after the
  syllable once per extra note: `ing_`. Count notes and syllables per line.
- **Accidentals carry through the bar**: write `^G` once; a later `G` in the same bar is still sharp and is drawn without a sign.
- **Voices**: every voice block must have the same number of bars, with the same
  endings and repeats, or the staves fall out of step.
- **One voice per staff**: two voices on one staff (`&`) is not supported yet;
  put the second part on its own staff.

## Licensing music

Only notate music that is public domain (old enough that composer and
lyricist died long ago; traditional tunes) or that the user owns or has
rights to. Write your own transcription; don't copy someone else's edition.
Record provenance in `S:` / `Z:`; samples added to this repo also go in
`samples/SOURCES.md` (CC0).

## Transposing, listening, round-tripping

- `--transpose N` (semitones) or a `%%transpose N` line prints the tune in
  another key, respelled with the fewest accidentals, chord symbols included.
  Written pitch for transposing instruments: B♭ clarinet/trumpet `+2`, E♭ alto
  sax `+9`, F horn `+7`; an octave for bass instruments `-12`.
- Check pitches by ear or by numbers: `performanceOf(text, { transpose })`
  from `src/index.js` lists every sounded note (MIDI numbers, exact times,
  repeats played out); `midiFile(perf)` writes a `.mid`.
- PDFs written here carry their source: `node bin/sheet.mjs score.pdf -o
  score.abc` gets it back. Edit that, not a retyped copy.

## Other ways in

- **Editor:** `npm run build && npm run serve`, then open http://localhost:8765/editor.html: live preview, transpose, play, share links, PDF/MIDI download.
- **JavaScript:** `psEngineDoc(text, { paper, tune, transpose })` from `bin/sheet.mjs` (or `selfContainedPS` from `src/psdoc.js`, given the `lib/*.ps` texts) returns `{ ps, size, title, warnings, transposed }`: the self-contained document to render with pscat.
- **MusicXML:** `node bin/sheet.mjs piece.musicxml` (uncompressed, partwise).
- **Headless, PostScript only:** `pscat --pdf tune.pdf --page 612x792 -e
  '(lib/sheet.ps) run (tune.abc) sm-abc-engrave-file'` engraves with no
  JavaScript; `(tune.abc) sm-abc-check-file` prints parse warnings and bars
  off the meter. With the pscat MCP tools, `render_postscript` on a program
  starting `(lib/sheet.ps) run` does the same. See the `ps-sheet-music` skill
  and docs/postscript-api.md.
