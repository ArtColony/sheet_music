# CLI: "pscat: wrote FILE" goes to stdout, glued to the program's own output

**pscat version:** 0.7.0-rc.4 (macOS arm64 CLI)

## What happens
The CLI's report that it wrote the output file is printed to **stdout**, the same stream as the program's `print`/`=` output, and is not started on a new line.

```sh
echo '(x) print 0 0 1 1 rectfill showpage' > w.ps
pscat --pdf w.pdf w.ps 2>/dev/null
# stdout: xpscat: wrote w.pdf
```

## Why it matters
Programs that compute something and print it (JSON, CSV, a check report) cannot be piped straight into another tool: the reader has to make sure the program's output ends with a newline and then drop lines starting `pscat: `. Our tests that read JSON printed by a PostScript library do exactly this.

## Suggestion
Print the "wrote" report on stderr (like other status messages), or at least start it on its own line. A `--quiet` flag would also do.
