# @real-a11y-dev/cli

## 0.1.0-beta.1

### Minor Changes

- a7191a1: Adopt the accessibility gate on a codebase that already has findings. `real-a11y snapshot --update-baseline` records today's findings in a committed `.a11y-baseline.json`; `--baseline <file>` then suppresses exactly those, and the new `--fail-on` on `snapshot` (default `never`) counts only what's left — so the build fails on genuinely **new** findings while known debt is tracked, visible, and non-blocking.

  Report truth, gate policy: suppressed findings stay in every artifact and report, marked `"suppressed": true` — the baseline changes what fails the build, never what you can see. Matching reuses the same two-tier identity matcher as `diff`, so a renumbered `:nth-of-type` locator or a re-indented subtree doesn't silently un-suppress an accepted finding. A baselined finding that gets fixed produces a stale-entry warning (never a failure); `--update-baseline` prunes stale entries deterministically and carries forward the `note` field of every entry that still matches — annotate accepted debt with ticket links and they survive the rewrite. Malformed or version-mismatched baselines are hard errors (fail-closed), because a silently-ignored baseline would un-gate everything it was supposed to accept.

  Also exported from the programmatic API: `loadBaseline`, `applyBaseline`, `buildBaseline`, `serializeBaseline`, and the `Baseline`/`BaselineEntry`/`BaselinePage` types.

- cfa60ad: `a11y.config.json` becomes a **project config** in the Jest/ESLint sense: a new `defaults` block seeds any flag you don't pass, on **every** command (today only `snapshot` read a config).

  ```json
  {
    "defaults": {
      "device": "iPhone 13",
      "waitUntil": "networkidle",
      "failOn": "error"
    },
    "urls": ["http://localhost:3000/", "http://localhost:3000/about"]
  }
  ```

  ```sh
  real-a11y audit http://localhost:3000   # iPhone 13, networkidle, fail-on error — no flags
  real-a11y audit                         # audits every URL in the config — no URL to re-type
  ```

  - **`urls` names your routes once.** Entries are bare URL strings (name defaults to the URL) or `{ url, name?, rootSelector?, sourcePath? }` objects. A bare `real-a11y audit` (or `snapshot`) with no positional audits the whole list; single-view commands (`tree`/`outline`/`tabs`/`list`) still take one URL. `urls` is **optional** — a `defaults`-only config is valid — and `pages` is kept as the former name.
  - **Precedence:** `flag > env var > config defaults > built-in`. An explicit flag always wins; `--no-config` (now accepted by every command) opts a run out. Defaults are **scoped to each command** — a default only seeds a flag that command declares, and never one an explicit flag mutually excludes (so `defaults.device` can't reach the emulation-free `login`, nor defeat an explicit `--cdp`).
  - **Validated by the same parsers as flags** — a config default becomes a "virtual flag," so `defaults.failOn: "sometimes"` errors exactly like `--fail-on sometimes`, and the config loader stays strict/fail-closed (an unknown or mistyped `defaults` key is a hard error). `format` is validated per command — `format: "sarif"` works for `snapshot`, errors on `audit`.
  - **Config-settable:** `root`, `device`, `viewport`, `waitUntil`/`settleMs`/`timeoutMs`, `headful`, `storageState`, `auditOrigins`, `format`, `rules`, `failOn`, `annotate`, `includeGeneric`, `baseline`, `ignoreViewLine`, `maxLines`, `maxPages`, `explain`. Path defaults (`storageState`, `baseline`) resolve relative to the config file, so a committed config is portable.
  - **Not settable** (deliberately): the per-run/destination flags (`output`, `quiet`, `verbose`) and the security-sensitive `allow-file`/`cdp`.
  - Discovery is the cwd `a11y.config.json` (or `--config <file>`); it's loaded once and shared, so `snapshot` doesn't parse it twice. This also finally wires `config.failOn`, which was validated-but-ignored before.
  - Top-level `rules`/`failOn`/`device` are kept as back-compat shorthand for `defaults.*` (`defaults` wins if both are set).

- 3a0e81b: `diff` and `snapshot` gain `--only <findings | views>` — report a single axis: `--only findings` (the accessibility problems) or `--only views` (the tree/outline/tab-order structure). On `diff` it trims the report for focused CI comments; on `snapshot` it shapes the `--format md` report (`--md --only views` exports a page set's views; `--md --only findings` a findings report).

  It's strictly an **output** filter: the exit gate is computed from the full findings either way, so `--only views` in a CI job can't silently disable enforcement — the run can exit non-zero while showing only structure. What explains a gating exit: on `diff`, the always-present one-line findings summary; on `snapshot`, a stderr note (`real-a11y: gate: N unsuppressed finding(s) …`) — the views-only report itself is a pure structure export with no findings content. In `diff --format json`, the filtered axis's arrays are omitted (`views`/`structural` under `--only findings`; `new`/`changed`/`removed` under `--only views`); the summary and per-page `structuralDiff` boolean always ship.

  `snapshot --only … --format json` writes a **partial artifact**: the filtered axis is stripped from the pages and the new `meta.only` field records the capture mode (additive — full artifacts carry `meta.only: null`, schemaVersion stays 1). Partial artifacts are machine exports, not diff inputs: `diff` rejects them with exit `2` and a re-generate hint, because an empty-because-filtered axis is indistinguishable from empty-because-clean and would read as everything-new or all-removed. (Caveat: CLI versions before this release don't know `meta.only` and would diff a partial artifact without complaint — regenerate with matching versions, as with any artifact.) `sarif`/`junit`/`jsonl` are findings-shaped by construction and reject `--only`.

  Designed as one enum flag rather than a `--findings-only`/`--views-only` pair: contradictory states are unrepresentable, and a config default (`"defaults": { "only": "findings" }`) is overridable from the command line by passing the other value. Under `--only findings`, view-axis modifiers (`--explain`, `--max-lines`, `--ignore-view-line`) are uniformly inert rather than errors, so an `a11y.config.json` `defaults: { "explain": true }` can coexist with an explicit filter.

- 31deea2: `--producer native` — audit Chromium's own accessibility tree from the CLI.

  The default (`--producer dom`, unchanged) injects the page-bundle and walks the light DOM in the page. `--producer native` instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and serializes + audits it in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root:

  ```sh
  real-a11y tree https://example.com/player --producer native   # media controls appear
  real-a11y audit https://example.com/player --producer native  # and get audited
  real-a11y outline https://example.com --producer native
  ```

  Native is whole-document and read-only, so the flag is accepted only where that fits: `audit`, `tree`, and `outline`. Commands that carry a tab sequence (`tabs`, `inspect`, `snapshot`) or run the in-page `listByRole` (`list`) reject `--producer native` with guidance, and `--producer native` can't be combined with `--root` (it audits the whole document).

  `@real-a11y-dev/snapshot` gains `projectNativeTree(tree, options?)` — the shared projection that turns a native `ExtractionResult` into the same `CleanSnapshot` the DOM producer yields (serialize + audit in Node, empty tab order). It's what the CLI's native path builds on, and it's reusable by any consumer opting into the native producer.

- 1b862d1: CI interop reporters and diff-side baselines. `snapshot --format` now speaks `sarif`, `junit`, and `jsonl` alongside `json` (still the default) and `md` (`--md` stays as shorthand):

  - **`sarif`** — SARIF 2.1.0 for GitHub code scanning (upload with `codeql-action/upload-sarif@v4` and findings land in the Security tab), Azure DevOps, and the VS Code SARIF viewer. Built to survive the known interop traps: results anchor to repo **file paths** (the page's `sourcePath` from the config, else the config file — never a bare page URL, which GitHub silently won't display), so `sarif` requires `--config`; alert identity is supplied via `partialFingerprints.primaryLocationLineHash` = the stable `v1:` fingerprint, so alerts neither collapse nor churn on unrelated edits; `automationDetails.id` is scoped per config, not per page; and baseline-suppressed findings are excluded entirely, because GitHub ignores SARIF `suppressions[]`.
  - **`junit`** — one suite per page, one failing case per finding, baselined findings as `skipped`, a passing placeholder for clean pages (empty suites read as "no tests ran" in some ingesters), XML-escaped throughout.
  - **`jsonl`** — one finding per line for `jq`/grep pipelines; no framing records; suppressed findings flagged.

  `diff` now takes `--baseline <file>` too: a NEW finding the baseline accepts renders as `new (baselined)` — reported, never gating — closing the loop with `snapshot --update-baseline`. The `a11y.config.json` page entries gain a `sourcePath` field (carried into the snapshot artifact) for SARIF anchoring. Reporters are exported from the programmatic API as `renderSarif`, `renderJUnit`, and `renderJsonl`.

  The structural (tab-order) view diff no longer explodes on an insertion: the serialized tab list is numbered, so adding one focus stop used to renumber every stop after it and report ~40 "changed" lines. The tab view now compares by stop content (the `NN.` counter is dropped before diffing), so one inserted stop is one added line — the tree and outline views are unchanged, keeping indentation depth and heading `(level N)`.

- 7e612e4: `snapshot` now takes a **URL positional**, like every other command — the config is optional, for multi-page/policy:

  ```sh
  real-a11y snapshot https://example.com -o base.json    # single page, no config
  real-a11y snapshot                                     # pages from a11y.config.json
  ```

  Pages resolve in precedence order: **positional URLs → `A11Y_PAGES` → `a11y.config.json`**. A positional URL's page name defaults to the URL (matching `audit`/`tree`). This removes the inconsistency where `snapshot` was the only command that couldn't audit a URL you just type — making the snapshot → diff flow usable without writing a config first.

- 7a9b870: `diff` now shows structural drift as a **real unified diff** — context lines, order, and indentation, like a PR file diff — so a reviewer can see _where_ in the tree a change happened, not just a bare list of added/removed lines. Shown in full by default:

  ````text
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

  Add **`--explain`** for an opt-in plain-language summary on top — statements a non-expert can act on. The default stays **neutral** (findings + the unified diff, both facts); `--explain` is the interpretive layer (pairing heuristics, cross-view inference), so the default never makes a claim the diff can't back up:

  ```text
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 2 of 14)
  ```

  The taxonomy covers what assistive-tech users feel: landmarks added/removed/renamed (removing `main` calls out broken skip-links), heading level changes and renames, keyboard tab stops added/removed with their position — including the dangerous variant where the element is **still on the page but no longer keyboard-focusable** — interactive elements outside the tab order, and **pure reorders** of the tab order or heading outline. Anything unrecognized degrades to one honest `Other content changed` rollup — never silence. Rename/level pairings are count-aware and strictly 1:1; ambiguity degrades to add/remove, so the summary never guesses.

  New flags for CI comments (default: full):

  - **`--max-lines <n>`** — cap each page's structural diff to _n_ lines, then `… N more`.
  - **`--max-pages <n>`** — detail the first _n_ changed routes; list the rest.
  - **`--ignore-view-line <regex>`** (repeatable) — drop volatile lines (a "last updated" timestamp, a build hash) before diffing.

  Where it lands:

  - **pretty** — a colored unified diff per changed page; `--explain` adds the `· <statement>` lines; a one-line `--explain` hint otherwise.
  - **md** — a route index (`Pages with a11y changes (N): …`), findings, then (under `--explain`) statements, then the color-coded ` ```diff ` hunks — inline, not in `<details>`, so PR-notification emails keep the green/red. The header names the drift (`… · structure changed on N page(s)`) so a findings-clean-but-structure-moved diff doesn't read as an all-zero "nothing changed".
  - **json** — additive `pages[].structural: [{ kind, view, message, … }]` and `pages[].structuralDiff` (a boolean: does the unified diff have any hunk — the honest "structure changed" signal, since `structural` misses a pure tree reorder), always present regardless of the flags (machine surface); `schemaVersion` stays 1, `pages[].views` untouched.

  The a11y-diff workflow prints the **full uncapped diff to the job log** and posts a capped comment (`--max-pages 5 --max-lines 20`) that links back to it, so the complete diff is always one click away.

  Structural output is advisory by construction: the exit gate never reads it.

  `@real-a11y-dev/testing` newly exports the `INTERACTIVE_ROLES` set and re-exports `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core`, so the CLI's structural summary shares one source of truth for role classification.

- d693a00: Make `diff` focus-aware. Now that serialized snapshots mark the focused element with `[focused]` (see `@real-a11y-dev/serialize`), the `diff` command:

  - **Excludes the marker from the structural diff.** Focus isn't structure, so a pure focus move (same elements, only the focused one differs) no longer shows as phantom add/remove churn in the multiset views or the `--explain` statements.
  - **Reports the transition under `--explain`** as a `Focused element changed: <from> → <to>` statement (or "focus now starts on…" / "focus no longer starts anywhere…" when it appears or vanishes). On a page where only focus moved, that one statement is the entire structural summary.

  The literal unified diff still shows the `[focused]` line change, so the raw view stays faithful.

  Note: when comparing a base snapshot captured with an older CLI (no marker) against a PR snapshot from this version, an autofocused page shows a one-line focus change. Regenerate both sides after upgrading, as with any baseline.

- ba4ba95: New package `@real-a11y-dev/snapshot` — the snapshot engine, extracted from `@real-a11y-dev/cli`. It owns the deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines, depending on nothing but `@real-a11y-dev/audit` and `@real-a11y-dev/core`. It's Node-only (`node:crypto`) and never enters the page bundle, which makes it the single place a snapshot is captured and compared — so a snapshot taken by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical. The `CliError` the artifact and baseline readers used to throw is now a domain `SnapshotFormatError`.

  **Breaking for `@real-a11y-dev/cli`: it no longer exposes a programmatic `.` library entry — the CLI is a command, not a library.** Everything the old `api` surface re-exported (fingerprints, the artifact, the findings/views/unified diff, baselines, sanitization) now lives in `@real-a11y-dev/snapshot`; import it from there instead. The `real-a11y` binary — its commands, flags, output, and exit codes — is byte-for-byte unchanged (verified against the CLI e2e suite). The CLI also drops its direct `@real-a11y-dev/core` dependency (it followed the engine into `snapshot`) and gains `@real-a11y-dev/snapshot`.

### Patch Changes

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- 642634e: `real-a11y diff` output now reports **two clearly labeled axes** so the counts can't be misread. The markdown header was a single `0 new · 0 changed · 0 fixed · structure changed on 1 page` line — which made an all-clean findings count sitting next to a structure change read as a contradiction. It's now:

  ```
  ### Accessibility diff

  **Findings** (gate CI): 0 new · 0 changed · 0 fixed — none changed
  **Structure** (advisory): changed on 1 page — new or reordered headings, landmarks, or tab stops
  ```

  _Findings_ are the accessibility problems that gate CI; _structure_ is the shape of the semantic tree (advisory, never gates) — so adding a valid new section moves the structure without introducing a single new finding. The terminal (`pretty`) summary is likewise labeled `findings:`.

- 6a1e5b8: `real-a11y diff` now warns on stderr when the two snapshots share no page `name` at all. Pages join by name, never URL, so two snapshots taken with positional URLs (whose names then default to URLs differing by host/port) matched nothing: every page read as added/removed, no structure was ever compared, and `--explain` silently had nothing to add — a diff that looked like it worked but compared nothing. The report and exit code are unchanged; only the warning is new.
- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

- cd87cd2: Import the audit engine from its canonical home, `@real-a11y-dev/audit`, instead of through `@real-a11y-dev/testing`'s re-export — production packages no longer reach the findings engine through the test-helper package.

  - **`@real-a11y-dev/cli` no longer depends on `@real-a11y-dev/testing` at all.** `Finding` / `A11yRule` / `ALL_RULES` / `INTERACTIVE_ROLES` now come from `@real-a11y-dev/audit`, and `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core` (its real home). Installing the CLI no longer pulls in a test-runner-oriented package.
  - **`@real-a11y-dev/mcp`** imports `Finding` / `A11yRule` / `ALL_RULES` from `@real-a11y-dev/audit`. It still depends on `@real-a11y-dev/testing` for one thing only — the browser page-bundle (`page-bundle.iife.global.js`) it injects at runtime — and that remaining tie is removed when the browser layer is extracted to its own package.

  Pure re-point: the re-exported symbols are identical (audit is where they were always defined), so there is no public API or output change. Verified byte-for-byte against the CLI and MCP e2e suites.

- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [9d080eb]
- Updated dependencies [cf426d3]
- Updated dependencies [e2eca34]
- Updated dependencies [31deea2]
- Updated dependencies [84535a1]
- Updated dependencies [0680dc9]
- Updated dependencies [ba4ba95]
  - @real-a11y-dev/audit@0.1.0-beta.11
  - @real-a11y-dev/browser@0.1.0-beta.11
  - @real-a11y-dev/snapshot@0.1.0-beta.11

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
