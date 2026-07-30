# @real-a11y-dev/cli

Audit **what a screen reader hears**, from your shell. `real-a11y` prints the
semantic accessibility tree — not a WCAG rule dump — and gates CI on
screen-reader-fidelity findings, with exit codes, machine formats, and GitHub
annotations built in.

```sh
npm i -D @real-a11y-dev/cli@beta playwright
npx real-a11y install   # downloads Chrome for Testing, first time only

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
| `install` | Download Chrome from Chrome for Testing (first time only) |
| `audit <url...>` | Violations grouped by rule (the gate) |
| `inspect <url>` | Findings **plus** tree + outline, one extraction |
| `tree <url>` | The semantic tree (role + accessible name) |
| `outline <url>` | Heading outline |
| `tabs <url>` | Focusable elements in Tab order (the one in-page read) |
| `list <cat> <url>` | One category: heading, link, button, form, landmark, image |
| `interact <url> --step …` | Run steps on a page, then show what they changed |
| `click <url> --role …` | Click one element by role + accessible name |
| `type <url> --role … --text …` | Set a text field's value by role + accessible name |
| `focus <url> --role …` | Move real keyboard focus by role + accessible name |
| `snapshot [url...]` | Audit a URL (or a config page set) → one diffable JSON artifact (or `--md`) |
| `diff <base> <pr>` | Findings-aware diff of two snapshots — new / changed / fixed |
| `login <url> --save <file>` | Save a login session for `--storage-state` audits |

Every command takes `--format json` for a stable machine envelope
(`schemaVersion: 1`, `pages[].findings[]` with stable `v1:` fingerprints),
`--device "iPhone 13"`, `--output <file>`, and more — see
`real-a11y <command> --help`.

Local builds audit directly: `real-a11y audit ./dist/index.html` (paths you
type need no ceremony).

### `real-a11y install` — a browser without the setup friction

```sh
real-a11y install                           # latest Stable, first time only
real-a11y install --channel beta            # track a channel
real-a11y install --version 131.0.6778.87   # pin an exact build
```

Downloads [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing) — Google's versioned, non-auto-updating Chrome build — into Real A11y's own cache (`~/.cache/real-a11y`, or `REAL_A11Y_BROWSERS_DIR`) and every command uses it from then on. A bare re-run is an instant no-op; prints the resolved path on stdout. Playwright is still the driver — this only replaces the `npx playwright install chromium` browser download, so it sidesteps the "Executable doesn't exist" mismatch a local/global Playwright version skew can cause. `npx playwright install chromium` remains fully supported as the alternative.

Every browser-driving command also takes `--chrome-path <file>` to launch a specific binary directly (ignored with `--cdp`, which reuses a running browser). Resolution order: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `install` cache > Playwright's own bundled Chromium.

### One producer per command

`audit`, `inspect`, `tree`, `outline`, `list`, `snapshot`, and the act commands
all read **Chromium's own accessibility tree** over CDP. It reaches structure no
in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute
controls, which live in a closed user-agent shadow root:

```sh
real-a11y tree  https://example.com/player   # media controls appear
real-a11y audit https://example.com/player   # and get audited
```

Findings carry the same CSS locator they always did, computed during the one
document walk the read already makes — with one honest exception: an element
inside a shadow root has no whole-document selector, so its path stops at the
boundary.

There is **no `--producer` flag**: each command has exactly one correct producer,
so there is nothing to choose. That tree is whole-document, so those commands
take **no `--root`** either.

**`tabs` is the exception, and not a fallback.** Chromium's tree knows whether a
node is *focusable*, but not the *sequence*: `tabindex` never reaches a native
node, and ordering by it is DOM/layout work the AX tree doesn't expose. So
`real-a11y tabs` still runs the in-page walk — the only source there is — and is
the one command `--root` still scopes.

Two consequences worth knowing before you upgrade:

- **`inspect` no longer prints a tab-order section.** It won't print an empty
  one either: an empty block reads as *nothing on this page is focusable*, a
  very different claim from *not measured*. Run `real-a11y tabs` for the
  sequence. In exchange, `inspect` and `audit` now agree on findings, which they
  previously did not.
- **`snapshot` artifacts no longer carry a `tabs` view**, and record that fact
  in `meta.views`. See [Track regressions across a PR](#track-regressions-across-a-pr).

## Interact — and see what it changed

Auditing the page as it loads misses everything behind a click. `interact` runs
steps and then prints the **accessibility-tree diff** they produced:

```sh
real-a11y interact http://localhost:3000 --step 'click button "Open menu"'
#  ✓ click button "Open menu"
# + link "Alpha"
# + navigation "Main"
# ~ button "Open menu": a11y.states.expanded false → true
# ~ main: childIds 1 child → 2 children

real-a11y interact http://localhost:3000 \
  --step 'type textbox "Email" = someone@example.com' \
  --step 'click button "Sign in"'
```

A step reads the way the tree prints a node — `<verb> <role> ["<name>"]
[nth=<n>] [= <text>]` — so a line of `real-a11y tree` output is nearly a step
already. Verbs are `click`, `type`, `focus`. Omit the name to match any; pass
`""` to target the **unlabeled** control an audit just flagged.

The one-step cases have sugar:

```sh
real-a11y click http://localhost:3000 --role button --name "Save" --nth 2
real-a11y type  http://localhost:3000 --role textbox --name "Email" --text you@example.com
real-a11y focus http://localhost:3000 --role link   --name "Skip to content"
```

Targeting is **role + accessible name only**, resolved against Chromium's own
accessibility tree — never a CSS selector. If a control can't be reached that
way, assistive technology can't reach it either, and that's a finding rather
than a targeting inconvenience. Ambiguous matches list their `nth=` candidates;
a disabled target is refused rather than clicked into an empty diff.

Targeting, acting, and the diff all read that same tree, so a node you aim at by
one name can't come back in the report under another. It is whole-document,
which is why these commands take no `--root`.

Each step gets a moment to land before the next one targets and before the diff
is taken — `--step-settle` (default 200ms), because a React state update flushes
on a later tick and a dialog mounts on the next frame. Raise it for a slow app;
`0` reads immediately.

The actions are real — they submit forms, toggle state, and can navigate. A step
that loads a new document leaves the tree captured before it describing a page
that's gone, so no diff is possible; the run says where it landed and still
exits `0`. A typed value is never echoed back in any output format, and `type`
is not a login mechanism: use `real-a11y login` for that.

## Configure once

Set your project's flags once in an `a11y.config.json` and every command picks
them up (the Jest/ESLint model) — precedence is `flag > env > config > built-in`:

```json
{
  "defaults": { "device": "iPhone 13", "waitUntil": "networkidle", "failOn": "error" }
}
```

```sh
real-a11y audit http://localhost:3000   # iPhone 13, networkidle, fail-on error — no flags
real-a11y audit http://localhost:3000 --no-config   # ignore the config for this run
```

Discovery is `./a11y.config.json` in the directory you run from, with no upward
walk — so running from a subdirectory quietly gets no config, and every default
reverts to its built-in. `--verbose` says which happened, naming the absolute path
it checked:

```sh
real-a11y audit http://localhost:3000 --verbose
# config: /work/app/a11y.config.json (auto-discovered)
# config: none found — looked for /work/app/nested/a11y.config.json
#   auto-discovery checks the directory you run from and does not walk upward, …
```

Add a **`urls`** list — bare URL strings, or `{ url, name?, rootSelector? }`
objects — to name your project's routes once; then a bare `real-a11y audit` (or
`snapshot`) audits them all, no URL to re-type. Each route's `name` is the diff
join key. Its `rootSelector` no longer scopes `audit` or `snapshot` — those read
the whole document — so both warn (they do not fail) when a route sets one, and
it still scopes `real-a11y tabs --root <selector>`:

```json
{
  "defaults": { "failOn": "error" },
  "urls": ["http://localhost:3000/", "http://localhost:3000/about"]
}
```

```sh
real-a11y audit                       # audits every URL in the config
real-a11y audit https://example.com   # a one-off — the list is ignored
```

The config is auto-discovered in the current directory (`--config <file>` to
point elsewhere) and strict — a typo'd key or bad value is a hard error, so it
can't silently un-gate CI. Both blocks are optional — a `defaults`-only config
is valid. Every flag except the per-run and security-sensitive ones
(`--output`, `--quiet`, `--allow-file`, `--cdp`) has a `defaults` key; see the
[CLI reference](https://real-a11y.dev/packages/cli#configure-once). (`pages` is
still accepted as the former name for `urls`.)

## Track regressions across a PR

`snapshot` writes a diffable artifact of one page or a whole set; `diff`
compares two and fails the build only on **new** findings — so pre-existing
debt doesn't block, and a fix or unrelated DOM churn never reads as a
regression:

```sh
# a single page — a URL positional, like every other command:
real-a11y snapshot https://example.com -o base.json

# or a whole set (base branch, then PR):
real-a11y snapshot --config a11y.config.json -o base.json
real-a11y snapshot --config a11y.config.json -o pr.json
real-a11y diff base.json pr.json            # exit 1 only on NEW findings
real-a11y diff base.json pr.json -f md      # a PR-comment-ready summary
```

Pages come from positional URLs, else `A11Y_PAGES`, else the `urls` list in
`a11y.config.json` — so a multi-page policy lives in your repo, not a
copy-pasted script. The diff is
finding-identity-aware: a renumbered `:nth-of-type` locator or a re-indented
subtree is not a change — only an actual new/changed/fixed violation is.

**Which views an artifact measured.** An artifact records its measured views in
`meta.views`. Snapshots read the whole-document accessibility tree, which
carries no tab order, so they measure `tree` and `outline` and omit the `tabs`
view from every page — *absent*, not empty. The two are not the same claim: an
empty tabs view means "measured, nothing focusable", and diffing that against a
populated one would report every keyboard tab stop on every page as removed.
When either side didn't measure a view, `diff` skips that axis and says so
(`skippedViews` in `--format json`) rather than reporting it as emptied — so
upgrading across this change doesn't fire the tool's most safety-critical
signal on pages where nothing changed. A pre-upgrade artifact stays diffable;
re-capture both sides to compare tab order again.

Structural drift that doesn't trip a rule shows as a **real unified diff** —
context lines, order, indentation, like a PR file diff — so you can see *where*
in the tree the change happened, shown in full by default:

````text
$ real-a11y diff base.json pr.json
#### home
```diff
@@ -3,7 +3,8 @@
     link "About"
-    button "Toggle theme"
+    button "Switch to dark mode"
     link "Cambiar a español"
   main
+    complementary "Semantic Navigator"
```
````

Add **`--explain`** for a plain-language summary on top, so a reviewer who
isn't an a11y expert can act on it without reading the raw lines:

```text
$ real-a11y diff base.json pr.json --explain
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 1 of 2)
```

`--explain` is opt-in on purpose: the statements are an interpretive layer
(pairing heuristics, cross-view inference), so the default `diff` stays
**neutral** — findings plus the unified diff, both facts — and never makes a
claim the diff can't back up. The statements cover what assistive-tech users
actually feel: landmarks appearing/disappearing (`main` removal calls out
broken skip-links), heading level changes and renames, keyboard tab stops
added/removed — including the dangerous case where an element is *still on the
page but no longer keyboard-focusable* — and pure reorders of the tab order or
outline. Anything the taxonomy doesn't recognize degrades to one honest
`Other content changed` rollup, never silence. In JSON the statements ship as
`pages[].structural` (`{ kind, message, … }` — key on `kind`, not the wording)
alongside the multiset `pages[].views`. Structural changes are **advisory
only**: they never affect the exit code.

For CI comments, cap the output — the full diff still prints (uncapped) to
stdout, so run it once unbounded to a log and once capped to the comment:

```sh
real-a11y diff base.json pr.json --explain --max-pages 5 --max-lines 20 -o comment.md
```

`--max-pages N` details the first N changed routes and lists the rest;
`--max-lines N` caps each page's diff and points to the full output.

To report just one axis, pass `--only findings` (hide the structural views) or
`--only views` (hide the per-finding detail). It's an **output filter**: the
exit gate always runs on the full result, so an `--only views` job can exit `1`
on a new finding while showing only structure — the one-line findings summary
stays to explain it. Under `--only findings`, view-axis modifiers like
`--explain` and `--max-lines` are simply inert (nothing left to modify).

The same flag shapes `snapshot`'s **md report** (`--md --only views` exports a
page set's tree + outline; `--md --only findings` a findings report) — or
writes a **partial JSON artifact** (`--only views -o views.json`): the filtered
axis is stripped and `meta.only` records the capture mode. Partial artifacts
are machine exports, not diff inputs — `diff` rejects them outright, since an
empty-because-filtered axis would otherwise read as everything-new or
all-removed.

Generated content that legitimately differs on every build (a "last updated"
timestamp, a build hash) would otherwise read as drift on every page — drop
it at the source with a repeatable regex:

```sh
real-a11y diff base.json pr.json --ignore-view-line '^time "'
```

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

`diff` takes `--baseline` too: a NEW finding the baseline accepts is reported
as `new (baselined)` but never gates.

## SARIF, JUnit, JSONL

`snapshot --format` speaks the CI interop formats (`json` stays the default):

```sh
real-a11y snapshot --config a11y.config.json -f sarif -o a11y.sarif   # GitHub code scanning
real-a11y snapshot --config a11y.config.json -f junit -o a11y.xml    # Jenkins / GitLab / Azure DevOps
real-a11y snapshot --config a11y.config.json -f jsonl | jq .rule     # one finding per line
```

Upload the SARIF with `github/codeql-action/upload-sarif@v4` and findings land
in the **Security tab**, deduplicated across runs by their `v1:` fingerprint.
`sarif` requires a config file: GitHub only displays results anchored to repo
file paths, so each result anchors to the page's `sourcePath` (set it per page
in the config to point at the page's source file) or the config file itself.
Baseline-suppressed findings are excluded from SARIF (GitHub ignores SARIF
suppressions) and appear as `skipped` in JUnit.

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
