---
name: engraver-dev
description: Change or extend this repo's music engraver: the ABC/MusicXML parsers (lib/sm_abc_parse.ps, lib/sm_musicxml.ps), the PostScript layout lib/sm_abc.ps, or the PostScript glyph library lib/sm_engrave.ps. Use when adding notation features, fixing how something is drawn (spacing, beams, stems, ties, lyrics, glyph shapes), adding a sample, or chasing a determinism or pscat problem.
---

# Working on the engraver

## Map

| File | Role |
|---|---|
| `lib/sm_abc.ps` | everything visual: columns and spacing, justification, line/page breaks, stems, beams, chords, accidentals, decorations, lyrics, ties, slurs, annotations (names `sm-ae-`) |
| `lib/sm_abc_parse.ps`, `lib/sm_musicxml.ps` | the parsers: ABC and MusicXML → the Score (model: `docs/postscript-api.md`, "The Score"), also `sm-score-meta` (title, tunes, annotations, warnings as JSON) |
| `lib/sm_transpose.ps`, `lib/sm_perform.ps` | transposition; the notes as played (JSON events) |
| `tests/fixtures/reference/` | what the retired JS parsers, `scoreMeta`, `performance()` and `transposeScore` gave (#10): the PostScript is tested against it |
| `src/frac.js` | exact rational time (MIDI ticks from PostScript's `[num den]` times) |
| `src/ps.js` | `num()` fixed-precision numbers, `text()` PostScript text literals, `psLiteral()` (any value as PostScript: the options dict) |
| `src/psdoc.js` | `selfContainedPS()`: DSC header, the libs, a driver and the source (what `sheet` writes); `metaPS()`/`readMeta()` for `sm-score-meta` |
| `src/play.js`, `src/index.js` | MIDI from PostScript's events, PDF source attachment, annotation lines; no parser |
| `lib/sm_engrave.ps` | glyph and primitive procedures, all `sm-` prefixed |
| `bin/sheet.mjs` | CLI; `site/editor.html` + `scripts/build-site.mjs`: browser editor and Pages site |

Units in the layout: `sp` = staff space in points; `pos` = staff steps from the
centre line (y = centre + pos·sp/2). Glyphs draw in staff spaces via `sm-at`.

## Rules

1. **Deterministic or it is a bug.** No `Date`, `Math.random`, `Intl`,
   `toLocaleString`, `localeCompare`; iterate arrays, not object key sets
   built from untrusted order; numbers to PostScript only via `num()`.
2. **Same code in Node and the browser.** `src/` stays dependency-free ES
   modules. The editor loads them from Blob URLs; a quoted relative `import`
   inside a comment is fine (the loader only rewrites specifiers it bundles).
3. **PostScript has no locals.** New temporaries get a unique `sm-` name;
   reusing a procedure's name as a temporary silently replaces the procedure
   (this happened with `sm-tw`).
4. **Fonts:** only the standard 35. Text goes through `sm-text-*` / `sm-show`
   with literals from `text()`: accented letters are composed from accent
   glyphs because pscat cannot re-encode a font (docs/FRICTION.md #1).
5. **A decoration, chord symbol or dynamic in ABC applies to the next note.**

## Loop

```sh
node scripts/render-samples.mjs              # renders/*.png and renders/contact-sheet.png
node scripts/render-samples.mjs samples/feature-tour.abc
vendor/pscat/pscat --png renders/x.png --dpi 300 renders/feature-tour.ps   # zoom, then crop with PIL
npm test                                      # units + golden PS/PDF hashes + CLI/WASM PDF parity
node scripts/update-golden.mjs                # only after looking at the renders
```

Look at every render you change, at high DPI for glyph work: a 1-px stem is
invisible in a downscaled preview, so "missing" thin lines need a zoomed crop
(or pixel sampling) before you call them a bug.

For a new glyph: draw it in a scratch `.ps` that runs `(lib/sm_engrave.ps) run`,
sets `/sm-sp 12 def`, and puts the glyph on a staff next to existing ones;
render with `--lint`, iterate, then wire it into `lib/sm_abc.ps`.
`sm-nib` (stroke under a squashed, rotated matrix) gives broad-pen
thick/thin curves; that is how the clefs, quarter rest and common-time C are drawn.

The PostScript library is the only engraver: `src/layout.js` and the JS
parsers (`src/abc.js`, `src/musicxml.js`) were retired in #10, so a parser
or layout change lands once, in PostScript. `tests/ps-engine.test.mjs` pins every sample's and
fixture's document and PDF by hash (`tests/golden.json`), so any change to
the pages shows up there; look at the renders, then update the goldens.

For a new notation feature: parse it into the Score model (both formats if
it exists in both: `lib/sm_abc_parse.ps` / `lib/sm_musicxml.ps`; document a
new field in `docs/postscript-api.md`), handle it in `lib/sm_abc.ps` (space in the column pass, height in the
vertical-extent pass, drawing in `sm-ae-drawevent`/`sm-ae-drawdecos`, or
the cross-event pass for spanners), add it to `samples/feature-tour.abc`,
add a parser test (`tests/abc.test.mjs` asserts fields of PostScript's Score),
update `docs/notation.md` and the goldens. A sample's Score then differs from
the frozen JS reference in `tests/fixtures/reference/`: the references cannot
be regenerated (the JS is gone), so change the comparison to expect the new
field (or test the new sample on its own) and say so in the commit.

## pscat

Pinned release, `vendor/pscat/pscat` (CLI) and `vendor/pscat-npm` (WASM).
`pscat --lint-strict` must stay clean (stack leaks, gsave balance). Known
gaps and workarounds are in `docs/FRICTION.md`; new ones go there with a
repro and become a PSCatLabs/pscat issue (search first, `gh issue create -R PSCatLabs/pscat`).
