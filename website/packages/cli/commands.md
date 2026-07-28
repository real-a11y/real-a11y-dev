---
title: "@real-a11y-dev/cli — commands & flags reference"
description: Every real-a11y command and flag — audit, inspect, snapshot, diff, login, and the shared browser / output / config / gate flags — each with type, default, and examples.
---

# Commands & flags

Every invocation is `real-a11y <command> [url...] [flags]`. Fourteen commands
ship — [`install`](#install), [`audit`](#audit-url), [`inspect`](#inspect-url),
[`tree`](#tree-url), [`outline`](#outline-url), [`tabs`](#tabs-url),
[`list`](#list-category-url), [`interact`](#interact-url-step-step),
[`click`](#click-url-role-role), [`type`](#type-url-role-role-text-value),
[`focus`](#focus-url-role-role), [`snapshot`](#snapshot-url),
[`diff`](#diff-base-json-pr-json), and [`login`](#login-url-save-file). Run
`real-a11y <command> --help` for a command's own flags.

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
unless something actually failed. Neither are the act commands
([`interact`](#interact-url-step-step), [`click`](#click-url-role-role),
[`type`](#type-url-role-role-text-value), [`focus`](#focus-url-role-role)):
they exit `0` when every step lands, and `2` when one can't be reached.

**Environment variables:**

- **`A11Y_PAGES`** — a JSON `[{ "name": …, "url": … }]` array, the page set for
  [`audit`](#audit-url) and [`snapshot`](#snapshot-url) when no URL is passed.
- **`A11Y_SNAPSHOT_OUT`** — default output path for [`snapshot`](#snapshot-url)
  when [`-o`](#o-output-file) is omitted.

Human (`pretty`) output is **English-only** and may be reworded between
releases. The machine formats — `json`, `sarif`, `junit`, `jsonl`, and the
`v1:` fingerprints — are a **frozen contract**: within `0.x`, changes are
additive-only. Never rely on the wording of a `pretty` line; key on the JSON.

## All commands at a glance

Every browser-driving command reads **Chromium's own accessibility tree** over
CDP, except [`tabs`](#tabs-url) — the one view that tree cannot produce (see
[`--root`](#root-selector)). Click a command for its flags.

**Setup**

| Command | Purpose |
| --- | --- |
| [`install`](#install) | Download Chrome for Testing into Real A11y's own cache — run once. |
| [`login <url> --save <file>`](#login-url-save-file) | Log in by hand and save the session for `--storage-state`. |

**Audit** — the gates: these exit `1` on findings at or above [`--fail-on`](#fail-on-level).

| Command | Purpose |
| --- | --- |
| [`audit <url...>`](#audit-url) | Every violation, grouped by rule with locator + severity — the flagship. |
| [`inspect <url>`](#inspect-url) | Findings **plus** tree + outline from one read. |

**Views** — never gates; they exit `0` unless something actually failed.

| Command | Purpose |
| --- | --- |
| [`tree <url>`](#tree-url) | The semantic tree — role + accessible name, as a screen reader traverses it. |
| [`outline <url>`](#outline-url) | Heading outline (h1–h6) in document order. |
| [`tabs <url>`](#tabs-url) | Focusable elements in keyboard Tab order — the one in-page read. |
| [`list <category> <url>`](#list-category-url) | One category — heading, link, button, form, landmark, image. |

**Act** — Chromium only. Exit `0` when every step lands, `2` when one can't be reached.

| Command | Purpose |
| --- | --- |
| [`interact <url> --step`](#interact-url-step-step) | Run ordered steps, then print the tree diff they produced. |
| [`click <url> --role`](#click-url-role-role) | Real click at the element matched by role + accessible name. |
| [`type <url> --role --text`](#type-url-role-role-text-value) | Replace a text field's value; the value is never echoed back. |
| [`focus <url> --role`](#focus-url-role-role) | Move real keyboard focus; the `[focused]` marker moves in the diff. |

**Artifacts**

| Command | Purpose |
| --- | --- |
| [`snapshot [url...]`](#snapshot-url) | Audit a page set → one diffable JSON artifact (or `--md`). |
| [`diff <base.json> <pr.json>`](#diff-base-json-pr-json) | Findings-aware diff of two artifacts — new / changed / fixed. Pure: no browser. |

## Commands

Each command below lists the flag **groups** it accepts. Shared flags are
documented once, in [Flags](#browser-page) — the per-command list only links
to them, plus any command-specific flags.

### `install`

Download [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing)
— Google's versioned, non-auto-updating Chrome build — into Real A11y's own
cache and use it for every launched session from then on. A setup command: it
takes no URL and doesn't drive a browser itself. Idempotent — a bare re-run
does zero network work and exits `0` instantly when the cached build is still
present. Prints the resolved executable path on **stdout**; progress goes to
stderr.

```sh
real-a11y install                           # latest Stable, first time only
real-a11y install --channel beta            # track a channel
real-a11y install --version 131.0.6778.87   # exact build — works even if the
                                             # Chrome for Testing version
                                             # endpoint is unreachable
real-a11y install --force                   # reinstall even if already present
```

Playwright (the npm package) is still the driver — this replaces only the
`npx playwright install chromium` browser download. Every browser-driving
command then picks it up automatically; see
[`--chrome-path`](#chrome-path-file) for the full resolution order. Sessions
launched with [`--cdp`](#cdp-endpoint) attach to your own Chrome and never use
this binary.

**Flags:** [`--channel`](#channel-name) · [`--version`](#version-buildid) ·
[`--force`](#force) · [Config](#config) · [`-q, --quiet`](#q-quiet) ·
[`--verbose`](#verbose) · [`-h, --help`](#h-help).

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
(default `error`) · [`--no-annotate`](#no-annotate) ·
no `--root`.

### `inspect <url>`

Findings **plus** the semantic tree and heading outline — all from **one** read
of Chromium's own accessibility tree, so the views can never disagree, and the
findings always agree with [`audit`](#audit-url). Views print first; the gate
outcome is the last thing on screen. Single URL.

That tree carries no tab order, so this command prints none — and prints no
empty section either, which would read as *nothing here is focusable*. Run
[`tabs`](#tabs-url) for the sequence.

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
real-a11y tree https://example.com/player   # reaches user-agent-shadow media controls
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config) · [`--include-generic`](#include-generic) · no `--root`.

### `outline <url>`

Print the heading outline (h1–h6) in document order. Single URL; always exits
`0`.

```sh
real-a11y outline https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config) · no `--root`.

### `tabs <url>`

Print every focusable element in keyboard **Tab** order. Single URL; always
exits `0`.

The one command still built from the **in-page DOM walk**, and the only one that
takes [`--root`](#root-selector). Chromium's accessibility tree knows whether a
node is focusable, but not the *sequence* — `tabindex` never reaches a native
node — so tab order is DOM work by nature, not a fallback.

```sh
real-a11y tabs https://example.com
real-a11y tabs https://example.com --root "#app main"
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config) · [`--root`](#root-selector).

### `list <category> <url>`

List every element in one category — as role, accessible name, and locator. The
category is the first positional; the URL follows. Single URL; always exits `0`.

Categories: `heading`, `link`, `button`, `form`, `landmark`, `image`.

```sh
real-a11y list image https://example.com
```

**Flags:** [Browser & page](#browser-page) · [Output](#output) (`pretty | json`)
· [Config](#config).

### `interact <url> --step '<step>'`

Drive a page through one or more steps, then print the **accessibility-tree
diff** those steps produced — the answer to "what did that actually change for
a screen reader?". Steps run in order and stop at the first failure. Single
URL; exits `0` when every step lands, `2` on a usage error or an unreachable
target. **Chromium only.**

A step is written the way the tree prints a node:

```
<verb> <role> ["<name>"] [nth=<n>] [= <text>]
```

- **verbs** — `click`, `type`, `focus`.
- **`"<name>"`** — the accessible name. Omit it to match any name; pass `""` to
  target an **unlabeled** control (the one an audit just flagged).
- **`nth=<n>`** — 1-based, document order. It's the spelling the ambiguity
  error prints, so the fix is copy-paste.
- **`= <text>`** — `type` only. Everything after the first `=` is the value, so
  query strings and base64 need no escaping.

```sh
real-a11y interact http://localhost:3000 --step 'click button "Open menu"'

real-a11y interact http://localhost:3000 \
  --step 'type textbox "Email" = someone@example.com' \
  --step 'click button "Sign in"'

real-a11y interact https://example.com --step 'click button "Save" nth=2'
```

Targets resolve against **Chromium's own** accessibility tree by role +
accessible name — never a CSS selector. If a control can't be reached that way,
assistive technology can't reach it either, and that is an accessibility
finding rather than a targeting inconvenience. Ambiguous matches list their
`nth=` candidates; a **disabled** target is refused, because the click would be
swallowed and the resulting empty diff would read as "that button does
nothing".

::: warning The actions are real
They submit forms, toggle state, and can **navigate**. A step that loads a new
document leaves the tree captured before it describing a page that no longer
exists, so no diff is possible — the run still succeeds and reports where it
landed.
:::

Targeting, acting, and the diff all read the **same** tree — Chromium's own,
over CDP. A node you aim at by one name therefore can't come back in the report
under another. That tree is whole-document, which is why these commands take
no [`--root`](#root-selector).

A typed value is **never echoed** — not in progress output, not in
[`--format json`](#f-format-fmt), where the step renders as `= ‹hidden›`. Don't
use `type` to log in: a password on the command line is visible to other
processes and lands in your shell history. Use [`login`](#login-url-save-file).

Under [`--format json`](#f-format-fmt) the page object carries `steps` (the
steps that ran, rendered and redacted), `diff`, and `navigated` — the last so a
script can tell a new document was loaded (so there is no diff) without
matching prose.
`url` is the address the page **landed** on, which differs from the one you
passed when a step navigated.

**Flags:** `--step '<step>'` (repeatable, required) ·
[`--step-settle`](#step-settle-ms) ·
[Browser & page](#browser-page) (no `--root`) ·
[Output](#output)
(`pretty | json`) · [Config](#config).

### `click <url> --role <role>`

Dispatch a real click at the element matched by role + accessible name, then
print the tree diff. Shorthand for a one-step
[`interact`](#interact-url-step-step), and bound by the same contract.

```sh
real-a11y click http://localhost:3000 --role button --name "Open menu"
real-a11y click http://localhost:3000 --role button --name "Save" --nth 2
real-a11y click http://localhost:3000 --role button --name ""   # unlabeled
```

**Flags:** `--role` (required) · `--name` · `--nth` ·
[`--step-settle`](#step-settle-ms) ·
[Browser & page](#browser-page) (no `--root`) ·
[Output](#output)
(`pretty | json`) · [Config](#config).

### `type <url> --role <role> --text <value>`

Replace a text field's value (role is usually `textbox`, `searchbox`, or
`combobox`), then print the tree diff — a combobox popping its options, an
inline validation error appearing. The value is written through the element's
own prototype setter plus `input`/`change` events, so framework-controlled
inputs (React et al.) register it.

```sh
real-a11y type http://localhost:3000 --role textbox --name "Email" --text you@example.com
```

The value is never echoed back, in any format. Don't use it to log in — see
[`login`](#login-url-save-file).

**Flags:** `--role` (required) · `--text` (required) · `--name` · `--nth` ·
[`--step-settle`](#step-settle-ms) ·
[Browser & page](#browser-page) (no `--root`) ·
[Output](#output)
(`pretty | json`) · [Config](#config).

### `focus <url> --role <role>`

Move real keyboard focus to the matched element, then print the tree diff — the
focus move shows as the `[focused]` marker relocating. Pairs with
[`tabs`](#tabs-url) for focus-order work.

```sh
real-a11y focus http://localhost:3000 --role textbox --name "Email"
```

**Flags:** `--role` (required) · `--name` · `--nth` ·
[`--step-settle`](#step-settle-ms) ·
[Browser & page](#browser-page) (no `--root`) ·
[Output](#output)
(`pretty | json`) · [Config](#config).

### `snapshot [url...]`

Audit a page set and write **one** JSON artifact — fingerprinted findings plus
the tree and outline views per page, with `meta.views` recording which views the
run measured. That artifact is the input to [`diff`](#diff-base-json-pr-json).

There is no tabs view: this reads Chromium's whole-document accessibility tree,
which carries no tab order. The artifact omits the view rather than storing an
empty one, so a diff reads it as *not measured* instead of *every tab stop was
removed*. `real-a11y tabs` is the keyboard sequence.

Pages, in precedence order: positional URLs, else `A11Y_PAGES`, else the config's
`urls` ([`--config`](#config-file) or auto-discovered). Output goes to
[`-o`](#o-output-file), else `A11Y_SNAPSHOT_OUT`, else stdout. Unlike the other
gates, [`--fail-on`](#fail-on-level) defaults to `never` here — snapshot just
writes the artifact unless you ask it to gate.

```sh
real-a11y snapshot https://example.com -o base.json
real-a11y snapshot --config a11y.config.json --md -o report.md
real-a11y snapshot https://example.com --md --only views -o views.md
real-a11y snapshot --config a11y.config.json --update-baseline
real-a11y snapshot --config a11y.config.json --baseline .a11y-baseline.json --fail-on error
```

**Flags:** [Browser & page](#browser-page) · [Config](#config) ·
[`--rules`](#rules-ids) · [`--fail-on`](#fail-on-level) (default `never`) ·
[`--include-generic`](#include-generic) ·
[`-f, --format`](#f-format-fmt) (`json | md | sarif | junit | jsonl`) ·
[`--md`](#md) · [`--only`](#only-axis) (`findings | views`, md-report-only) ·
[`--baseline`](#baseline-file) ·
[`--update-baseline`](#update-baseline) · [`-o, --output`](#o-output-file) ·
[`-q, --quiet`](#q-quiet) · [`--verbose`](#verbose) · [`-h, --help`](#h-help).

### `diff <base.json> <pr.json>`

Classify the findings in two snapshot artifacts as **new / changed / fixed** —
robust to DOM churn (re-indentation, renumbered locators) that defeats a line
diff. Pure: no browser. Takes exactly two positional files. Exits `1` **only**
on NEW findings at or above [`--fail-on`](#fail-on-level); fixes and drift never
fail the build.

Default output is neutral — findings plus a real unified diff of the structure.
Add [`--explain`](#explain) for a plain-language summary, or report a single
axis with [`--only findings | views`](#only-axis) (an output filter — the exit
gate is unchanged).

Pages are matched by their `name`, never by URL — base and PR legitimately run on
different hosts and ports. A page whose name is on only one side is reported as
added or removed and is never compared. Since a bare `urls` entry (or a
positional `snapshot` URL) takes the URL as its name, snapshotting the two sides
from different origins leaves nothing to join on: give the pages explicit names
(config `urls` entries, or `A11Y_PAGES` as `[{ name, url }]`) so both runs agree.
If no name matches at all, `diff` warns on stderr that it compared nothing — the
report and exit code are unaffected.

```sh
real-a11y diff base.json pr.json
real-a11y diff base.json pr.json --explain
real-a11y diff base.json pr.json --only findings
real-a11y diff base.json pr.json --format md --explain --max-pages 5 --max-lines 20 -o comment.md
```

**Flags:** [Config](#config) · [`--fail-on`](#fail-on-level) (default `error`) ·
[`--explain`](#explain) · [`--only`](#only-axis) (`findings | views`) ·
[`--max-lines`](#max-lines-n) ·
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

### All flags at a glance

Throughout this table, **browser commands** is the eleven that drive a page:
[`audit`](#audit-url), [`inspect`](#inspect-url), [`tree`](#tree-url),
[`outline`](#outline-url), [`tabs`](#tabs-url), [`list`](#list-category-url),
[`interact`](#interact-url-step-step), [`click`](#click-url-role-role),
[`type`](#type-url-role-role-text-value), [`focus`](#focus-url-role-role),
[`snapshot`](#snapshot-url).

**[Browser & page](#browser-page)**

| Flag | Type / values | Default | Commands |
| --- | --- | --- | --- |
| [`--root`](#root-selector) | CSS selector | `body` | [`tabs`](#tabs-url) only <sup>†</sup> |
| [`--device`](#device-name) | Playwright device name | none | browser commands |
| [`--viewport`](#viewport-wxh) | `WIDTHxHEIGHT` | none | browser commands |
| [`--wait-until`](#wait-until-state) | `load \| domcontentloaded \| networkidle \| commit` | `load` | browser commands · `login` |
| [`--settle`](#settle-ms) | ms | `0` | browser commands · `login` |
| [`--step-settle`](#step-settle-ms) | ms | `200` | the act commands |
| [`--timeout`](#timeout-ms) | ms | `30000` | browser commands · `login` |
| [`--headful`](#headful) | boolean | `false` | browser commands |
| [`--cdp`](#cdp-endpoint) | CDP endpoint URL | none | browser commands |
| [`--chrome-path`](#chrome-path-file) | path to a browser binary | none | browser commands |
| [`--allow-file`](#allow-file) | boolean | `false` | browser commands |
| [`--storage-state`](#storage-state-file) | path to a saved session | none | browser commands |
| [`--audit-origin`](#audit-origin-origin) | origin (repeatable) | the target's own | browser commands |
| [`--include-generic`](#include-generic) | boolean | `false` | `inspect`, `tree`, `outline`, `tabs`, `list`, `snapshot` |

<sup>†</sup> Every other browser command reads Chromium's whole-document
accessibility tree, so there is nothing for a selector to scope — they reject
`--root` with that explanation rather than accepting and ignoring it. There is
no `--producer` flag at all: each command has exactly one correct producer.

**[Output](#output)**

| Flag | Type / values | Default | Commands |
| --- | --- | --- | --- |
| [`-f, --format`](#f-format-fmt) | enum, per command | first value | browser commands · `diff` |
| [`-o, --output`](#o-output-file) | path | stdout | browser commands · `diff` |
| [`-q, --quiet`](#q-quiet) | boolean | `false` | browser commands · `diff` · `install` |
| [`--verbose`](#verbose) | boolean | `false` | all |
| [`-h, --help`](#h-help) | boolean | — | all |

**[Config](#config)**

| Flag | Type / values | Default | Commands |
| --- | --- | --- | --- |
| [`--config`](#config-file) | path to `a11y.config.json` | auto-discovered | all |
| [`--no-config`](#no-config) | boolean | `false` | all |

**[Gate](#gate)**

| Flag | Type / values | Default | Commands |
| --- | --- | --- | --- |
| [`--rules`](#rules-ids) | comma-separated rule ids | all rules | `audit`, `inspect`, `snapshot` |
| [`--fail-on`](#fail-on-level) | `error \| warning \| never` | `error` (`never` for `snapshot`) | `audit`, `inspect`, `snapshot`, `diff` |
| [`--no-annotate`](#no-annotate) | boolean | `false` | `audit`, `inspect` |

**Command-specific**

| Flag | Type / values | Default | Commands |
| --- | --- | --- | --- |
| [`--step`](#interact-url-step-step) | step string (repeatable, ordered) | — | `interact` (**required**) |
| [`--role`](#click-url-role-role) | ARIA role | — | `click`, `type`, `focus` (**required**) |
| [`--name`](#click-url-role-role) | accessible name; `""` = unlabeled | any name | `click`, `type`, `focus` |
| [`--nth`](#click-url-role-role) | positive integer, 1-based | — | `click`, `type`, `focus` |
| [`--text`](#type-url-role-role-text-value) | the value to enter | — | `type` (**required**; `click` / `focus` reject it) |
| [`--channel`](#channel-name) | `stable \| beta \| dev \| canary` | `stable` | `install` |
| [`--version`](#version-buildid) | exact Chrome build id | — | `install` |
| [`--force`](#force) | boolean | `false` | `install` |
| [`--save`](#save-file) | path | — | `login` (**required**) |
| [`--md`](#md) | boolean | `false` | `snapshot` |
| [`--only`](#only-axis) | `findings \| views` | both | `snapshot`, `diff` |
| [`--baseline`](#baseline-file) | path | none | `snapshot`, `diff` |
| [`--update-baseline`](#update-baseline) | boolean | `false` | `snapshot` |
| [`--explain`](#explain) | boolean | `false` | `diff` |
| [`--ignore-view-line`](#ignore-view-line-regex) | regex (repeatable) | none | `diff` |
| [`--max-lines`](#max-lines-n) | integer | full | `diff` |
| [`--max-pages`](#max-pages-n) | integer | all | `diff` |

## Browser & page

Control the browser that renders the page before extraction. Accepted by every
browser-driving command — [`audit`](#audit-url), [`inspect`](#inspect-url),
[`tree`](#tree-url), [`outline`](#outline-url), [`tabs`](#tabs-url),
[`list`](#list-category-url), [`interact`](#interact-url-step-step),
[`click`](#click-url-role-role), [`type`](#type-url-role-role-text-value),
[`focus`](#focus-url-role-role), [`snapshot`](#snapshot-url).
[`login`](#login-url-save-file) takes only the settling flags
([`--wait-until`](#wait-until-state), [`--settle`](#settle-ms),
[`--timeout`](#timeout-ms)) and forces headful.

### `--root <selector>`

- **Type:** CSS selector · **Default:** `body` · **Commands:**
  [`tabs`](#tabs-url) only

Scope the tab-order walk to a region or component instead of the whole page.

`tabs` is the last command that runs **in the page**, and a selector only means
something to an in-page walk. Every other browser command reads Chromium's own
accessibility tree, which is whole-document: there is no subtree to narrow to,
so they reject `--root` with that explanation rather than accepting it and
silently doing nothing.

```sh
real-a11y tabs http://localhost:3000 --root "#app main"
```

A project-wide [`defaults.root`](/packages/cli/configuration#defaults) now
reaches only `tabs`. On any other command it is **warned about on stderr, not
an error** — the config loader is otherwise strict and fail-closed, and
hard-erroring would red every CI that set the key, over config that was correct
when it was written.

A route's [`urls[].rootSelector`](/packages/cli/configuration#urls) is likewise
no longer a scope for [`audit`](#audit-url) or [`snapshot`](#snapshot-url).
Those warn once, naming the routes, and keep running: the entry is still how a
route is identified, and findings from outside the old subtree are now included.

### `--device <name>`

- **Type:** Playwright device name · **Default:** none · **Commands:** audit,
  inspect, tree, outline, tabs, list, interact, click, type, focus, snapshot

Emulate a device — viewport, user agent, touch — to audit the mobile layout.
Can't be combined with [`--cdp`](#cdp-endpoint).

```sh
real-a11y audit http://localhost:3000 --device "iPhone 13"
```

### `--viewport <WxH>`

- **Type:** `WIDTHxHEIGHT` · **Default:** none · **Commands:** audit, inspect,
  tree, outline, tabs, list, interact, click, type, focus, snapshot

Explicit viewport size. Must match `^\d+x\d+$`, e.g. `1280x800`. Can't be
combined with [`--cdp`](#cdp-endpoint).

### `--wait-until <state>`

- **Type:** `load | domcontentloaded | networkidle | commit` · **Default:**
  `load` · **Commands:** audit, inspect, tree, outline, tabs, list, interact, click,
  type, focus, snapshot, login

The navigation lifecycle event to wait for before extracting. Use `networkidle`
for JS-heavy pages that keep fetching after `load`.

### `--settle <ms>`

- **Type:** integer ms · **Default:** `0` · **Max:** `30000` (clamped) ·
  **Commands:** audit, inspect, tree, outline, tabs, list, interact, click,
  type, focus, snapshot, login

Extra wait after the [`--wait-until`](#wait-until-state) state, for animations or
late hydration. Values above the max are clamped; a non-integer is an error.

```sh
real-a11y audit http://localhost:3000 --wait-until networkidle --settle 500
```

### `--step-settle <ms>`

- **Type:** integer ms · **Default:** `200` · **Max:** `30000` (clamped) ·
  **Commands:** interact, click, type, focus

How long to wait after each step before looking at the page again. A dispatch
returning is not the same as its effect having landed: a React state update
flushes on a later tick, a dialog mounts on the next frame. It gates the *next*
step's targeting as much as the final diff — a step that opens a menu has to
have opened it before the step that clicks an item can find that item.

```sh
real-a11y interact http://localhost:3000 --step-settle 600 \
  --step 'click button "Open menu"' \
  --step 'click menuitem "Settings"'
```

`0` opts out and reads immediately. Distinct from [`--settle`](#settle-ms),
which waits once after the initial page load; this one applies per step.

::: warning A wait, not a guarantee
Nothing can tell you a page is *about* to navigate. A reaction that lands later
than this still won't appear in the diff — raise it for a slow app rather than
reading "no changes" as proof that nothing happened.
:::

### `--timeout <ms>`

- **Type:** integer ms · **Default:** `30000` · **Min:** `1` · **Max:** `120000`
  (clamped) · **Commands:** audit, inspect, tree, outline, tabs, list, interact, click,
  type, focus, snapshot, login

Navigation timeout. Unlike Playwright, `0` is **not** accepted (no "wait
forever"); values above the max are clamped.

### `--headful`

- **Type:** boolean · **Default:** `false` (headless) · **Commands:** audit,
  inspect, tree, outline, tabs, list, interact, click, type, focus, snapshot

Show the browser window. Can't be combined with [`--cdp`](#cdp-endpoint).
[`login`](#login-url-save-file) is always headful.

### `--cdp <endpoint>`

- **Type:** CDP endpoint URL · **Default:** none · **Commands:** audit, inspect,
  tree, outline, tabs, list, interact, click, type, focus, snapshot

Attach to a running Chrome instead of launching one — the interactive way to
audit a login. No emulation over CDP: can't be combined with
[`--headful`](#headful), [`--device`](#device-name),
[`--viewport`](#viewport-wxh), [`--storage-state`](#storage-state-file), or
[`--chrome-path`](#chrome-path-file).

### `--chrome-path <file>`

- **Type:** path to a browser executable · **Default:** none · **Commands:**
  audit, inspect, tree, outline, tabs, list, interact, click, type, focus,
  snapshot

Launch this specific browser binary instead of Playwright's bundled Chromium.
Can't be combined with [`--cdp`](#cdp-endpoint) — an already-running browser is
the browser. Resolution order (shared with the MCP server's
`REAL_A11Y_CHROME_PATH`): `--chrome-path` (error if missing) >
`REAL_A11Y_CHROME_PATH` env (error if missing) > the [`install`](#install)
cache (silently skipped if absent) > Playwright's own bundled Chromium.

```sh
real-a11y audit http://localhost:3000 --chrome-path /usr/bin/google-chrome
```

### `--allow-file`

- **Type:** boolean · **Default:** `false` · **Commands:** audit, inspect, tree,
  outline, tabs, list, interact, click, type, focus, snapshot

Approve `file:` targets, which are blocked by default. Real, but omitted from
`--help`. A path you type (`./dist/index.html`) is normalized to a `file:` URL,
so this is what unlocks auditing a built file.

### `--storage-state <file>`

- **Type:** path to a saved session · **Default:** none · **Commands:** audit,
  inspect, tree, outline, tabs, list, interact, click, type, focus, snapshot

Audit as a logged-in user, using a session file written by
[`login`](#login-url-save-file). Can't be combined with [`--cdp`](#cdp-endpoint).
See [Authenticated pages](/guide/authenticated-pages).

```sh
real-a11y login https://app.example.com --save auth.json
real-a11y audit https://app.example.com/dashboard --storage-state auth.json
```

### `--audit-origin <origin>`

- **Type:** origin (repeatable) · **Default:** the target's own origin ·
  **Commands:** audit, inspect, tree, outline, tabs, list, interact, click,
  type, focus, snapshot

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
  audit, inspect, tree, outline, tabs, list, interact, click, type, focus,
  snapshot, diff

Never auto-switched — piping only drops color. Allowed values depend on the
command:

| Command | Values |
| --- | --- |
| audit, inspect, tree, outline, tabs, list | `pretty` \| `json` | `pretty` |
| diff | `pretty` \| `json` \| `md` | `pretty` |
| snapshot | `json` \| `md` \| `sarif` \| `junit` \| `jsonl` | `json` |

`sarif` requires [`--config`](#config-file) (results anchor to repo file paths).
See [SARIF, JUnit, JSONL](/packages/cli#sarif-junit-jsonl).

### `-o, --output <file>`

- **Type:** path · **Default:** stdout · **Commands:** audit, inspect, tree,
  outline, tabs, list, interact, click, type, focus, snapshot, diff

Write the report to a file (progress stays on stderr). A typo'd path fails before
the browser launches, not after. For [`snapshot`](#snapshot-url), `A11Y_SNAPSHOT_OUT`
is the fallback when this is omitted.

### `-q, --quiet`

- **Type:** boolean · **Default:** `false` · **Commands:** install, audit,
  inspect, tree, outline, tabs, list, interact, click, type, focus, snapshot,
  diff

Suppress progress lines on stderr. [`install`](#install) still prints the
resolved executable path on stdout.

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

### `--channel <name>`

- **Type:** `stable | beta | dev | canary` · **Default:** `stable` ·
  **Commands:** install

Which Chrome for Testing release channel to track. Re-resolves the channel's
current build over the network; skips the download if it's unchanged from
what's already installed. Mutually exclusive with [`--version`](#version-buildid).

### `--version <buildId>`

- **Type:** an exact Chrome build, e.g. `131.0.6778.87` · **Default:** none ·
  **Commands:** install

Pin an exact Chrome for Testing build instead of tracking a channel. Skips the
version-resolution network call entirely — the download URL is deterministic
— so this is the escape hatch when the Chrome for Testing version endpoint is
unreachable. Mutually exclusive with [`--channel`](#channel-name).

### `--force`

- **Type:** boolean · **Default:** `false` · **Commands:** install

Reinstall even if the target build is already cached.

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

Under [`--only findings`](#only-axis) the statements are inert — the filter
removes the structure axis they summarize (same as `--max-lines`), so a config
default of `explain: true` never conflicts with an explicit filter.

### `--only <axis>`

- **Type:** `findings | views` · **Default:** the full two-axis report ·
  **Commands:** diff, snapshot

Report just one axis: `--only findings` (the accessibility problems) or
`--only views` (the tree/outline/tab-order structure). An **output filter** —
the exit gate is computed from the full findings either way, so a filtered CI
run can exit non-zero while showing only structure. What explains a gating
exit: on `diff`, the always-present one-line findings summary; on `snapshot`,
a stderr note (`real-a11y: gate: …`) — the views-only report itself stays a
pure structure export with no findings content at all.

An enum on purpose: contradictory states are unrepresentable, and a config
default (`"defaults": { "only": "findings" }`) is overridable from the command
line by passing the other value.

- **diff** — `--only findings` hides the view hunks; view-axis modifiers
  (`--explain`, `--max-lines`, `--ignore-view-line`) become inert. `--only
  views` hides per-finding entries; composes with [`--explain`](#explain). In
  `--format json` the filtered axis's arrays are omitted (`views`/`structural`
  vs `new`/`changed`/`removed`); the summary and per-page `structuralDiff`
  boolean always ship.
- **snapshot** — shapes the **`--format md` report**, or writes a **partial
  `--format json` artifact**: the filtered axis is stripped and `meta.only`
  records the capture mode. A partial artifact is a machine export (smaller
  payload, custom tooling), **not a diffable snapshot** — `diff` rejects it
  outright, because an empty-because-filtered axis is indistinguishable from
  empty-because-clean and would read as everything-new or all-removed.
  `sarif`/`junit`/`jsonl` are findings-shaped by construction and reject the
  flag.

```sh
real-a11y diff base.json pr.json --only findings
real-a11y diff base.json pr.json --only views --explain
real-a11y snapshot https://example.com --md --only views -o views.md
real-a11y snapshot https://example.com --only views -o views.json   # partial artifact (meta.only: "views")
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
