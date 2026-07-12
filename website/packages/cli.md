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
| `snapshot` | Audit a page set (from `a11y.config.json` or `A11Y_PAGES`) → one diffable JSON artifact, or `--md` for a human report. |
| `diff <base> <pr>` | Findings-aware diff of two snapshot artifacts — new / changed / fixed. Pure (no browser). See below. |
| `login <url> --save <file>` | Save a login session for `--storage-state` audits (see [Authenticated pages](/guide/authenticated-pages)). |

Run `real-a11y <command> --help` for a command's flags.

## Track regressions across a PR

The flagship CI feature: snapshot a whole page set into a diffable artifact,
then diff two of them and fail the build only on **new** findings.

```sh
# on the base branch, and again on the PR
real-a11y snapshot --config a11y.config.json -o base.json
real-a11y snapshot --config a11y.config.json -o pr.json

real-a11y diff base.json pr.json          # exit 1 only on NEW findings
real-a11y diff base.json pr.json -f md    # a PR-comment-ready summary
```

Pages live in `a11y.config.json` — your policy in your repo:

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

## Global flags

| Flag | Effect |
| --- | --- |
| `--root <selector>` | Scope extraction to a region or component (default `body`). |
| `--device <name>` | Emulate a device — `"iPhone 13"`, `"Pixel 7"` — to audit the mobile layout. |
| `--viewport <WxH>` | Explicit viewport, e.g. `1280x800`. |
| `--wait-until <state>` / `--settle <ms>` | Settle dynamic pages before extraction (`load` \| `domcontentloaded` \| `networkidle` \| `commit`). |
| `--timeout <ms>` | Navigation timeout (default `30000`). |
| `--rules <ids>` | Comma-separated subset of the five rules (`audit`/`inspect`/`snapshot`). |
| `--fail-on <level>` | `error` \| `warning` \| `never` — the gate threshold (default `error`), on `audit`/`inspect`/`diff`. View commands aren't gates: they always exit `0`. |
| `-f, --format <fmt>` | `pretty` (default) or `json`; `diff` also takes `md` (`pretty` \| `json` \| `md`). Never auto-switched — piping only drops color. |
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
