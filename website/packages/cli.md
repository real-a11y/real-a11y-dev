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

This page is a guide: install it, then walk the workflows it's built for — the CI
gate, PR regression tracking, adopting the gate on existing debt, and pages
behind a login.

::: tip Looking for the exhaustive lists?
Full command + flag reference → [/packages/cli/commands](/packages/cli/commands).
Every config key → [/packages/cli/configuration](/packages/cli/configuration).
:::

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

`audit` is the flagship, but there are read-only view commands too — `inspect`,
`outline`, `tabs`, `list <category>` — each printing one facet of the same
extraction. See the [command reference](/packages/cli/commands) for the full set.

## Configure once

Put your project's settings in an **`a11y.config.json`** and every command picks
them up — the Jest/ESLint model. A `defaults` block seeds any flag you don't
pass; an optional `urls` list names the routes you audit. Both are optional — a
`defaults`-only config is valid.

```json
{
  "defaults": {
    "device": "iPhone 13",
    "waitUntil": "networkidle",
    "rules": ["no-unlabeled-interactive", "image-alt"],
    "failOn": "error"
  },
  "urls": [
    "http://localhost:3000",
    { "name": "Login", "url": "http://localhost:3000/login", "rootSelector": "main" }
  ]
}
```

With a `urls` list, a bare `real-a11y audit` (or `snapshot`) audits every entry —
pass a URL only for a one-off:

```sh
real-a11y audit                          # audits every URL in the config
real-a11y audit http://localhost:3000    # iPhone 13, networkidle, fail-on error — no flags
```

The config is auto-discovered as `a11y.config.json` in the current directory
(`--config` points elsewhere, `--no-config` ignores it). Precedence is
`flag > env var > config defaults > built-in`, so a default is a floor you
override per run. And it's **fail-closed**: an unknown key or bad value is a hard
error, so a typo can never silently un-gate CI. Every key, and which command each
applies to, is in the [configuration reference](/packages/cli/configuration).

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

The diff is **finding-identity-aware**, not a line diff: each finding carries a
stable `v1:` fingerprint, so a renumbered `:nth-of-type` locator, a re-indented
subtree, or an inserted sibling is **not** a change — only an actual
new / changed / fixed violation is. Pre-existing debt never blocks a PR
(REMOVED and CHANGED don't gate), and the config is strict and fail-closed — a
typo'd key is an error, so a mistake can't silently un-gate CI.

### Structural changes

By default `diff` is **neutral** — findings plus a **real unified diff** of the
structure (context lines, order, indentation, like a PR file diff), shown in
full so you can see *where* the change is:

````text
$ real-a11y diff base.json pr.json
#### home
```diff
@@ -3,7 +3,8 @@
     link "About"
-    button "Toggle theme"
+    button "Switch to dark mode"
   main
+    complementary "Semantic Navigator"
```
````

Add **`--explain`** and the shape shifts that don't trip a rule are also
narrated as **statements any reviewer can act on** — a heading dropping from h2
to h3, a landmark removed, an element still on the page but no longer
keyboard-focusable, a pure reorder of the tab order that no line diff would catch:

```text
$ real-a11y diff base.json pr.json --explain
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 1 of 2)
```

`--explain` is opt-in because the statements are an interpretive layer; the
default never makes a claim the diff can't back up. Anything the taxonomy doesn't
recognize degrades to one honest `Other content changed` rollup — never silence.
Structural changes are **advisory only**: they never affect the exit code.

Generated content that differs on every build (a "last updated" timestamp, a
build hash) would otherwise read as drift on every page — drop it at the source
with a repeatable regex, and cap the output for a CI comment:

```sh
real-a11y diff base.json pr.json --explain \
  --ignore-view-line '^time "' --max-pages 5 --max-lines 20 -o comment.md
```

The full diff prints to stdout regardless; the caps only shape the file you post.
See the [command reference](/packages/cli/commands) for every `diff` flag.

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

## In CI

`audit` is a gate with no extra flags. Under GitHub Actions it additionally
emits grouped `::error` annotations on the checks surface and a job-summary
report — automatically (`--no-annotate` to opt out):

```yaml
- run: npm ci && npm run build && npx serve dist -l 3000 &
- run: npx wait-on http://localhost:3000
- run: npx real-a11y audit http://localhost:3000   # exits 1 on errors
```

`snapshot` also speaks the CI interop formats — `sarif` for GitHub code scanning
(Security tab), `junit` for Jenkins/GitLab test reporting, `jsonl` for `jq`
pipelines. Wiring SARIF into GitHub code scanning is two steps:

```yaml
- run: npx real-a11y snapshot --config a11y.config.json -f sarif -o a11y.sarif
- uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: a11y.sarif
```

Findings then appear as alerts in the repository's **Security** tab, tracked
across runs by fingerprint. The full format matrix — what each one feeds and its
caveats — is in the [command reference](/packages/cli/commands).

## Pages behind a login

Log in once and reuse the session — no password ever reaches the tool:

```sh
real-a11y login https://app.example.com --save auth.json     # log in by hand, press Enter
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

See the [Authenticated pages](/guide/authenticated-pages) guide for the full
workflow, the security rules, and the interactive `--cdp` alternative.

## Output you can trust

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

Each finding carries that `v1:` **fingerprint** — an identity robust to unrelated
DOM churn, so a report can be diffed run-to-run without every re-indent reading
as a change. What the contract guarantees:

- Exit codes are **frozen** — `0` clean, `1` findings at/above `--fail-on` (the
  gate), `2` usage/navigation/engine error.
- `--format json` carries `schemaVersion`; within 0.x, changes are additive-only.
- Fingerprints (`v1:…`) are immutable per version — a better algorithm ships as
  `v2` alongside, never by mutating `v1`.
- Reports are **deterministic**: no timestamps, stable ordering, LF-only — so
  the same DOM yields the same bytes.
- Output never conveys severity by color alone (always a text tag), and honors
  `NO_COLOR` / `FORCE_COLOR`. **No telemetry** — the only network traffic is to
  the page you audit.

## Limitations

- **Scope.** Five rules today — unlabeled interactive elements, images missing
  alt text, heading order, dialog labeling, and landmark structure — plus the
  full semantic tree. It is not a complete WCAG or axe-core suite; it is
  semantic-tree-based and tuned to "what a screen reader announces." Pair it with
  [axe-core](https://github.com/dequelabs/axe-core) for contrast, focus
  visibility, and other rendered checks.
- **Not a crawler.** You name the URLs (as arguments, or the `urls` list in
  `a11y.config.json`) — there is no link discovery.
- **Requires a real browser.** Playwright + Chromium must be installable.

## See also

- [Command + flag reference](/packages/cli/commands) — every command and flag.
- [Configuration reference](/packages/cli/configuration) — every `a11y.config.json` key.
- [Authenticated pages](/guide/authenticated-pages) — audit behind a login.
- [`@real-a11y-dev/mcp`](/packages/mcp) — the same engine for AI agents.
- [`@real-a11y-dev/testing`](/packages/testing) — the same engine in your tests.
