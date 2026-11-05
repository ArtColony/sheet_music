---
name: engraver-dev
description: Change or extend this repo's music engraver: the ABC/MusicXML parsers, the layout engine, or the PostScript glyph library lib/sm_engrave.ps. Use when adding notation features, fixing how something is drawn (spacing, beams, stems, ties, lyrics, glyph shapes), adding a sample, or chasing a determinism or pscat problem.
---

# Working on the engraver

## Map

| File | Role |
|---|---|
| `src/abc.js` | ABC text → per-voice measures (tokenizer, lyric alignment) |
| `src/musicxml.js` | MusicXML → per-staff measures (own tiny XML parser: no DOM, runs in Node) |
| `src/score.js` | the shared Score model, keys/clefs, `finalizeScore` (note values, tied splits, tuplets, endings, numbering) |
| `src/frac.js` | exact rational time; never use floats for onsets or durations |
| `src/layout.js` | everything visual: columns and spacing, justification, line/page breaks, stems, beams, chords, accidentals, decorations, lyrics, ties, slurs, PostScript calls |
| `src/ps.js` | `num()` fixed-precision numbers, `text()` PostScript text literals |
| `src/index.js` | `toPostScript()`: document header, prolog (the lib), pages |
| `lib/sm_engrave.ps` | glyph and primitive procedures, all `sm-` prefixed |
| `bin/sheet.mjs` | CLI; `site/editor.html` + `scripts/build-site.mjs`: browser editor and Pages site |

Units in layout: `sp` = staff space in points; `pos` = staff steps from the
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
npm test                                      # units + golden PS hashes + CLI/WASM PDF parity
node scripts/update-golden.mjs                # only after looking at the renders
```

Look at every render you change, at high DPI for glyph work: a 1-px stem is
invisible in a downscaled preview, so "missing" thin lines need a zoomed crop
(or pixel sampling) before you call them a bug.

For a new glyph: draw it in a scratch `.ps` that runs `(lib/sm_engrave.ps) run`,
sets `/sm-sp 12 def`, and puts the glyph on a staff next to existing ones;
render with `--lint`, iterate, then wire it into `layout.js`.
`sm-nib` (stroke under a squashed, rotated matrix) gives broad-pen
thick/thin curves; that is how the clefs, quarter rest and common-time C are drawn.

For a new notation feature: parse it into the Score model (both formats if
it exists in both), handle it in `layout.js` (space in `noteShape`/columns,
height in the vertical-extent pass, drawing in `drawEvent`/`drawDecos` or
the cross-event pass for spanners), add it to `samples/feature-tour.abc`,
add a parser test, update `docs/notation.md` and the goldens.

## pscat

Pinned release, `vendor/pscat/pscat` (CLI) and `vendor/pscat-npm` (WASM).
`pscat --lint-strict` must stay clean (stack leaks, gsave balance). Known
gaps and workarounds are in `docs/FRICTION.md`; new ones go there with a
repro and become a PSCatLabs/pscat issue (search first, `gh issue create -R PSCatLabs/pscat`).
