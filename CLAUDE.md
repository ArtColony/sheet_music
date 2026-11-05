# sheet_music

ABC / MusicXML → PostScript → PDF, engraved deterministically and rendered by pscat. See `README.md` for the layout and `docs/notation.md` for what is supported.

- Use the released pscat pinned in `.pscat-version` / `pscat.lock.json`, installed by `npm run pscat:fetch` into `vendor/` (never a source checkout, never the plugin cache). `PSCAT=/path/to/pscat` overrides the CLI.
- Determinism is the contract. In `src/`: no `Date`, `Math.random`, `Intl`, `localeCompare` or locale-dependent formatting; time is exact `Frac` arithmetic (`src/frac.js`); every number written to PostScript goes through `num()` (`src/ps.js`). The browser editor runs the same modules, so they must stay dependency-free ES modules that work in Node and browsers.
- Look at what you change. After touching `src/layout.js` or `lib/sm_engrave.ps`, run `node scripts/render-samples.mjs` and look at the PNGs (zoom in with a high `--dpi` crop for small glyphs; thin lines vanish in downscaled previews). Then `npm test`; if the output changed on purpose, `node scripts/update-golden.mjs` and commit `tests/golden.json` with the change.
- `lib/sm_engrave.ps`: every name starts with `sm-` (PostScript has no locals; a temporary sharing a procedure's name clobbers it). Glyphs are drawn in staff-space units via `sm-at`; callers pass points. Text uses only the standard 35 fonts, through `sm-text-*`/`sm-show` (accented letters are composed: pscat cannot re-encode fonts, docs/FRICTION.md #1).
- Samples must be public domain music transcribed here (CC0); add provenance to `samples/SOURCES.md` and the file to `samples/order.json`, then update the goldens.
- When pscat misbehaves or something is missing, add a row to `docs/FRICTION.md` with a minimal repro, draft the issue in `docs/issues/NN-slug.md`, search existing PSCatLabs/pscat issues, and file it with `gh issue create -R PSCatLabs/pscat` (link the URL back in the table).
- `npm run build` writes the Pages site to `dist/`; `.github/workflows/pages.yml` deploys it from `main`.
