# pdf/svg: write text as real text (embedded fonts), so PDFs are searchable and accessible

**pscat 0.7.0-rc.4**

`--pdf` (and the browser build's `pdf()`) draws every glyph as an outline
path. The resulting PDFs contain no fonts and no text:

```
$ pscat --pdf out.pdf score.ps && pdftotext out.pdf -
                       # (empty)
$ grep -c /Font out.pdf
0
```

So a sheet-music PDF's title, composer and lyrics cannot be searched,
selected, copied, or read by a screen reader, and SVG pages grow to about
300 KB each (every glyph is a path).

## Suggestion

For the built-in faces (base 35, and font-pack faces whose licences allow
embedding: Liberation, TeX Gyre, URW and Noto are all OFL or LPPL), emit
`show` text as PDF text objects with an embedded (subset) font and a
ToUnicode map, and as `<text>` with an embedded font in SVG. Keep outlines as
an option (`--text-as-paths`) for exact-appearance needs, and keep the
output deterministic, as it is today.

Determinism is the property that matters most to ArtColony/sheet_music: the
CLI and WebAssembly PDFs are byte-identical, and that should stay true with
text objects too.
