---
"@real-a11y-dev/cli": minor
---

`snapshot` now takes a **URL positional**, like every other command — the config is optional, for multi-page/policy:

```sh
real-a11y snapshot https://example.com -o base.json    # single page, no config
real-a11y snapshot                                     # pages from a11y.config.json
```

Pages resolve in precedence order: **positional URLs → `A11Y_PAGES` → `a11y.config.json`**. A positional URL's page name defaults to the URL (matching `audit`/`tree`). This removes the inconsistency where `snapshot` was the only command that couldn't audit a URL you just type — making the snapshot → diff flow usable without writing a config first.
