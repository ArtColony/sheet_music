# npm/wasm: ship a single-file browser build (and optionally an inlined-wasm one) for no-build pages

**pscat 0.7.0-rc.4** npm package

The package is three ES modules (`index.js` → `renderer.js` → `core.js`)
that find `pscat.wasm` through `import.meta.url`. That is right for bundlers,
but it makes a **single self-contained HTML page** (an editor someone can
download and open from disk) awkward:

- the release-candidate package is not on npm, so no CDN (unpkg/jsDelivr)
  serves it, and GitHub release assets have no CORS headers, so a page cannot
  `fetch` the wasm from the release either;
- to inline the glue in one HTML file you need either a bundler or a
  hand-written loader that rewrites relative imports to Blob URLs.
  PSCatLabs/print-shop (`scripts/build-offline.mjs`) and ArtColony/sheet_music
  (`site/editor.html`) each wrote one;
- Chrome refuses module workers from `file://`, so print-shop also had to
  strip module syntax into a classic script for its worker.

## Suggestion

Add to the package (and the release assets):
- `pscat.iife.js` / `pscat.global.js`: one classic script defining
  `globalThis.pscat = { createRenderer, PostScriptError }`, usable in a
  `<script>` tag, a classic worker, or inlined;
- optionally a helper or documented recipe for a gzipped, base64-inlined wasm
  (`createRenderer({ wasm: bytes })` already accepts bytes; a small
  `decodeInlineWasm(base64gz)` would save each project the DecompressionStream
  dance).
