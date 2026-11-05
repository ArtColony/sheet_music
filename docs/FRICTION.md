# Friction log: building a music engraver on pscat

A running record of what was hard, surprising or missing while building this
project on pscat **0.7.0-rc.4** (the release pinned in `.pscat-version`).
Each entry says what happened, what we did about it, and whether it went
upstream as an issue on [PSCatLabs/pscat](https://github.com/PSCatLabs/pscat/issues).
Drafts of the filed issues live in [`docs/issues/`](issues/).

Severity: **high** = blocked or forced a design change; **medium** = cost real
time or a workaround; **low** = papercut.

| # | Area | Severity | Summary | Upstream |
|---|------|----------|---------|----------|
| 1 | fonts | high | A `definefont` copy of a base-35 font (the standard re-encoding idiom: copy the dict, set `/Encoding ISOLatin1Encoding`, `definefont`) silently renders, and measures, as **Helvetica**. Same in the CLI and WASM. | [draft](issues/01-definefont-copy-falls-back-to-helvetica.md) |
| 2 | fonts | medium | No way to show a non-ASCII character with a base-35 font: no re-encoding (see #1), UTF-8 bytes print as StandardEncoding glyphs, and `glyphshow` is undefined. Workaround: `sm-show` composes accented letters from StandardEncoding's accent glyphs (`\302` acute etc.). | [draft](issues/02-glyphshow-and-latin1-text.md) |
| 3 | fonts | medium | The CLI cannot load an arbitrary OFL font file (only curated packs via `pscat fonts install`); the browser build can (`addFont`). A SMuFL music font (Bravura, OFL) would give engraving-quality glyphs, but it could only work in the browser, breaking CLI/WASM parity. We draw every glyph procedurally instead (`lib/sm_engrave.ps`). | [draft](issues/03-cli-load-font-file.md) |
| 4 | npm / browser | medium | The npm package is three ES modules that find `pscat.wasm` via `import.meta.url`, and the release candidate is not on npm, so no CDN serves it; release assets have no CORS headers. A one-page editor needed a Blob-URL module loader (as PSCatLabs/print-shop also wrote) and a gzip+base64 inlined wasm for the offline edition. | [draft](issues/04-single-file-browser-bundle.md) |
| 5 | pdf / svg | medium | PDF and SVG output draw text as outlines: no `/Font`, `pdftotext` returns nothing, so titles and lyrics are not searchable or accessible, and SVG pages are ~300 KB. | [draft](issues/05-pdf-text-as-text.md) |
| 6 | cli | low | `--png` names pages `NAME-001.png`, `NAME-002.png` … for a multi-page document but `NAME.png` for one page, so a caller must know the page count to find the files (`scripts/build-site.mjs` does). | not filed |
| 7 | tooling | low | The session's pscat MCP plugin was at 0.7.0-rc.1 while the latest release was rc.4, so its quick renders can differ from the pinned CLI. This project pins rc.4 in `pscat.lock.json`, and `.mcp.json` points at the vendored `pscat-mcp`. | not filed |
| 8 | cli | low | `pscat --png out/x.png` fails if `out/` does not exist (`No such file or directory`); scripts must `mkdir -p` first. Ordinary for a CLI, noted for completeness. | not filed |

## What worked well

- **Determinism held everywhere.** Repeated renders give byte-identical PDFs,
  and the WebAssembly build writes exactly the CLI's bytes for every sample;
  `tests/render.test.mjs` checks both on each run.
- **Broad-nib strokes.** Stroking a path under a squashed, rotated CTM (Level 1
  semantics) gives proper thick/thin pen curves; the treble and bass clefs,
  quarter rest and common-time C are drawn that way, identically in both builds.
- **`--lint-strict`** caught stack leaks in the glyph library during
  development (a test fixture passing the wrong argument count).
- **`pscat sheet`** makes a one-command contact sheet of every sample
  (`scripts/render-samples.mjs`).
- **Speed:** a full page renders in ~10–30 ms in WebAssembly, fast enough to
  re-engrave on every keystroke.
