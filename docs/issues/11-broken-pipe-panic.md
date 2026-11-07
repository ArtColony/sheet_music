# CLI: panics with "Broken pipe" when stdout is closed early

**pscat version:** 0.7.0-rc.4 (macOS arm64 CLI)

## What happens
When the reader of pscat's stdout goes away (`| head`), the program gets an `ioerror`, and then the CLI itself panics:

```sh
pscat --pdf /dev/null -e '1 1 200000 { = } for' | head -c 10 >/dev/null
```

stderr:
```
%%[ Error: ioerror; OffendingCommand: =; Line: 1 ]%%

thread 'main' (…) panicked at …/library/std/src/io/stdio.rs:1165:9:
failed printing to stdout: Broken pipe (os error 32)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## Expected
Exit quietly (as most Unix tools do on SIGPIPE/EPIPE), or with the PostScript `ioerror` report only, and no Rust panic.

## Severity
Low: harmless when the whole output is read, but it looks like a crash when previewing output with `head`.
