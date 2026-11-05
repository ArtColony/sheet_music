# fonts: a definefont copy of a standard font renders and measures as Helvetica (breaks re-encoding)

**pscat 0.7.0-rc.4** (CLI, aarch64-apple-darwin, and the npm WebAssembly build; identical results)

## What happens

Copying a base-35 font dictionary and registering the copy with `definefont`,
the standard Level 1 idiom for re-encoding a font (e.g. to ISOLatin1Encoding
for accented text), gives a font that draws **and measures** as Helvetica.
It happens even when nothing in the copy is changed.

## Repro

```postscript
/reenc { % newname basename -> -
  findfont dup length dict begin
    { 1 index /FID ne { def } { pop pop } ifelse } forall
    /Encoding ISOLatin1Encoding def
  currentdict end definefont pop
} def
/Times-Roman-ISO /Times-Roman reenc
/Copy /Times-Roman findfont definefont pop          % plain copy, no changes

(Times-Roman: ) print /Times-Roman findfont 100 scalefont setfont (Hamburg) stringwidth pop =
(Times-Roman-ISO: ) print /Times-Roman-ISO findfont 100 scalefont setfont (Hamburg) stringwidth pop =
(Copy: ) print /Copy findfont 100 scalefont setfont (Hamburg) stringwidth pop =
(Helvetica: ) print /Helvetica findfont 100 scalefont setfont (Hamburg) stringwidth pop =
```

```
$ pscat --headless repro.ps
Times-Roman: 377.685546875
Times-Roman-ISO: 411.279296875
Copy: 411.279296875
Helvetica: 411.279296875
```

Rendering `(Hamburg) show` with the copies shows sans-serif glyphs. The copy's
`/FontName` still reads `Times-Roman`, so the face is lost somewhere between
`definefont` and glyph lookup.

## Expected

The copy uses the same outlines and metrics as the original, with the new
`/Encoding` applied (Ghostscript, Distiller and printers all do this).

## Why it matters

This is how PostScript programs print accented Latin text with the standard
fonts. Without it, a lyric like "Frère" cannot be set in Times. ArtColony/sheet_music
works around it by composing accented letters from StandardEncoding's accent
glyphs (`\302` acute and so on) laid over the base letter.
