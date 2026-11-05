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
