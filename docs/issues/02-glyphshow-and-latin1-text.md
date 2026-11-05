# fonts: no way to show non-ASCII text in the standard fonts (glyphshow undefined, no Latin-1 path)

**pscat 0.7.0-rc.4**

With the base-35 fonts, a program has no working way to draw `é`, `ñ`, `ü`
and friends:

1. Re-encoding to `ISOLatin1Encoding` falls back to Helvetica (see the
   definefont issue).
2. `glyphshow` (Level 2) is undefined:
   ```
   $ pscat -e '/Times-Roman findfont 20 scalefont setfont 72 72 moveto /eacute glyphshow'
   %%[ Error: undefined; OffendingCommand: glyphshow; Line: 1 ]%%
   ```
3. UTF-8 bytes in a string are read as StandardEncoding codes: `(Café) show`
   with UTF-8 source prints `Cafˆ'` (bytes 0xC3 0xA9 are `circumflex` and
   `quotesingle`). That is correct for the encoding, but Latin faces get no
   UTF-8 mode like the Korean, Japanese and Thai faces have.

## Suggestion

Any one of these would do:
- fix the re-encoding fallback (the standard, portable route);
- implement `glyphshow` for the built-in faces, so `/eacute glyphshow` works;
- a documented opt-in that reads UTF-8 for Latin faces too (as the Korean,
  Japanese and Thai faces already do).

## Workaround in use

ArtColony/sheet_music's `sm-show` takes an array of plain strings and
`[(e) (\302) raise]` triples, and draws the accent glyph centred over the base
letter, which covers Latin-1 and Latin Extended-A. It works, but every
PostScript text user would have to reinvent it.
