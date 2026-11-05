# docs/cli: mention the fonts/catalog drop-in for your own font files in --help and `pscat fonts help`

**pscat 0.7.0-rc.4**

The command-line tool can use any TrueType/OpenType file: put it in a
`fonts/catalog/<anything>/` directory (in the current directory,
`$PSCAT_HOME`, the per-user data directory or beside the binary) and
`/<FileStem> findfont` finds it. That is the CLI's counterpart of the browser
build's `renderer.addFont(name, bytes)`.

It works:

```sh
mkdir -p fonts/catalog/mine && cp SomeFont.ttf fonts/catalog/mine/SomeFont.ttf
pscat -e '/SomeFont findfont 24 scalefont setfont 72 72 moveto (works) show'
```

But it is documented only in one paragraph of `docs/guides/fonts.md`. It
isn't in `pscat --help`, `pscat fonts help`, the npm README's "Libraries and
fonts" section (which explains `addFont` for the browser), or the agent
skills. `pscat fonts help` says packs are installed with `pscat fonts install`
and stops there.

While building ArtColony/sheet_music (an engraver that needs identical
output from the CLI and the browser), I read all of those and concluded the
CLI could not load a font file, then found the drop-in while writing this
issue. With it, a SMuFL music font such as Bravura (OFL) would work in both
builds: `fonts/catalog/` for the CLI, `addFont` in the browser.

## Suggestion

- One line in `pscat fonts help` and in `--help` near `--fonts`: "your own
  fonts: drop .ttf/.otf files into fonts/catalog/<dir>/ (cwd, $PSCAT_HOME, ...);
  /FileStem findfont finds them".
- In the npm README, next to `addFont`: "the CLI equivalent is a
  fonts/catalog/ directory", so cross-build parity is easy to set up.
- Maybe have `pscat --fonts` print the catalog directories it searched.
