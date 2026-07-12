# @real-a11y-dev/cli

Audit **what a screen reader hears**, from your shell. `real-a11y` prints the
semantic accessibility tree — not a WCAG rule dump — and gates CI on
screen-reader-fidelity findings, with exit codes, machine formats, and GitHub
annotations built in.

```sh
npm i -D @real-a11y-dev/cli@beta playwright
npx playwright install chromium

# See a page the way assistive tech does — no test file, no config:
npx real-a11y tree https://example.com
```

```
main
  heading "Example Domain" (level 1)
  link "More information..."
```

> `@beta`: the package publishes on the `beta` dist-tag while the Real A11y
> family is in pre-release — unpinned `npx @real-a11y-dev/cli` won't resolve
> until `0.1.0`.

## Audit — a CI gate with no extra flags

```sh
real-a11y audit http://localhost:3000
```

```
  [error] no-unlabeled-interactive: Unlabeled interactive element: button <button> (×2)
      body > main > button  in <main>
      body > main > button:nth-of-type(2)  in <main>

2 issues — 2 error(s), 0 warning(s)
```

Exits `1` when errors are found (`--fail-on error` is the default; `warning` |
`never` available), `2` on usage/navigation failures, `0` when clean. In
GitHub Actions it additionally emits grouped `::error` annotations on the
checks surface and a job-summary report — automatically, `--no-annotate` to
opt out.

```yaml
# .github/workflows/a11y.yml
- run: npm ci && npm run build && npx serve dist -l 3000 &
- run: npx wait-on http://localhost:3000
- run: npx real-a11y audit http://localhost:3000   # exits 1 on errors
```

## Commands

| Command | What it prints |
| --- | --- |
| `audit <url...>` | Violations grouped by rule (the gate) |
| `inspect <url>` | Findings **plus** tree + outline + tab order, one extraction |
| `tree <url>` | The semantic tree (role + accessible name) |
| `outline <url>` | Heading outline |
| `tabs <url>` | Focusable elements in Tab order |
| `list <cat> <url>` | One category: heading, link, button, form, landmark, image |
| `snapshot` | Audit a page set → one diffable JSON artifact (or `--md`) |
| `diff <base> <pr>` | Findings-aware diff of two snapshots — new / changed / fixed |
| `login <url> --save <file>` | Save a login session for `--storage-state` audits |

Every command takes `--format json` for a stable machine envelope
(`schemaVersion: 1`, `pages[].findings[]` with stable `v1:` fingerprints),
`--device "iPhone 13"`, `--root <selector>`, `--output <file>`, and more —
see `real-a11y <command> --help`.

Local builds audit directly: `real-a11y audit ./dist/index.html` (paths you
type need no ceremony).

## Track regressions across a PR

`snapshot` writes a diffable artifact of a whole page set; `diff` compares two
and fails the build only on **new** findings — so pre-existing debt doesn't
block, and a fix or unrelated DOM churn never reads as a regression:

```sh
# on the base branch, and again on the PR:
real-a11y snapshot --config a11y.config.json -o base.json
real-a11y snapshot --config a11y.config.json -o pr.json
real-a11y diff base.json pr.json            # exit 1 only on NEW findings
real-a11y diff base.json pr.json -f md      # a PR-comment-ready summary
```

The pages live in `a11y.config.json` (`{ "pages": [{ "name", "url" }] }`), so
your policy is in your repo, not a copy-pasted script. The diff is
finding-identity-aware: a renumbered `:nth-of-type` locator or a re-indented
subtree is not a change — only an actual new/changed/fixed violation is.

## Adopt the gate on existing debt

A site with known findings can still gate on **new** ones. `--update-baseline`
records today's findings in `.a11y-baseline.json` (commit it); `--baseline` then
suppresses exactly those, so `--fail-on` counts only what's genuinely new:

```sh
real-a11y snapshot --config a11y.config.json --update-baseline   # accept today
real-a11y snapshot --config a11y.config.json \
  --baseline .a11y-baseline.json --fail-on error                 # gate on NEW only
```

Suppressed findings stay in the report (marked `"suppressed": true` in JSON) —
the baseline changes what *gates*, never what's *reported*. Matching uses the
same identity matcher as `diff`, so locator churn doesn't un-suppress an
accepted finding. When a baselined finding gets fixed, you get a stale-entry
warning (never a failure); re-run `--update-baseline` to prune, and `note`
fields you've added to entries survive the rewrite.

## Pages behind a login

Log in once and reuse the session — no password ever reaches the tool:

```sh
real-a11y login https://app.example.com --save auth.json   # log in by hand, press Enter
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

`auth.json` holds live session tokens — **gitignore it** (the `login` command
warns if you don't) and prefer a dedicated test account. Under a loaded
session, auditing is **pinned to the target's origin**: if a page redirects
off it, extraction is refused (a safeguard against a stray or hostile redirect
pulling an unintended authenticated page into your report) — pass
`--audit-origin <origin>` to allow a known SSO bounce. Session storage isn't
captured; for apps that keep auth there, attach to your signed-in Chrome with
`--cdp http://localhost:9222` instead (the interactive escape hatch).

## Output stability

- Exit codes `0/1/2` are frozen.
- `--format json` carries `schemaVersion`; within 0.x, changes are
  additive-only.
- Finding fingerprints (`v1:…`) are immutable per version — a future
  algorithm ships as `v2` alongside, never by mutating `v1`.
- Reports are deterministic: no timestamps, stable ordering, LF-only.
- Human output never conveys severity by color alone, and `NO_COLOR` /
  `FORCE_COLOR` are honored.
- Human output is English-only; machine formats are never localized (rule
  ids, severities, and JSON keys are frozen identifiers). Page content passes
  through in whatever language it's in.

No telemetry: the only network traffic is to the page you're auditing.

## What this is not

Not an axe replacement — the rules are semantic-tree checks (unlabeled
interactives, image alt, heading order, dialog labels, landmark structure);
pair with axe-core for contrast and rendered-visual checks. Not a test runner
(`@real-a11y-dev/testing` is the in-test surface). No crawling — you name the
pages.

Docs: <https://real-a11y.dev>
