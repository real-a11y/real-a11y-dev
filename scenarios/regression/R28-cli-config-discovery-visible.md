---
id: R28
suite: regression
scenario: "CLI config discovery is visible — `--verbose` says which config was used, or why none was"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.2. Earlier releases print no `config:` line at all, which is the old behaviour rather than a fail"
validUntil: ""
expected: "each of the four provenance cases names an absolute path or the reason there is none; the absent line carries path + rule + remedy; -q does not silence it; exactly one line even when the page list comes from the config"
covers:
  - cli.commands.audit.flags.--verbose
  - cli.commands.audit.flags.--config
  - cli.commands.audit.flags.--no-config
  - cli.commands.audit.flags.--quiet
notion: "https://app.notion.com/p/3ad1c354b0b5814e9525d466c8873990"
---

## Steps

The shape that matters is a config that **exists** but is not where the command ran
from — discovery stats the current directory and nothing else.

```bash
mkdir -p demo/nested && cd demo
cat > a11y.config.json <<'JSON'
{ "urls": ["http://localhost:3000"], "defaults": { "failOn": "warning" } }
JSON
```

1. From `demo/`: `real-a11y audit <url> --verbose`
2. From `demo/nested/`: `real-a11y audit <url> --verbose` — **the reported case**
3. From `demo/`: `real-a11y audit <url> --verbose --no-config`
4. From `demo/nested/`: `real-a11y audit <url> --verbose --config ../a11y.config.json`
5. From `demo/nested/`: the same run **without** `--verbose`
6. From `demo/`: `real-a11y audit --verbose` with **no url positional**, so the page
   list comes from the config — count the `config:` lines
7. From `demo/`: `real-a11y audit <url> -q --verbose`

## Expected

- **1** — `config: <abs>/demo/a11y.config.json (auto-discovered)`. Absolute, not
  `a11y.config.json`
- **2** — `config: none found — looked for <abs>/demo/nested/a11y.config.json`, plus
  the rule (_does not walk upward_) and the way out (_Pass `--config <file>`_). It
  must **not** name the parent's config, which exists but was never consulted
- **3** — `config: skipped (--no-config); built-in defaults only`
- **4** — the parent's path, marked `(from --config)`
- **5** — **no** `config:` line. The diagnostic is opt-in
- **6** — exactly **one** line. Not two
- **7** — the `config:` line survives, while `auditing …` and its `done in Nms`
  timing do not. `-q` suppresses progress; a requested diagnostic is not progress

## Why this exists

A config that isn't picked up is indistinguishable from no config at all: every
default reverts to its built-in and nothing says why. The file is sitting right
there, so the natural conclusion is that config defaults are broken rather than
that discovery never looked. That is what was actually reported.

Four details are each load-bearing, and each fails silently if dropped:

- **The path must be absolute** (1, 2). `a11y.config.json` is exactly what the user
  already believes they have, so a relative path conveys nothing.
- **The absent line needs all three parts** (2). The path answers _where did you
  look_, the rule answers _why won't looking elsewhere help_, the remedy answers
  _what now_. The path alone leaves someone assuming a parent directory will
  eventually be searched.
- **Exactly one line** (6). `resolveConfig` runs twice on that path — once for the
  defaults merge, again inside page-list resolution, which is only reached when no
  url positional was given — and its memo only covers the _found_ case. Emitting
  from inside it doubles the line for precisely the run that reports "none found".
  **A run with a url positional does not exercise this**, because the second call
  never happens; step 6 has no positional on purpose.
- **`-q` does not silence it** (7). Two of the three other `--verbose` writes bypass
  `-q` already (the resolved Chrome binary, the browser cache directory); the one
  that respects it is a per-page timing, which is progress. A reviewer read the new
  line as a divergence from that pattern, which is how the split came to be written
  down — so the step exists to keep it that way.

(2) is also the row that pins the no-upward-walk rule as deliberate. If an upward
walk to the git root is ever added, this step is where the behaviour change has to
be recorded rather than discovered.

## Notes

Nothing in either suite covered config discovery before this row, which is worth
knowing given the config is how a project adopts the tool in CI. It deliberately
covers **discovery and its diagnostic only** — precedence
(`flag > env > config > built-in`), fail-closed key validation, and `urls`
resolution are still uncovered by any row.
