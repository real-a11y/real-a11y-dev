---
title: "@real-a11y-dev/cli — commands & flags reference"
description: Every real-a11y command and flag — audit, inspect, snapshot, diff, login, and the shared browser / output / config / gate flags — each with type, default, and examples.
---

# Commands & flags

Every invocation is `real-a11y <command> [url...] [flags]`. Nine commands ship —
[`audit`](#audit-url), [`inspect`](#inspect-url), [`tree`](#tree-url),
[`outline`](#outline-url), [`tabs`](#tabs-url), [`list`](#list-category-url),
[`snapshot`](#snapshot-url), [`diff`](#diff-base-json-pr-json), and
[`login`](#login-url-save-file). Run `real-a11y <command> --help` for a
command's own flags.

Findings and reports go to **stdout**; progress, warnings, and errors go to
**stderr** — so `-o` / a pipe never mixes the two.

**Exit codes are frozen:**

| Code | Meaning |
| --- | --- |
| `0` | Clean — no findings at or above [`--fail-on`](#fail-on-level). |
| `1` | Findings at or above the threshold (the CI gate). |
| `2` | Usage or navigation error. |

View commands ([`tree`](#tree-url), [`outline`](#outline-url),
[`tabs`](#tabs-url), [`list`](#list-category-url)) aren't gates — they exit `0`
unless something actually failed.

**Environment variables:**

- **`A11Y_PAGES`** — a JSON `[{ "name": …, "url": … }]` array, the page set for
  [`audit`](#audit-url) and [`snapshot`](#snapshot-url) when no URL is passed.
- **`A11Y_SNAPSHOT_OUT`** — default output path for [`snapshot`](#snapshot-url)
  when [`-o`](#o-output-file) is omitted.

Human (`pretty`) output is **English-only** and may be reworded between
releases. The machine formats — `json`, `sarif`, `junit`, `jsonl`, and the
`v1:` fingerprints — are a **frozen contract**: within `0.x`, changes are
additive-only. Never rely on the wording of a `pretty` line; key on the JSON.

## Commands

Each command below lists the flag **groups** it accepts. Shared flags are
documented once, in [Flags](#browser-page) — the per-command list only links
to them, plus any command-specific flags.

### `audit <url...>`

The flagship gate. Audits one or more pages against the semantic-tree rules and
prints violations grouped by rule — each with a CSS **locator** and
**severity**. Exits `1` on errors with no extra flags. A failed page becomes an
`error` entry (exit `2`) while the others still report. Under GitHub Actions it
also emits grouped `::error` annotations and a job summary.

With no URL, it audits every entry in `A11Y_PAGES` or the config's `urls`.

```sh
real-a11y audit http://localhost:3000
real-a11y audit https://stage.example.com --device "iPhone 13" --fail-on warning
real-a11y audit ./dist/index.html --format json -o report.json
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) ·
[Config](#config) · [`--rules`](#rules-ids) · [`--fail-on`](#fail-on-level)
(default `error`) · [`--no-annotate`](#no-annotate).

### `inspect <url>`

Findings **plus** the semantic tree, heading outline, and tab order — all from
**one** extraction, so the views can never disagree. Views print first; the gate
outcome is the last thing on screen. Single URL.

```sh
real-a11y inspect http://localhost:3000
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) ·
[Config](#config) · [`--rules`](#rules-ids) · [`--fail-on`](#fail-on-level)
(default `error`) · [`--no-annotate`](#no-annotate) ·
[`--include-generic`](#include-generic).

### `tree <url>`

Print the semantic tree — what a screen reader perceives, role by role. Single
URL; always exits `0`.

```sh
real-a11y tree https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config) · [`--include-generic`](#include-generic).

### `outline <url>`

Print the heading outline (h1–h6) in document order. Single URL; always exits
`0`.

```sh
real-a11y outline https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config).

### `tabs <url>`

Print every focusable element in keyboard **Tab** order. Single URL; always
exits `0`.

```sh
real-a11y tabs https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config).

### `list <category> <url>`

List every element in one category — as role, accessible name, and locator. The
category is the first positional; the URL follows. Single URL; always exits `0`.

Categories: `heading`, `link`, `button`, `form`, `landmark`, `image`.

```sh
real-a11y list image https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config).

### `snapshot [url...]`

Audit a page set and write **one** JSON artifact — fingerprinted findings plus
the tree/outline/tabs views per page. That artifact is the input to
[`diff`](#diff-base-json-pr-json).

Pages, in precedence order: positional URLs, else `A11Y_PAGES`, else the config's
`urls` ([`--config`](#config-file) or auto-discovered). Output goes to
[`-o`](#o-output-file), else `A11Y_SNAPSHOT_OUT`, else stdout. Unlike the other
gates, [`--fail-on`](#fail-on-level) defaults to `never` here — snapshot just
writes the artifact unless you ask it to gate.

```sh
real-a11y snapshot https://example.com -o base.json
real-a11y snapshot --config a11y.config.json --md -o report.md
real-a11y snapshot --config a11y.config.json --update-baseline
real-a11y snapshot --config a11y.config.json --baseline .a11y-baseline.json --fail-on error
```

**Flags:** [Browser & page](#browser-page) · [Config](#config) ·
[`--rules`](#rules-ids) · [`--fail-on`](#fail-on-level) (default `never`) ·
[`--include-generic`](#include-generic) ·
[`-f, --format`](#f-format-fmt) (`json | md | sarif | junit | jsonl`) ·
[`--md`](#md) · [`--baseline`](#baseline-file) ·
[`--update-baseline`](#update-baseline) · [`-o, --output`](#o-output-file) ·
[`-q, --quiet`](#q-quiet) · [`--verbose`](#verbose) · [`-h, --help`](#h-help).

### `diff <base.json> <pr.json>`

Classify the findings in two snapshot artifacts as **new / changed / fixed** —
robust to DOM churn (re-indentation, renumbered locators) that defeats a line
diff. Pure: no browser. Takes exactly two positional files. Exits `1` **only**
on NEW findings at or above [`--fail-on`](#fail-on-level); fixes and drift never
fail the build.

Default output is neutral — findings plus a real unified diff of the structure.
Add [`--explain`](#explain) for a plain-language summary, or filter one axis's
detail with [`--findings-only`](#findings-only) / [`--views-only`](#views-only)
(output filters — the exit gate is unchanged).

```sh
real-a11y diff base.json pr.json
real-a11y diff base.json pr.json --explain
real-a11y diff base.json pr.json --findings-only
real-a11y diff base.json pr.json --format md --explain --max-pages 5 --max-lines 20 -o comment.md
```

**Flags:** [Config](#config) · [`--fail-on`](#fail-on-level) (default `error`) ·
[`--explain`](#explain) · [`--findings-only`](#findings-only) ·
[`--views-only`](#views-only) · [`--max-lines`](#max-lines-n) ·
[`--max-pages`](#max-pages-n) · [`--baseline`](#baseline-file) ·
[`--ignore-view-line`](#ignore-view-line-regex) ·
[`-f, --format`](#f-format-fmt) (`pretty | json | md`) ·
[`-o, --output`](#o-output-file) · [`-q, --quiet`](#q-quiet) ·
[`--verbose`](#verbose) · [`-h, --help`](#h-help).

### `login <url> --save <file>`

Open a visible browser, log in by hand — MFA, SSO, and passkeys all work,
because a human is driving — then press **Enter** to save the session to a file
you can later pass to [`--storage-state`](#storage-state-file). Interactive by
construction: it needs a TTY and fails fast in CI. Forces headful; no
device/viewport emulation, format, or output flags. The saved file holds live
session tokens — keep it out of version control (the command warns if it isn't).

```sh
real-a11y login https://app.example.com --save auth.json
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

**Flags:** [`--save`](#save-file) (required) · [`--wait-until`](#wait-until-state)
· [`--settle`](#settle-ms) · [`--timeout`](#timeout-ms) · [Config](#config) ·
[`--verbose`](#verbose) · [`-h, --help`](#h-help).

## Flags

Grouped and documented once. The **Commands** line above each entry names which
commands accept it. An explicit flag always wins over an `a11y.config.json`
default; see [Configure once](/packages/cli#configure-once).

## Browser & page

Control the browser that renders the page before extraction. Accepted by every
browser-driving command — [`audit`](#audit-url), [`inspect`](#inspect-url),
[`tree`](#tree-url), [`outline`](#outline-url), [`tabs`](#tabs-url),
[`list`](#list-category-url), [`snapshot`](#snapshot-url). [`login`](#login-url-save-file)
takes only the settling flags ([`--wait-until`](#wait-until-state),
[`--settle`](#settle-ms), [`--timeout`](#timeout-ms)) and forces headful.

### `--root <selector>`

- **Type:** CSS selector · **Default:** `body` · **Commands:** audit, inspect,
  tree, outline, tabs, list

Scope extraction to a region or component instead of the whole page.
[`snapshot`](#snapshot-url) accepts the flag but scopes each page via its config
`rootSelector` instead.

```sh
real-a11y tree http://localhost:3000 --root "#app main"
```

### `--device <name>`

- **Type:** Playwright device name · **Default:** none · **Commands:** audit,
  inspect, tree, outline, tabs, list, snapshot

Emulate a device — viewport, user agent, touch — to audit the mobile layout.
Can't be combined with [`--cdp`](#cdp-endpoint).

```sh
real-a11y audit http://localhost:3000 --device "iPhone 13"
```

### `--viewport <WxH>`

- **Type:** `WIDTHxHEIGHT` · **Default:** none · **Commands:** audit, inspect,
  tree, outline, tabs, list, snapshot

Explicit viewport size. Must match `^\d+x\d+$`, e.g. `1280x800`. Can't be
combined with [`--cdp`](#cdp-endpoint).

### `--wait-until <state>`

- **Type:** `load | domcontentloaded | networkidle | commit` · **Default:**
  `load` · **Commands:** audit, inspect, tree, outline, tabs, list, snapshot,
  login

The navigation lifecycle event to wait for before extracting. Use `networkidle`
for JS-heavy pages that keep fetching after `load`.

### `--settle <ms>`

- **Type:** integer ms · **Default:** `0` · **Max:** `30000` (clamped) ·
  **Commands:** audit, inspect, tree, outline, tabs, list, snapshot, login

Extra wait after the [`--wait-until`](#wait-until-state) state, for animations or
late hydration. Values above the max are clamped; a non-integer is an error.

```sh
real-a11y audit http://localhost:3000 --wait-until networkidle --settle 500
```

### `--timeout <ms>`

- **Type:** integer ms · **Default:** `30000` · **Min:** `1` · **Max:** `120000`
  (clamped) · **Commands:** audit, inspect, tree, outline, tabs, list, snapshot,
  login

Navigation timeout. Unlike Playwright, `0` is **not** accepted (no "wait
forever"); values above the max are clamped.

### `--headful`

- **Type:** boolean · **Default:** `false` (headless) · **Commands:** audit,
  inspect, tree, outline, tabs, list, snapshot

Show the browser window. Can't be combined with [`--cdp`](#cdp-endpoint).
[`login`](#login-url-save-file) is always headful.

### `--cdp <endpoint>`

- **Type:** CDP endpoint URL · **Default:** none · **Commands:** audit, inspect,
  tree, outline, tabs, list, snapshot

Attach to a running Chrome instead of launching one — the interactive way to
audit a login. No emulation over CDP: can't be combined with
[`--headful`](#headful), [`--device`](#device-name),
[`--viewport`](#viewport-wxh), or [`--storage-state`](#storage-state-file).

### `--allow-file`

- **Type:** boolean · **Default:** `false` · **Commands:** audit, inspect, tree,
  outline, tabs, list, snapshot

Approve `file:` targets, which are blocked by default. Real, but omitted from
`--help`. A path you type (`./dist/index.html`) is normalized to a `file:` URL,
so this is what unlocks auditing a built file.

### `--storage-state <file>`

- **Type:** path to a saved session · **Default:** none · **Commands:** audit,
  inspect, tree, outline, tabs, list, snapshot

Audit as a logged-in user, using a session file written by
[`login`](#login-url-save-file). Can't be combined with [`--cdp`](#cdp-endpoint).
See [Authenticated pages](/guide/authenticated-pages).

```sh
real-a11y login https://app.example.com --save auth.json
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

### `--audit-origin <origin>`

- **Type:** origin (repeatable) · **Default:** the target's own origin ·
  **Commands:** audit, inspect, tree, outline, tabs, list, snapshot

An extra origin allowed under [`--storage-state`](#storage-state-file). Origin
pinning stops a redirect from routing extraction to an unintended,
cookie-matching origin. Repeat for each additional origin; must parse as a URL.

```sh
real-a11y audit https://app.example.com --storage-state auth.json \
  --audit-origin https://accounts.example.com
```

## Output

Format and destination. `-o` / a pipe never suppresses progress — that always
stays on stderr.

### `-f, --format <fmt>`

- **Type:** enum (per command) · **Default:** first value below · **Commands:**
  audit, inspect, tree, outline, tabs, list, snapshot, diff

Never auto-switched — piping only drops color. Allowed values depend on the
command:

| Command | Values | Default |
| --- | --- | --- |
| audit, inspect, tree, outline, tabs, list | `pretty` \| `json` | `pretty` |
| diff | `pretty` \| `json` \| `md` | `pretty` |
| snapshot | `json` \| `md` \| `sarif` \| `junit` \| `jsonl` | `json` |

`sarif` requires [`--config`](#config-file) (results anchor to repo file paths).
See [SARIF, JUnit, JSONL](/packages/cli#sarif-junit-jsonl).

### `-o, --output <file>`

- **Type:** path · **Default:** stdout · **Commands:** audit, inspect, tree,
  outline, tabs, list, snapshot, diff

Write the report to a file (progress stays on stderr). A typo'd path fails before
the browser launches, not after. For [`snapshot`](#snapshot-url), `A11Y_SNAPSHOT_OUT`
is the fallback when this is omitted.

### `-q, --quiet`

- **Type:** boolean · **Default:** `false` · **Commands:** audit, inspect, tree,
  outline, tabs, list, snapshot, diff

Suppress progress lines on stderr.

### `--verbose`

- **Type:** boolean · **Default:** `false` · **Commands:** all

Extra diagnostics on stderr (per-page timings, and more).

### `-h, --help`

- **Type:** boolean · **Commands:** all

Print that command's usage and flags, then exit `0`. `real-a11y --help` with no
command prints the command list.

## Config

An `a11y.config.json` seeds any flag you don't pass — the Jest/ESLint model.
Accepted by **every** command.

### `--config <file>`

- **Type:** path · **Default:** auto-discovered `a11y.config.json` in cwd ·
  **Commands:** all

Point at a config elsewhere. Its `defaults` block seeds unset flags; its `urls`
list is the page set for [`audit`](#audit-url) and [`snapshot`](#snapshot-url)
(`diff` reads two snapshot files, so it only takes `defaults` from the config).
The config is strict and fail-closed — a typo'd key is a hard error, so a
mistake can't silently un-gate CI. See
[Configure once](/packages/cli#configure-once).

### `--no-config`

- **Type:** boolean · **Default:** `false` · **Commands:** all

Ignore an auto-discovered config for this run.

## Gate

Which rules run, and what fails the build.

### `--rules <ids>`

- **Type:** comma-separated ids · **Default:** all five · **Commands:** audit,
  inspect, snapshot

Run only a subset of the rules. Valid ids: `no-unlabeled-interactive`,
`image-alt`, `heading-order`, `dialog-labeled`, `landmark-structure`. An unknown
id is a hard error.

```sh
real-a11y audit http://localhost:3000 --rules no-unlabeled-interactive,image-alt
```

### `--fail-on <level>`

- **Type:** `error | warning | never` · **Default:** `error` (audit, inspect,
  diff) · `never` (snapshot) · **Commands:** audit, inspect, snapshot, diff

The gate threshold. `error` exits `1` on any error; `warning` also fails on
warnings; `never` never fails the build (it still reports). For
[`diff`](#diff-base-json-pr-json), only **NEW** findings at or above the
threshold gate — drift and fixes never fail.

### `--no-annotate`

- **Type:** boolean · **Default:** annotate on · **Commands:** audit, inspect

Skip the GitHub Actions `::error` annotations and job-summary report that
[`audit`](#audit-url) and [`inspect`](#inspect-url) emit when running under
Actions.

## Command-specific

Flags that belong to a single command (or a small set).

### `--include-generic`

- **Type:** boolean · **Default:** `false` · **Honored by:**
  [`tree`](#tree-url), [`inspect`](#inspect-url)

Include generic container nodes (untyped `div`/`span` wrappers) in the semantic
tree, which are collapsed away by default. Only the commands that print a full
tree honor it. [`snapshot`](#snapshot-url), [`outline`](#outline-url),
[`tabs`](#tabs-url), and [`list`](#list-category-url) accept the flag but ignore
it — snapshot's artifact tree always collapses generics.

### `--md`

- **Type:** boolean · **Default:** `false` · **Commands:** snapshot

Shorthand for [`--format md`](#f-format-fmt) — a human-readable report instead of
the JSON artifact. Conflicts with an explicit non-`md` `--format`.

### `--baseline <file>`

- **Type:** path · **Default:** none · **Commands:** snapshot, diff

Suppress findings this baseline accepts: they stay in the report (marked
`"suppressed": true`) but drop out of the [`--fail-on`](#fail-on-level) count
(and SARIF). Identity-matched, not string-matched. See
[Adopt the gate on existing debt](/packages/cli#adopt-the-gate-on-existing-debt).

### `--update-baseline`

- **Type:** boolean · **Default:** `false` · **Commands:** snapshot

Rewrite the baseline from the current findings, then **stop** — it writes the
baseline file (`.a11y-baseline.json`, or [`--baseline`](#baseline-file)'s path)
and never gates. Prints `+N new, -N stale` on stderr and carries forward `note`
fields on entries that still match.

```sh
real-a11y snapshot --config a11y.config.json --update-baseline
```

### `--explain`

- **Type:** boolean · **Default:** `false` · **Commands:** diff

Add a plain-language summary of structural changes ("Heading level changed:
h2 → h3", "Keyboard tab stop removed …") to the neutral diff. Opt-in because the
statements are an interpretive layer; the default never makes a claim the diff
can't back up. Advisory only — it never affects the exit code.

This includes a **`Focused element changed: … → …`** statement when the element
focused at capture time differs between the two snapshots (a moved autofocus
target, or focus that appeared or vanished). Because focus isn't structure, it's
excluded from the structural diff — a page where _only_ focus moved shows no
add/remove churn, just this one statement.

Conflicts with [`--findings-only`](#findings-only), which hides the structural
views the statements summarize.

### `--findings-only`

- **Type:** boolean · **Default:** `false` · **Commands:** diff

Show only the findings delta (new / changed / fixed) — hide the structural view
diff. An **output filter**: the exit gate is computed from the full result
either way, and `--format json` omits the `views`/`structural` arrays while
keeping the per-page `structuralDiff` boolean and the summary.

Mutually exclusive with [`--views-only`](#views-only); conflicts with
[`--explain`](#explain) (its statements summarize the views this flag hides —
if you didn't pass `--explain`, check your `a11y.config.json` defaults).

```sh
real-a11y diff base.json pr.json --findings-only
```

### `--views-only`

- **Type:** boolean · **Default:** `false` · **Commands:** diff

Show only the structural view diff — hide the per-finding detail. The one-line
findings summary still prints and **the exit gate still runs on NEW findings**,
so a `--views-only` run in CI can exit `1` while showing no finding entries;
the summary line is what explains it. In `--format json` the `new`/`changed`/
`removed` arrays are omitted; the summary stays.

Mutually exclusive with [`--findings-only`](#findings-only); composes with
[`--explain`](#explain).

```sh
real-a11y diff base.json pr.json --views-only --explain
```

### `--ignore-view-line <regex>`

- **Type:** JS regex (repeatable) · **Default:** none · **Commands:** diff

Drop view lines matching the pattern before diffing — for generated content that
differs on every build (a "last updated" timestamp, a build hash) and would
otherwise read as drift on every page. Each value must be a valid `RegExp`.

```sh
real-a11y diff base.json pr.json --ignore-view-line '^time "'
```

### `--max-lines <n>`

- **Type:** positive integer · **Default:** full · **Commands:** diff

Cap the structural diff to _n_ lines per page, then `… N more`. For CI comments —
run once uncapped to a log and once capped to the comment.

### `--max-pages <n>`

- **Type:** positive integer · **Default:** all · **Commands:** diff

Detail at most _n_ changed pages, then list the rest by name. For CI comments.

```sh
real-a11y diff base.json pr.json --explain --max-pages 5 --max-lines 20 -o comment.md
```

### `--save <file>`

- **Type:** path · **Default:** none (**required**) · **Commands:** login

Where [`login`](#login-url-save-file) writes the captured session. Written
`0o600` (POSIX); the command warns if the path sits un-gitignored inside a repo.
Session storage isn't captured — apps that keep auth there need
[`--cdp`](#cdp-endpoint) instead.

```sh
real-a11y login https://app.example.com --save auth.json
```
