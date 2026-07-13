---
"@real-a11y-dev/cli": minor
---

`a11y.config.json` becomes a **project config** in the Jest/ESLint sense: a new `defaults` block seeds any flag you don't pass, on **every** command (today only `snapshot` read a config).

```json
{
  "defaults": {
    "device": "iPhone 13",
    "waitUntil": "networkidle",
    "failOn": "error"
  },
  "pages": [{ "name": "Home", "url": "http://localhost:3000" }]
}
```

```sh
real-a11y audit http://localhost:3000   # iPhone 13, networkidle, fail-on error — no flags
```

- **Precedence:** `flag > env var > config defaults > built-in`. An explicit flag always wins; `--no-config` (now accepted by every command) opts a run out.
- **Validated by the same parsers as flags** — a config default becomes a "virtual flag," so `defaults.failOn: "sometimes"` errors exactly like `--fail-on sometimes`, and the config loader stays strict/fail-closed (an unknown or mistyped `defaults` key is a hard error). `format` is validated per command — `format: "sarif"` works for `snapshot`, errors on `audit`.
- **Config-settable:** `root`, `device`, `viewport`, `waitUntil`/`settleMs`/`timeoutMs`, `headful`, `storageState`, `auditOrigins`, `format`, `rules`, `failOn`, `annotate`, `includeGeneric`, `baseline`, `ignoreViewLine`, `maxLines`, `maxPages`, `explain`. Path defaults (`storageState`, `baseline`) resolve relative to the config file, so a committed config is portable.
- **Not settable** (deliberately): the per-run/destination flags (`output`, `quiet`, `verbose`) and the security-sensitive `allow-file`/`cdp`.
- Discovery is the cwd `a11y.config.json` (or `--config <file>`); it's loaded once and shared, so `snapshot` doesn't parse it twice. This also finally wires `config.failOn`, which was validated-but-ignored before.
- Top-level `rules`/`failOn`/`device` are kept as back-compat shorthand for `defaults.*` (`defaults` wins if both are set).
