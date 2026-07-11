---
"@real-a11y-dev/cli": minor
---

New package `@real-a11y-dev/cli` — the Real A11y engine as a shell command (`real-a11y`), for one-shot audits, scripts, and CI gates. `real-a11y audit <url>` prints every violation grouped by rule with per-instance CSS locators and exits `1` on errors by default (`--fail-on error|warning|never`), so a passing pipeline means the page really has no findings; exit codes `0/1/2` are a frozen contract. `tree`, `outline`, `tabs`, `list`, and `inspect` print the perception views — what a screen reader actually hears — straight from one extraction.

Built for automation: `--format json` emits a stable envelope (`schemaVersion: 1`) in which every finding carries a stable `v1:` fingerprint (the identity that phase-2 `diff` and baselines will match on); under GitHub Actions the CLI additionally emits grouped `::error`/`::warning` annotations and a job-summary report automatically. Local builds audit directly (`real-a11y audit ./dist/index.html`); `--device`, `--viewport`, `--root`, `--wait-until/--settle/--timeout`, `--headful`, and `--cdp` (attach to a logged-in Chrome) cover dynamic and authenticated pages.

Hardened by default: everything returned from the audited page is sanitized at the browser boundary (terminal escape/bidi injection, hostile page realms, secret-bearing URLs are redacted in every sink), reports are deterministic (no timestamps, stable ordering), and human output never conveys severity by color alone. Playwright is an optional peer dependency, lazily imported, with actionable errors when it (or Chromium) is missing. Zero new runtime dependencies.
