---
"@real-a11y-dev/cli": patch
---

The cleanup the CLI runs on exit and on Ctrl-C (closing browser sessions, removing half-written `--output` files, releasing a session lock) now runs every registered cleanup even if one of them throws synchronously. Before, such a throw ended the run early and skipped every cleanup after it. None of today's cleanups throw that way, so nothing a user runs behaves differently; the guarantee just no longer depends on it.
