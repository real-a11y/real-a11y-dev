---
title: "@real-a11y-dev/cli — accessibility audits from your shell"
description: A command-line accessibility auditor built on the Real A11y semantic tree — audit any URL with CI-grade exit codes, a stable JSON contract, and pages behind a login.
---

# @real-a11y-dev/cli

::: warning Beta — preview page
Published on npm as a **beta**: the command surface may still change before 1.0,
and audit fidelity is bounded by known engine issues (see Limitations). Pin a
version rather than tracking the latest tag if you build on it.
:::

Audit **what a screen reader hears**, from your shell. `real-a11y` drives a real
browser, extracts the semantic accessibility tree, and reports the defects a
screen reader would announce — with exit codes for CI, a stable JSON contract for
scripts, and a way to audit pages behind a login. It's the same engine as the
[extension](/guide/chrome-extension), the [testing library](/packages/testing),
and the [MCP server](/packages/mcp) — one audit, a different surface.

## Prerequisites

Accessibility is a property of the **rendered** page — the roles, names, and
visibility a browser actually computes, not what's in the HTML source. So the
CLI drives a real browser (via Playwright) rather than parsing markup, and needs:

- **Node.js 20+**.
- **Playwright + a Chromium binary** — Playwright is an optional peer dependency,
  loaded only when a command needs a browser.

```sh
npm i -D @real-a11y-dev/cli@beta playwright
npx playwright install chromium
```

The package publishes on the `beta` dist-tag until `0.1.0`, so pin `@beta` (or
an exact version) — an unpinned `@real-a11y-dev/cli` resolves the `latest` tag,
which isn't published yet and fails with "No matching version found."

Prefer an in-project install over a bare `npx @real-a11y-dev/cli`: `npx` resolves
its own copy of Playwright, and its browser binaries are revision-locked, so a
mismatched global Playwright can leave you with "Executable doesn't exist" even
after `playwright install`.

## Your first audit

```sh
# See a page the way assistive tech does — no test file, no config:
npx real-a11y tree https://example.com
```

```
main
  heading "Example Domain" (level 1)
  link "More information..."
```

Then gate a build on it — `audit` exits `1` on errors with no extra flags:

```sh
real-a11y audit http://localhost:3000
```

```
  [error] no-unlabeled-interactive: Unlabeled interactive element: button <button> (×2)
      body > main > button  in <main>
      body > main > button:nth-of-type(2)  in <main>

2 issues — 2 error(s), 0 warning(s)
```

Because it drives a real browser, JS-heavy SPAs render fully, and any URL the
browser can reach works — public sites, a **local dev server**, staging, or a
built file (`real-a11y audit ./dist/index.html` — paths you type need no
ceremony).

## Commands

| Command | What it prints |
| --- | --- |
| **`audit <url…>`** | **Flagship.** Every violation — unlabeled controls, images missing alt text, skipped/missing/duplicate headings, unlabeled dialogs, broken landmark structure — grouped by rule, each with a CSS **locator** + **severity**. Exits `1` on errors (the CI gate). |
| `inspect <url>` | Findings **plus** the semantic tree, heading outline, and tab order — all from **one** extraction, guaranteed internally consistent. |
| `tree <url>` | The semantic tree (role + accessible name). |
| `outline <url>` | Heading outline (h1–h6) in document order. |
| `tabs <url>` | Focusable elements in keyboard Tab order. |
| `list <category> <url>` | One category — `heading` / `link` / `button` / `form` / `landmark` / `image` — as role + name + locator. |
| `snapshot [url...]` | Audit a URL (like every other command), or a page set from `A11Y_PAGES` / `a11y.config.json` → one diffable JSON artifact, or `--md` for a human report. |
| `diff <base> <pr>` | Findings-aware diff of two snapshot artifacts — new / changed / fixed. Pure (no browser). See below. |
| `login <url> --save <file>` | Save a login session for `--storage-state` audits (see [Authenticated pages](/guide/authenticated-pages)). |

Run `real-a11y <command> --help` for a command's flags.

## Track regressions across a PR

The flagship CI feature: snapshot one page or a whole set into a diffable
artifact, then diff two of them and fail the build only on **new** findings.

```sh
# a single page — a URL positional, like every other command
real-a11y snapshot https://example.com -o base.json

# or a whole set (base branch, then PR)
real-a11y snapshot --config a11y.config.json -o base.json
real-a11y snapshot --config a11y.config.json -o pr.json

real-a11y diff base.json pr.json          # exit 1 only on NEW findings
real-a11y diff base.json pr.json -f md    # a PR-comment-ready summary
```

Pages come from positional URLs, else `A11Y_PAGES`, else `a11y.config.json` —
your multi-page policy in your repo:

```json
{
  "pages": [
    { "name": "Home", "url": "http://localhost:3000" },
    { "name": "Login", "url": "http://localhost:3000/login", "rootSelector": "main" }
  ],
  "rules": ["no-unlabeled-interactive", "image-alt", "heading-order"],
  "failOn": "error"
}
```

The diff is **finding-identity-aware**, not a line diff: each finding carries a
stable `v1:` fingerprint, so a renumbered `:nth-of-type` locator, a re-indented
subtree, or an inserted sibling is **not** a change — only an actual
new / changed / fixed violation is. Pre-existing debt never blocks a PR
(REMOVED and CHANGED don't gate), and the config is strict and fail-closed — a
typo'd key is an error, so a mistake can't silently un-gate CI.

### Structural changes, in plain language

Shape shifts that don't trip a rule are narrated as **statements any reviewer
can act on**, not raw serialized lines:

```text
structure changed (advisory): tree +2/-1 · outline +1/-1 · tabs +1/-0
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 1 of 2)
```

The taxonomy covers what assistive-tech users actually feel:

- **Landmarks** added / removed / renamed — removing `main` calls out that
  skip-to-content may break.
- **Headings** — level changes (`h2 → h3`), renames, additions, removals, and
  a page losing *all* its headings as one headline statement.
- **Keyboard tab stops** added / removed with their position (`now stop 2 of
  14`) — including the dangerous variant where the element is *still on the
  page but no longer keyboard-focusable*.
- **Pure reorders** of the tab order or heading outline — invisible to any
  line diff, since no line was added or removed.
- Interactive elements outside the tab order (`menuitem`, `option`, `tab` —
  arrow-key targets inside composite widgets).

Anything the taxonomy doesn't recognize degrades to one honest
`Other content changed: +N/-N lines` rollup — never silence. Rename pairings
are strictly 1:1 and degrade to add/remove on any ambiguity, so the summary
never guesses. In `--format md` the raw `+`/`-` lines are demoted into a
collapsed `<details>` block under the statements; in `--format json` the
statements ship as `pages[].structural` (`{ kind, message, … }` — key on
`kind`; the `message` wording may be refined in patches). Structural changes
are **advisory only**: they never affect the exit code.

Generated content that differs on every build (a "last updated" timestamp, a
build hash) would otherwise read as drift on every page — drop it at the
source with a repeatable regex:

```sh
real-a11y diff base.json pr.json --ignore-view-line '^time "'
```

## Adopt the gate on existing debt

Most real codebases have accessibility findings *today* — which usually means
the gate stays off. Baselines fix that: accept the current state once, then
fail only on findings that are genuinely **new**.

```sh
# 1. Accept today's findings (commit the file it writes):
real-a11y snapshot --config a11y.config.json --update-baseline

# 2. Gate every run on NEW findings only:
real-a11y snapshot --config a11y.config.json \
  --baseline .a11y-baseline.json --fail-on error
```

Three properties make this safe to rely on:

- **Report truth, gate policy.** Suppressed findings stay in every report
  (marked `"suppressed": true` in JSON) — the baseline changes what fails the
  build, never what you can see.
- **Identity-matched, not string-matched.** The baseline uses the same two-tier
  matcher as `diff`, so a renumbered `:nth-of-type` locator or a re-indented
  subtree doesn't silently un-suppress a finding you'd already accepted.
- **Stale entries warn, never fail.** When a baselined finding is fixed, you get
  a stderr warning; `--update-baseline` prunes it — and carries forward any
  `note` fields you've added to entries (e.g. a ticket link) that still match.

`diff` takes `--baseline` too: a NEW finding the baseline accepts is reported as
`new (baselined)` but never gates.

## Global flags

| Flag | Effect |
| --- | --- |
| `--root <selector>` | Scope extraction to a region or component (default `body`). |
| `--device <name>` | Emulate a device — `"iPhone 13"`, `"Pixel 7"` — to audit the mobile layout. |
| `--viewport <WxH>` | Explicit viewport, e.g. `1280x800`. |
| `--wait-until <state>` / `--settle <ms>` | Settle dynamic pages before extraction (`load` \| `domcontentloaded` \| `networkidle` \| `commit`). |
| `--timeout <ms>` | Navigation timeout (default `30000`). |
| `--rules <ids>` | Comma-separated subset of the five rules (`audit`/`inspect`/`snapshot`). |
| `--fail-on <level>` | `error` \| `warning` \| `never` — the gate threshold (default `error`), on `audit`/`inspect`/`diff`, and on `snapshot` (default `never` there). View commands aren't gates: they always exit `0`. |
| `--baseline <file>` / `--update-baseline` | Suppress accepted findings / rewrite the baseline from the current run (`snapshot` and `diff` — see [Adopt the gate on existing debt](#adopt-the-gate-on-existing-debt)). |
| `--ignore-view-line <regex>` | Drop matching view lines before diffing (`diff`, repeatable) — for generated content that differs on every build, e.g. `'^time "'` for a "last updated" timestamp. |
| `-f, --format <fmt>` | `pretty` (default) or `json`; `diff` also takes `md`; `snapshot` takes `json` (default) \| `md` \| `sarif` \| `junit` \| `jsonl` (see [SARIF, JUnit, JSONL](#sarif-junit-jsonl)). Never auto-switched — piping only drops color. |
| `-o, --output <file>` | Write the report to a file (progress stays on stderr). |
| `--storage-state <file>` / `--audit-origin <origin>` | Audit as a saved login session (see [Authenticated pages](/guide/authenticated-pages)). |
| `--cdp <endpoint>` | Attach to a running Chrome instead of launching one. |

## Machine output

`--format json` emits one stable envelope for every command, single- or
multi-page, so scripts always read `.pages[0].…`:

```json
{
  "schemaVersion": 1,
  "command": "audit",
  "summary": { "total": 2, "errors": 2, "warnings": 0 },
  "pages": [
    {
      "name": "http://localhost:3000/",
      "url": "http://localhost:3000/",
      "summary": { "total": 2, "errors": 2, "warnings": 0 },
      "findings": [
        { "rule": "no-unlabeled-interactive", "severity": "error", "…": "…",
          "fingerprint": "v1:5ccd8ffcbc43cd09" }
      ]
    }
  ]
}
```

Each finding carries a stable `v1:` **fingerprint** — an identity robust to
unrelated DOM churn, so a report can be diffed run-to-run without every
re-indent reading as a change.

`diff --format json` additionally carries, per page, the raw view line diffs
(`pages[].views.{tree,outline,tabs}.{added,removed}`) and the plain-language
structural statements (`pages[].structural: [{ kind, view, message, … }]`) —
key on `kind` (stable; new kinds may be added within 0.x), not on the
`message` wording. Both live in the same `schemaVersion: 1` envelope:
additions are additive-only.

### SARIF, JUnit, JSONL

`snapshot --format` also speaks the CI interop formats:

| Format | Feeds | Notes |
| --- | --- | --- |
| `sarif` | GitHub code scanning (Security tab), Azure DevOps, the VS Code SARIF viewer | Requires `--config` — GitHub only displays results anchored to repo **file paths**, so each result anchors to the page's `sourcePath` (declare it per page in the config) or the config file itself. Alert identity is the `v1:` fingerprint, so alerts don't churn on unrelated edits. Baseline-suppressed findings are excluded (GitHub ignores SARIF suppressions). |
| `junit` | Jenkins, GitLab, Azure DevOps "Publish Test Results", CircleCI | One suite per page, one failing case per finding; baselined findings show as `skipped`; a clean page emits one passing case. |
| `jsonl` | `jq` / grep pipelines, log ingesters | One finding per line, no framing records. Suppressed findings are flagged — filter with `jq 'select(.suppressed \| not)'`. |

Wire SARIF into GitHub code scanning in two steps:

```yaml
- run: npx real-a11y snapshot --config a11y.config.json -f sarif -o a11y.sarif
- uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: a11y.sarif
```

Findings then appear as alerts in the repository's **Security** tab, tracked
across runs by fingerprint. (Alerts on private repos need GitHub Advanced
Security; public repos get them free.)

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No findings at/above `--fail-on`. |
| `1` | Findings at/above the threshold (the CI gate). |
| `2` | Usage / navigation / engine error. |

### Stability contract

- Exit codes `0/1/2` are **frozen**.
- `--format json` carries `schemaVersion`; within 0.x, changes are additive-only.
- Fingerprints (`v1:…`) are immutable per version — a better algorithm ships as
  `v2` alongside, never by mutating `v1`.
- Reports are **deterministic**: no timestamps, stable ordering, LF-only — so
  the same DOM yields the same bytes.
- Output never conveys severity by color alone (always a text tag), and honors
  `NO_COLOR` / `FORCE_COLOR`. **No telemetry** — the only network traffic is to
  the page you audit.

## In CI

`audit` is a gate with no extra flags. Under GitHub Actions it additionally
emits grouped `::error` annotations on the checks surface and a job-summary
report — automatically (`--no-annotate` to opt out):

```yaml
- run: npm ci && npm run build && npx serve dist -l 3000 &
- run: npx wait-on http://localhost:3000
- run: npx real-a11y audit http://localhost:3000   # exits 1 on errors
```

## Pages behind a login

Log in once and reuse the session — no password ever reaches the tool:

```sh
real-a11y login https://app.example.com --save auth.json     # log in by hand, press Enter
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

See the [Authenticated pages](/guide/authenticated-pages) guide for the full
workflow, the security rules, and the interactive `--cdp` alternative.

## Limitations

- **Scope.** Five rules today — unlabeled interactive elements, images missing
  alt text, heading order, dialog labeling, and landmark structure — plus the
  full semantic tree. It is not a complete WCAG or axe-core suite; it is
  semantic-tree-based and tuned to "what a screen reader announces." Pair it with
  [axe-core](https://github.com/dequelabs/axe-core) for contrast, focus
  visibility, and other rendered checks.
- **Not a crawler.** You name the pages (as arguments, or in
  `a11y.config.json` for `snapshot`) — there is no link discovery.
- **Requires a real browser.** Playwright + Chromium must be installable.

## See also

- [Authenticated pages](/guide/authenticated-pages) — audit behind a login.
- [`@real-a11y-dev/mcp`](/packages/mcp) — the same engine for AI agents.
- [`@real-a11y-dev/testing`](/packages/testing) — the same engine in your tests.
