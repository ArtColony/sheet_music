# CLI: a large program piped on stdin (`-`) sometimes hangs forever

**pscat version:** 0.7.0-rc.4 (macOS arm64 CLI)

## What happens

With the program on stdin (`pscat --pdf out.pdf -`), a run now and then never
finishes: the process sits at 0% CPU and does not exit, and nothing is
written. It only happens when the program is large. The same program passed
as a file path has never hung.

## Repro

```js
// node repro.js: counts runs that hang (killed after 4 s)
const { execFileSync } = require('child_process');
const prog = '%' + 'x'.repeat(70000) + '\n(hi) = 0 0 1 1 rectfill showpage\n';
let hung = 0;
for (let i = 0; i < 40; i++) {
  try { execFileSync('pscat', ['--pdf', 'x.pdf', '-'], { input: prog, timeout: 4000, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { hung++; }
}
console.log(hung, 'of 40 hung');
```

Result here: `2 of 40 hung` for the 70 KB program in one loop, then `0 of 40`
and `0 of 100` in later loops at 60-140 KB, so it is intermittent (perhaps
load-dependent: other jobs shared the machine). Passing the program as a file path: 0 hangs in 320 runs. The test that
first hit it (12 pscat calls with 67 KB programs on stdin) hung on one call in
each of three runs, a different call each time. Not yet a reliable repro: this
draft is not filed until one is found.

## Expected

pscat reads stdin to EOF and runs the program every time, as it does when
given a file.

## Context

Found while testing a PostScript ABC parser (`lib/sm_abc_parse.ps`, 67 KB),
which is piped to pscat together with the ABC text. The test now writes the
program to a temporary file.
