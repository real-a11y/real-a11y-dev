---
name: gate-ci-a11y
description: >-
  Gate CI and PR checks with @real-a11y-dev/cli: real-a11y audit exit codes,
  a11y.config.json multi-URL runs, snapshot + diff across base/PR, baselines
  for existing debt, and SARIF/JUnit output.
---

# Gate CI with Real A11y CLI

Shell/CI surface for live URLs. Docs: https://real-a11y.dev/packages/cli  
Commands: https://real-a11y.dev/packages/cli/commands  
Config: https://real-a11y.dev/packages/cli/configuration  
PR bot recipe: https://real-a11y.dev/guide/ci-diff-bot

## Install in CI

```sh
npm i -D @real-a11y-dev/cli@beta playwright
npx real-a11y install
```

Serve the app (or point at a preview URL), wait until healthy, then audit.

## Simple gate

```sh
npx real-a11y audit http://localhost:3000
```

- Exit **1** on error-severity findings.
- Exit **2** (or non-zero failure) when the URL is unreachable — never treat
  network failure as a clean pass.
- Optional `a11y.config.json` with `defaults` and `urls` for multi-page runs.

## PR regression (snapshot → diff)

1. On the base ref: `real-a11y snapshot <url> --output base.json` (or configured set)
2. On the PR ref: `real-a11y snapshot <url> --output pr.json`
3. `real-a11y diff base.json pr.json` — fails on **new** regressions
4. Use `--format md` for PR comments; optional `--explain` for structural hints
   (advisory only — do not treat as a hard signal alone)

Identity matching uses fingerprints — do not line-diff raw JSON by hand. Noisy
live pages (timestamps, ads) may need `--ignore-view-line` (see CLI docs / D3).

Capture baselines in a **fresh** session if you also use `--session` for acts.

## Adopting on existing debt

Use baseline suppression on **`real-a11y snapshot`** (not `audit`) so only new
issues fail the build:

```sh
npx real-a11y snapshot --config a11y.config.json --update-baseline
npx real-a11y snapshot --config a11y.config.json \
  --baseline .a11y-baseline.json --fail-on error
```

`--baseline` is also valid on `diff`. Suppressed items still report but don’t
fail. Re-baseline after intentional a11y fixes or after locator/fingerprint
format changes called out in release notes.

## Artifacts

Prefer documented reporters (`sarif`, `junit`, `json` / `jsonl`) for uploads to
code-scanning / test dashboards. The CLI is not a crawler — name the URLs.

## Related

- One-off human/agent audit → `audit-a-page`
- In-suite snapshots → `a11y-snapshot-tests`
