# Support `pdfmark` (at least /DOCINFO and /EMBED) in PDF output

**pscat version:** 0.7.0-rc.4 (CLI and WebAssembly, macOS arm64)

## What happened

`pdfmark` is undefined, so a PostScript program cannot set PDF document
info or attach files. The usual Distiller/Ghostscript idiom fails:

```postscript
%!PS
[ /Title (Test) /Subject (X:1 abc) /Keywords (k) /DOCINFO pdfmark
[ /_objdef {f1} /type /stream /OBJ pdfmark
[ {f1} (X:1\nK:C\nCDE|) /PUT pdfmark
[ /Name (tune.abc) /FS << /Type /Filespec /F (tune.abc) /EF << /F {f1} >> >> /EMBED pdfmark
/Helvetica findfont 20 scalefont setfont 72 700 moveto (hi) show showpage
```

```
$ pscat --pdf t.pdf t.ps
%%[ Error: undefined; OffendingCommand: pdfmark; Line: 2 ]%%
```

pscat does copy the DSC `%%Title:` and `%%For:` comments into `/Title`
and `/Author`, which helps. But there is no way to set `/Subject` or
`/Keywords`, to write non-ASCII titles (UTF-16 PDF strings), to attach a
file, or to add links and bookmarks (`/ANN`, `/OUT`).

## Why it matters

[ArtColony/sheet_music](https://github.com/ArtColony/sheet_music) attaches
each score's ABC/MusicXML source to its PDF so the PDF can be opened and
edited again. Without pdfmark it appends a PDF incremental update in
JavaScript after pscat writes the file (`src/pdfmeta.js`). That works and
stays deterministic, but every pscat user who wants metadata has to write
the same post-processing.

## Suggestion

In the PDF device, implement `pdfmark` for `/DOCINFO`, and ideally `/EMBED`
(with `/_objdef`/`/PUT` for the stream), `/ANN` (links) and `/OUT`
(bookmarks). In other devices, define it as a no-op that clears to the mark,
as Ghostscript does, so the same program renders everywhere.
Related: #1026 (PDF text as real text).
