# fonts: let the CLI load a font file (TTF/OTF) the way the browser build's addFont does

**pscat 0.7.0-rc.4**

The WebAssembly build can register any TrueType/OpenType font with
`renderer.addFont(name, bytes)`. The command-line tool can use only the
curated font packs (`pscat fonts install`) and the built-in base 35, so a
program that needs a specific OFL font can render in the browser but not on
the command line, or vice versa.

## Use case

Music engraving: the standard SMuFL music font, Bravura (SIL OFL), has
engraver-drawn clefs, noteheads, rests and so on. With it, an engraver would
look like LilyPond or MuseScore output. ArtColony/sheet_music wants
byte-identical output from the CLI and the browser, so it can only use fonts
that both have. It therefore draws every music glyph procedurally in
PostScript instead.

## Suggestion

A flag such as `--font NAME=path/to/font.otf` (repeatable; it could go
through `--read-root` for confinement), or a PostScript-level resource
operator for a font file inside the read roots, matching `addFont`'s naming
so the same program renders the same in both builds.

Related: #617 (font packs in the browser build).
