# @real-a11y-dev/cli

## 0.1.0-beta.0

### Minor Changes

- 18dda52: New package `@real-a11y-dev/cli` — the Real A11y engine as a shell command (`real-a11y`), for one-shot audits, scripts, and CI gates. `real-a11y audit <url>` prints every violation grouped by rule with per-instance CSS locators and exits `1` on errors by default (`--fail-on error|warning|never`), so a passing pipeline means the page really has no findings; exit codes `0/1/2` are a frozen contract. `tree`, `outline`, `tabs`, `list`, and `inspect` print the perception views — what a screen reader actually hears — straight from one extraction.

  Built for automation: `--format json` emits a stable envelope (`schemaVersion: 1`) in which every finding carries a stable `v1:` fingerprint (the identity that phase-2 `diff` and baselines will match on); under GitHub Actions the CLI additionally emits grouped `::error`/`::warning` annotations and a job-summary report automatically. Local builds audit directly (`real-a11y audit ./dist/index.html`); `--device`, `--viewport`, `--root`, `--wait-until/--settle/--timeout`, `--headful`, and `--cdp` (attach to a logged-in Chrome) cover dynamic and authenticated pages.

  Hardened by default: everything returned from the audited page is sanitized at the browser boundary (terminal escape/bidi injection, hostile page realms, secret-bearing URLs are redacted in every sink), reports are deterministic (no timestamps, stable ordering), and human output never conveys severity by color alone. Playwright is an optional peer dependency, lazily imported, with actionable errors when it (or Chromium) is missing. Zero new runtime dependencies.

- e736c75: Track accessibility regressions across a PR. `real-a11y snapshot` audits a whole page set (from `a11y.config.json` or the `A11Y_PAGES` env) and writes one diffable JSON artifact — findings with stable `v1:` fingerprints plus the tree/outline/tabs views per page (or `--md` for a human report). `real-a11y diff base.json pr.json` then classifies the two as **new / changed / fixed** and exits 1 only on NEW findings at/above `--fail-on`, so pre-existing debt never blocks a PR and fixes never gate.

  The diff is finding-identity-aware, not a line diff: a two-tier matcher (exact fingerprint, then greedy best-match per rule on locator/context/tag similarity) means a renumbered `:nth-of-type` locator, a re-indented subtree, or an inserted sibling reads as unchanged — only a real violation change is reported. `diff` is pure (no browser). Adds the strict, fail-closed `a11y.config.json` loader (a typo'd key is an error, so a mistake can't silently un-gate CI), `pretty` / `json` / `md` diff output, and the `diffFindings` / `diffArtifacts` / `parseSnapshotArtifact` programmatic API.

- 18dda52: Audit pages behind a login, without ever handing the tool a password. `real-a11y login <url> --save auth.json` opens a visible browser, you log in by hand (MFA/SSO/passkeys all work), press Enter, and the session is saved; `--storage-state auth.json` on `audit`/`inspect`/`tree`/`outline`/`tabs`/`list` then audits as that logged-in user. The saved file is written `0o600` and the command warns if it lands un-gitignored inside a repo.

  Under a loaded session, auditing is **origin-pinned**: extraction is refused if a page redirects off the target's origin (exit 2), so a stray or hostile redirect can't pull an unintended authenticated page into a report — `--audit-origin <origin>` allows a known SSO bounce. Storage-state files are validated up front with catalog-style errors that never echo their contents, `--storage-state` conflicts with `--cdp`, and an expired session surfaces an advisory "may have expired — re-run login" note. `login` is interactive-only (exits 2 with a clear hint in CI). Session storage isn't captured by storage state — `--cdp` remains the interactive fallback for apps that keep auth there.

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
- Updated dependencies [9c3517c]
- Updated dependencies [18dda52]
- Updated dependencies [32fc4e6]
- Updated dependencies [18dda52]
  - @real-a11y-dev/testing@0.1.0-beta.10
  - @real-a11y-dev/mcp@0.1.0-beta.0
