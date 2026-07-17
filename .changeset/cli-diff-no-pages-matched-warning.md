---
"@real-a11y-dev/cli": patch
---

`real-a11y diff` now warns on stderr when the two snapshots share no page `name` at all. Pages join by name, never URL, so two snapshots taken with positional URLs (whose names then default to URLs differing by host/port) matched nothing: every page read as added/removed, no structure was ever compared, and `--explain` silently had nothing to add — a diff that looked like it worked but compared nothing. The report and exit code are unchanged; only the warning is new.
