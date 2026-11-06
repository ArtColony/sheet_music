# `(file) status` returns false for a file that exists

**pscat version:** 0.7.0-rc.4 (CLI, macOS arm64)

## What happened

The file-name form of `status` (PLRM 3, `status`: *filename* → *pages bytes
referenced created* `true`, or `false`) answers `false` for a file that the
same program can open and read:

```postscript
(lib/sm_abc.ps) status =                    % false   (expected: four numbers and true)
(lib/sm_abc.ps) (r) file bytesavailable =   % 88138   (the file is there)
```

```
$ pscat -e "(lib/sm_abc.ps) status = (lib/sm_abc.ps) (r) file bytesavailable ="
false
88138
```

An absolute path gives `false` too.

## Why it matters

`status` is the standard way to ask "is this optional file there?" before
`run`-ning it. `lib/sm_abc.ps` (ArtColony/sheet_music) loads the optional
ABC parser `lib/sm_abc_parse.ps` on demand, and had to use
`mark { (lib/sm_abc_parse.ps) run } stopped pop cleartomark` instead, which
also hides real errors inside the file it runs.

## Expected

`(path) status` → `pages bytes referenced created true` for an existing
readable file (pages may be `bytes 1024 idiv`; the times may be 0), `false`
only when there is no such file. If file-system metadata is deliberately not
exposed (the WebAssembly build), returning `0 bytes 0 0 true` would still
answer the existence question.
