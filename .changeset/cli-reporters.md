---
"@real-a11y-dev/cli": minor
---

CI interop reporters and diff-side baselines. `snapshot --format` now speaks `sarif`, `junit`, and `jsonl` alongside `json` (still the default) and `md` (`--md` stays as shorthand):

- **`sarif`** — SARIF 2.1.0 for GitHub code scanning (upload with `codeql-action/upload-sarif@v4` and findings land in the Security tab), Azure DevOps, and the VS Code SARIF viewer. Built to survive the known interop traps: results anchor to repo **file paths** (the page's `sourcePath` from the config, else the config file — never a bare page URL, which GitHub silently won't display), so `sarif` requires `--config`; alert identity is supplied via `partialFingerprints.primaryLocationLineHash` = the stable `v1:` fingerprint, so alerts neither collapse nor churn on unrelated edits; `automationDetails.id` is scoped per config, not per page; and baseline-suppressed findings are excluded entirely, because GitHub ignores SARIF `suppressions[]`.
- **`junit`** — one suite per page, one failing case per finding, baselined findings as `skipped`, a passing placeholder for clean pages (empty suites read as "no tests ran" in some ingesters), XML-escaped throughout.
- **`jsonl`** — one finding per line for `jq`/grep pipelines; no framing records; suppressed findings flagged.

`diff` now takes `--baseline <file>` too: a NEW finding the baseline accepts renders as `new (baselined)` — reported, never gating — closing the loop with `snapshot --update-baseline`. The `a11y.config.json` page entries gain a `sourcePath` field (carried into the snapshot artifact) for SARIF anchoring. Reporters are exported from the programmatic API as `renderSarif`, `renderJUnit`, and `renderJsonl`.
