# @real-a11y-dev/cli

## 0.1.0-beta.2

### Minor Changes

- 87a7244: `audit` now honors each URL entry's `rootSelector`, and `audit` and `snapshot` derive a page's `name` identically — so the same configured route fingerprints the same way whichever command produced the artifact.

  **`rootSelector` scopes the audit.** `resolveAuditTargets` collapsed every config page down to `{ url, name, fileApproved }`, discarding both `rootSelector` and `name`. A route configured with `"rootSelector": "main"` was audited at `body` anyway and reported findings from outside the region it was scoped to — a site-wide header link, say. An explicit `--root` still wins, since it's a deliberate override for that run; omit it and each route uses its own selector. `--producer native` combined with a config `rootSelector` is now a hard error with the same wording as `--producer native --root`, rather than silently auditing the whole document.

  **One page name, settled once.** The name is the `v1` fingerprint's page component and `diff`'s join key, but the two commands derived it differently: `audit` re-derived it with `redactUrl`, while `snapshot` used the config value raw. A bare entry like `"http://localhost:3000"` therefore became `http://localhost:3000/` under `audit` and `http://localhost:3000` under `snapshot` — divergent fingerprints for one route. `resolvePageList` now settles the name once, at the single point both commands read their pages from.

  One divergence remains and is unchanged by this release: `snapshot` honors neither `--root` nor `defaults.root`, so a route with no `rootSelector` is snapshotted at `body` while `audit` scopes it to `defaults.root` if you set one. Give a route its own `rootSelector` when you need the two commands to agree on it.

  **Breaking:** for `urls` entries written as bare URL strings, the page `name` in a snapshot artifact is now the canonical URL (`http://localhost:3000/`, trailing slash) instead of the string as written. Since `name` feeds every finding fingerprint and `diff` joins on it, a baseline or committed artifact produced by an older version won't match one produced by this release for those routes — re-record it with `--update-baseline`. Entries with an explicit `name` are unaffected.

  **Security:** a name that defaulted to the URL is now redacted the same way the `url` field always was. Previously a positional or bare-string target carrying userinfo or a `?token=` wrote those credentials into the artifact's `name` field and the baseline, beside a carefully redacted `url`.

- 823d1cc: `real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

  ```sh
  real-a11y install                           # latest Stable
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # pin an exact build
  ```

  This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

  The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

  `@real-a11y-dev/browser` gains `executablePath` on `BrowserSessionOptions`, plus `resolveChromeExecutable`/`readChromeManifest`/`chromeCacheDir` for anyone building their own installer or launch wiring. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.

- 4e3c10a: `real-a11y interact` — drive a page, then see what it changed for a screen reader. Plus one-step sugar verbs `click`, `type`, and `focus`.

  A page audited as it loads never shows the dialog, the expanded menu, or the validation error. `interact` runs steps against a live page and prints the accessibility-tree diff they produced:

  ```sh
  real-a11y interact http://localhost:3000 --step 'click button "Open menu"'
  # + link "Alpha"
  # + navigation "Main"
  # ~ button "Open menu": a11y.states.expanded false → true
  # ~ main: childIds 1 child → 2 children
  ```

  Steps are written in the vocabulary the tree already prints — `<verb> <role> ["<name>"] [nth=<n>] [= <text>]`, verbs `click | type | focus` — so a line of `real-a11y tree` output is nearly a step already. `--step` is repeatable and ordered, stopping at the first failure. Omit the name to match any; pass `""` to target the unlabeled control an audit just flagged. The one-step cases have sugar: `real-a11y click <url> --role button --name "Save" --nth 2`, and likewise `type` (with `--text`) and `focus`.

  Targeting is **role + accessible name only**, resolved against Chromium's own accessibility tree immediately before each dispatch — never a CSS selector, and no node id ever reaches the command line. If a control can't be reached that way, assistive technology can't reach it either, and that is surfaced as the accessibility finding it is. Ambiguous matches list their copy-paste `nth=` candidates; a disabled target is refused with the cause, because a swallowed click plus an empty diff reads as "that button does nothing" rather than "you can't click it".

  Targeting, acting, and the diff all read the same tree — Chromium's own, over CDP — so a node you aim at by one name can't come back in the report under another. That tree is whole-document, so these commands take neither `--producer` nor `--root`, rather than accepting flags they'd ignore. A step that loads a new document (a navigation, or a reload) leaves the captured tree describing a page that no longer exists; the run reports that, says where it landed, and still exits `0`.

  A typed value is never echoed — not in progress output, not in `--format json`, where the step renders as `= ‹hidden›`. There is deliberately no credential workflow here: a password on the command line is visible to other processes and lands in shell history, so `real-a11y login` remains the way to authenticate.

  The JSON envelope gains three additive optional fields on a page: `steps` (rendered, redacted), `diff`, and `navigated` — the last so a consumer can tell that a step loaded a new document (so there is no diff) without string-matching the diff prose. `url` is re-read after the steps run, so it reports where the page LANDED rather than where the run opened it. Chromium only.

- 0aa04c5: One producer per surface — `--producer` and the MCP `producer` param are gone.

  The rule is **native for the a11y tree, DOM where the data only exists in the DOM**. Every read now comes from Chromium's own accessibility tree, which reaches structure no in-page walk can (a `<video controls>`'s user-agent-shadow media controls) and carries locators as of #251 — except tab order, which it cannot produce at all.

  **The flags are removed, not defaulted.** Each surface has exactly one correct producer, so there was nothing left to choose: `--producer` is gone from the CLI, `producer` from the MCP tools, and `compare_producers` with them (20 → 19 tools). `--root` survives on `tabs` alone; every other command reads the whole document, so a selector has nothing to scope, and they refuse the flag with that explanation rather than the parser's "Unknown option". A config `defaults.root` **warns on stderr and keeps running** — this loader is otherwise strict and fail-closed, and erroring would red every CI that set the key, mid-beta, over config that was correct when it was written.

  **`tabs` stays on the DOM producer, and that is not a fallback.** Native does know per-node focusability — `"focusable"` is in `STATE_PROPS`, which is what `focusedId` was built on. What it cannot produce is the _sequence_: `tabindex` is not in `DOM_ATTR_ALLOWLIST`, so it never reaches a native node, and ordering by it is DOM/layout work Chromium's AX tree doesn't expose. One DOM extraction still yields all four views from a single `page.evaluate`, so `tabs` is one read, not a second pass.

  ## The artifact had to change shape, and omission alone was not enough

  `projectNativeTree` returns `tabOrder: ""`, which `buildSnapshotPage` renamed to the artifact's `tabs`. So the **first diff across this migration** would compare a DOM artifact's N tab stops against a native one's none, and `views-summary` would report every stop as gone:

  ```
  Keyboard tab stop removed: button "Save"
  Keyboard tab stop removed: link "Home"
  … once per focusable element, on every page
  ```

  That is the tool's most safety-critical signal firing spuriously, at volume, on an upgrade where no page changed — plus the `NOTHING_FOCUSABLE` sentinel ("Nothing on this page is keyboard-focusable any more") reachable the same way.

  Simply omitting the view does not fix it. `parseSnapshotArtifact` coerced a missing `tabs` straight back to `""`, so a reader could not tell _absent_ from _empty_ and landed in the same place. The fix needs a presence signal that survives the round trip:

  - **`SnapshotPage.tabs` is now optional**, and a native page omits it.
  - **`meta.views`** records which views the run measured. Additive, so `schemaVersion` stays `1`; absent/null reads as a legacy artifact that measured all three, which is what its silence meant.
  - **The parser respects it** — an unmeasured view stays `undefined` (and a stray one is dropped, so the two can never disagree), while a _measured_-but-missing view still defaults to `""`, because "measured, nothing focusable" is a real state.
  - **`diff` compares an axis only when both sides measured it**, and reports the rest as `skippedViews` — surfaced in every format, so a silently skipped axis is never read as "tab order is fine".

  The same signal rides through the MCP server: `checkpoint_findings` is native too (both tools must read one producer, or a checkpoint captured by one and diffed by the other compares cross-producer findings), and `export_checkpoint` declares `views: ["tree", "outline"]`. A DOM-era artifact imported as a base still diffs cleanly — the tabs axis is skipped, not emptied.

  ## What this costs
  - **`inspect` no longer prints tab order**, and prints no empty section either — an empty block reads as _nothing here is focusable_, a very different claim from _not measured_. `real-a11y tabs` is the sequence. In exchange `inspect` and `audit` finally agree on findings, which they previously did not.
  - **`snapshot`/`diff` no longer detect tab-order regressions at all**, since the artifact carries no tabs view. The CI diff-bot guide says so plainly rather than leaving a stale promise. `real-a11y tabs` still reports the sequence, and still takes `--root`.
  - **A route's `urls[].rootSelector` no longer scopes `audit` or `snapshot`.** Both warn once, naming the routes, and keep running — findings from outside that subtree are now included. The entry still identifies a route.
  - **MCP checkpoints are whole-document too.** `checkpoint_findings`/`diff_findings` lost their `rootSelector`, so a base imported from a DOM-era artifact that was captured at a narrow root now diffs against a whole-page re-snapshot: the old findings still match by fingerprint, but everything outside that subtree arrives as NEW — the class that gates CI. The diff says so in its first line, naming both scopes, rather than widening silently.

  - **Every "narrow with `rootSelector`" hint had to be re-aimed.** The MCP output cap appended that line to _any_ truncated result, and `export_checkpoint` told you to re-save with a narrower one — advice four of the five read tools can no longer take, arriving at the exact moment the agent has lost information and most needs a way forward. Each read now names the lever it actually has (`rules`, a genuine `rootSelector` on `get_tab_order` and the tree checkpoints, or a smaller sibling read), and an oversized checkpoint export says what it can't do and points at `diff_findings` or the CLI's `snapshot --output` instead.

  Tab-order machinery stays in core / serialize / browser / extension / mcp; only the CLI's `inspect` and `snapshot` stopped consuming it. `@real-a11y-dev/testing` runs in-page by design and is unaffected.

- 7e85937: Session daemon core: a long-lived `real-a11y` process that keeps a browser page warm across CLI invocations.

  The daemon (`packages/cli/src/daemon/entry.ts` → `dist/daemon/entry.js`) listens on a Unix domain socket and speaks NDJSON RPC. It holds a `SessionRegistry` of named `BrowserSession` instances, serialises commands per session, supports an idle timeout, and writes a pidfile on startup.

  Initial daemon-side command runners are wired for the view and interaction commands: `tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, and `focus`. Each runner compares the session's current URL and skips navigation when already on the target page, so successive requests against the same session reuse the live page. `audit` and `snapshot` daemon runners follow in a later PR.

- 37f5859: Session daemon lifecycle and hardening.

  - Adds `real-a11y session list|stop|stop-all` to inspect and terminate daemon sessions.
  - `--session-idle-timeout <ms>` caps how long a daemon stays warm (default 15 min, max 1 hour) and resets after each run.
  - Session names are sanitized and stored per-user under `~/.real-a11y/sessions/`, with `0o600` Unix sockets or Windows named pipes with a random per-session name (`\\.\pipe\real-a11y-<id>`; the id is independent of the auth token, which is still required on every RPC).
  - Orphan cleanup: stale pidfiles/sockets are detected and removed by `list`/`stop`/`stop-all`; a CLI version/protocol handshake auto-restarts incompatible daemons.
  - Daemon log is written to `~/.real-a11y/sessions/<name>/daemon.log`.
  - `snapshot` and `audit` are now routed through the daemon and reuse the live page when the current URL already matches the target.
  - `--storage-state` now origin-pins `snapshot` the same way it already pinned `audit` and `inspect`; use `--audit-origin` if you need to allow additional origins.

- aa32b98: Add `--session` routing so browser-driving CLI commands reuse the session daemon.

  Any browser-driving command (`tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, `focus`, `inspect`, `audit`) accepts `--session <name>`. The first such run spawns a detached daemon listening on a Unix domain socket under `~/.real-a11y/sessions/<name>/daemon.sock`; later runs with the same name connect to it and act on the same live page. Without `--session` the one-shot default is unchanged.

  The session name resolves as explicit `--session` → `a11y.config.json` `defaults.session` → a stable hash of the current working directory. `snapshot` declares `--session` but is not yet routed to the daemon in this release.

- f834cfa: `--step-settle` — give a step's effect time to land before reading the page.

  A dispatch returning is not the same as its effect having landed. A React state update flushes on a later tick, a dialog mounts on the next frame, and an immediate read reports "no changes" for a click that plainly did something:

  ```
  setTimeout(() => location.href = "/b", 300)   # a deferred navigation
  act() returned after 8ms
  read done at 17ms  ->  diff: (no changes)     # the page was about to navigate
  ```

  `--step-settle <ms>` (default `200`, the same debounce `@real-a11y-dev/testing`'s `flow()` already settled on) waits after **each** step, so it gates the next step's targeting as much as the final diff — a step that opens a menu has to have opened it before the step that clicks an item can resolve that item against a fresh tree. `0` opts out and reads immediately; `stepSettleMs` sets it project-wide, beside `settleMs`.

  Deliberately separate from `--settle`, which waits once after the initial page load — conflating them would make one number serve two unrelated jobs, and `--settle`'s default of `0` is right for its job and wrong for this one.

  It is a **heuristic wait, not a synchronisation point**. Nothing can tell you a page is _about_ to navigate, so a reaction landing later than the settle still won't appear, and "no changes" is never proof that nothing happened. A synchronous navigation was never affected either way: the dispatch already blocks until it commits.

- 759c1a1: feat(cli): --verbose says where the config came from

  Config auto-discovery stats `./a11y.config.json` in the directory you run from and
  nowhere else — no upward walk, which is deliberate for v1. The consequence is a
  quiet one: run from a subdirectory and you get no config, every default reverts to
  its built-in, and nothing says so. The config is right there on disk, so the
  natural conclusion is that config defaults don't work.

  `--verbose` now prints one line before anything depends on it:

  ```
  config: /work/app/a11y.config.json (auto-discovered)
  config: /work/app/custom.json (from --config)
  config: skipped (--no-config); built-in defaults only
  config: none found — looked for /work/app/nested/a11y.config.json
    auto-discovery checks the directory you run from and does not walk upward, so a
    config in a parent directory is not picked up. Pass --config <file> to name one.
  ```

  Paths are absolute deliberately. The failure this exists for is a config that is
  real but not where the command ran from, and `a11y.config.json` is what the user
  already believes they have — a relative path would add nothing.

  The `none found` line carries three things because each answers a different
  question: which path was checked, why checking elsewhere won't help, and what to
  do instead. Knowing the path alone doesn't tell you that no other path ever will
  be searched.

  Behaviour is unchanged without `--verbose`, and discovery itself is untouched — an
  upward walk to the git root would change documented behaviour and is a separate
  call.

- c10cfad: feat!: a page's identity is now separate from its display label

  `SnapshotPage.name` was documented as _"Diff join key + display label"_ — one
  field with two jobs. Because the join key **was** the label, changing the label
  changed what the tool believed the page was. Three failures came from that one
  conflation:

  - renaming a page for readability un-suppressed its baseline;
  - auditing a bare URL and later naming it in a config did the same;
  - the same page on localhost vs prod only paired if you kept the names
    character-identical by hand.

  No single field fixes all three — the URL breaks the third (which is why `name`
  was chosen over it), the label breaks the first two. So identity is its own
  field now, derived from the part of a URL that survives both:

  | field  | job                                      | default                 |
  | ------ | ---------------------------------------- | ----------------------- |
  | `id`   | join key — diff, baselines, fingerprints | the URL's path + search |
  | `name` | display label, free to change            | the redacted URL        |
  | `url`  | where it was captured                    | —                       |

  Config entries take an optional `id` to collapse routes the path separates, or
  to separate two sites that share one. Two pages with the same id is a **hard
  error** naming both URLs and the fix — silently blending two pages' findings is
  the worst outcome this model can produce.

  The rule is not new: `differentUrl` already compared path + search + hash and
  ignored the origin when deciding whether a checkpoint diff spanned two pages.
  This promotes it to the identity it was always implying, and both now read the
  same `pageIdOf` so a second definition can't drift into existence.

  **Breaking.** `ARTIFACT_SCHEMA_VERSION` and `BASELINE_SCHEMA_VERSION` are both
  `2`, because a finding's fingerprint now keys on the page's id rather than its
  label — the hashes in a pre-upgrade file were computed over a different tuple,
  and comparing the two schemes reports unchanged findings as fixed + new.

  The two formats are treated differently, and the asymmetry is the point:

  - **Artifacts are converted on read.** A v1 artifact holds the page `url` (→ the
    identity) and each finding's own components (rule, role, locator, …), so it
    can be re-keyed to produce exactly what a fresh capture of that page hashes.
    Nothing is guessed and nothing is lost — an old `a11y-snapshot.json` still
    diffs correctly against a new one, with no re-record.
  - **Baselines are refused by name.** A baseline stores no URL, only a label, so
    its identity cannot be derived from what it holds. Guessing was rejected
    outright: a wrong guess silently suppresses a real finding.

  **Upgrading a baseline.** Run `real-a11y snapshot --update-baseline`. It
  replaces an unreadable baseline rather than refusing it — refusing would be a
  dead end, since that is the command the refusal points you at — and says so, so
  the `+new/-stale` counts stay interpretable. **Any `note` you wrote on an entry
  does not survive**, and a note is the only part of a baseline nothing can
  regenerate, so recover those from version control before committing.

  The id is derived from the **redacted** url, so a `?token=…` never reaches the
  artifact, the fingerprints or the committed baseline through this new field.
  Schemes with no route — `data:`, `about:`, `blob:` — get no id at all and fall
  back to the display label, which is the pre-identity behaviour and the right
  answer for a content-addressed URL.

  **Two config entries that differ only by `rootSelector` are now an error.**
  Since the native-only migration both `audit` and `snapshot` read the whole
  document, so such a pair names one URL and measures the same thing twice — one
  page, one id. It used to warn and audit the page twice identically. Delete the
  redundant entry, or give one an explicit `id`.

  `import_checkpoint` no longer rewrites an imported page under the store label —
  it did that because a label was an identity, and the rewrite would now break the
  join it once repaired, so an artifact is stored as it arrived. Cross-tool diffs
  (MCP `export_checkpoint` → CLI `diff`) work as a result, which they never have.

  `diffLabeledCheckpoints` mostly stands down too: for a page with a real route
  both sides derive the same id and join on their own. It keeps its neutral
  re-fingerprint for one case — when **neither** side has a route (`data:`,
  `about:blank`), where the id falls back to the display label and two checkpoints
  of one unchanged page would otherwise report every finding as removed + re-added
  with no note explaining why. One routed side and one not stays a genuine
  mismatch and is not forced together.

  `A11Y_PAGES` entries take an optional `id`, matching config `urls` entries. Two
  pages resolving to one identity is a hard error, so the remedy has to be
  reachable from whichever page list you use — `A11Y_PAGES` is the documented
  drop-in for the CI guide, and "rewrite it as a config file" is not an answer.

- a4cfac8: Tab-order serialization is now number-free by default; numbering moves to a render-time step.

  `serializeTabSequence` used to render `01. link "Home"` / `02. button "Go"`. Inserting one focusable element near the top of the page renumbered every following line, so a committed snapshot's diff — and the reviewable unified-diff hunk of `real-a11y diff` — churned the whole view instead of showing the one inserted stop. Line order already conveys the sequence, so the serialized form is now just `link "Home"` / `button "Go"`: the canonical, diff-stable output you store and compare.

  For a human- or agent-read listing where an explicit "stop 7" helps, a new `numberTabStops(tabs)` export re-adds the `NN. ` prefix at **render time** (never stored):

  ```ts
  import {
    serializeTabSequence,
    numberTabStops,
  } from "@real-a11y-dev/serialize";
  numberTabStops(serializeTabSequence(root)); // 01. link "Home"  02. button "Go"
  ```

  Numbering is applied where output is read, not diffed: the CLI `tabs` terminal view, the MCP `get_tab_order` and `inspect_page` tools, and the extension's Markdown export (which stays numbered, matching its on-screen panel). It is absent where output is committed or diffed: `tabSequenceSnapshot()` in `@real-a11y-dev/testing`, the CLI `snapshot`/`inspect` artifacts and JSON, and the browser audit's `tabOrder`. (Also fixes an MCP snapshot summary that reported "0 tab stops" once lines were unnumbered.)

  **Breaking change.** Any committed snapshot of a tab sequence (vitest/jest `toMatchSnapshot`, an inline snapshot, or a golden file / CI artifact) will differ by the removed `NN. ` prefix on every line.

  **Migration.** Either re-generate the affected snapshots (`vitest -u`, `jest -u`, or re-capture the golden file), or wrap the value for display: `numberTabStops(tabSequenceSnapshot(root))`.

  Structural diffing tolerates the transition: `real-a11y diff` still strips leading `NN. ` numbers before comparing, so a base captured by an older numbered tool version diffs cleanly in findings, the multiset view, and the plain-language statements. The one exception is the tabs **hunk** view — a legacy numbered base shows a one-time full rewrite there until it is re-captured. That output is advisory and never gates.

### Patch Changes

- 0cf3860: Internal restructure: the daemon's `SessionRegistry` moved into the private workspace package `@real-a11y-dev/session-registry` (bundled into the CLI dist), so the upcoming MCP session support can embed the identical scheduling, identity-pinning, and idle-timeout semantics. No behavior change — the registry code, its tests, and the daemon E2E suite are unchanged apart from the package boundary and consumer-neutral error types.
- 8cc6078: fix: `FlagValues` admits the array values `parseArgs` actually produces

  `FlagValues` was `Record<string, string | boolean | undefined>`, but three flags
  are declared `multiple: true` — `--audit-origin`, `--step` and
  `--ignore-view-line` — so `node:util.parseArgs` hands back a `string[]` for them
  and always has.

  Nothing misbehaved at runtime, because the commands already guard with
  `Array.isArray(...)`. The cost was to the type: those guards read as dead code
  to both a reader and the compiler while being the branch that actually fires,
  and one call site had already been patched by hand to accept `string[]` locally.
  `FlagValue` is now a named alias carrying the array arm, used by every parser
  helper.

  The type was wrong for as long as it existed because the files that pass real
  array values — the tests — were excluded from typechecking.

- fea46b0: Declare each command's producer support once, on the command table.

  Which commands accept `--producer native` was recorded in three places that could disagree: a `supportsNative` boolean passed in at each of five `producerOf` call sites, a hand-written `"native works with: audit, tree, outline"` list inside the refusal hint, and the Producer column in the docs. The hint's list is the one that had already drifted — it is offered to someone who just hit a refusal, so a stale entry sends them at a command that will refuse them too.

  `CommandSpec` now carries `producers` (and `group`, the command reference's section). `producerOf` reads support from the table instead of taking it as an argument, and builds the hint's alternatives from the same place — filtered to commands that both support native and actually expose `--producer`, so the act commands (native-only, no such flag) are never suggested as somewhere to pass it.

  No behavior change: the same commands accept native, and the hint reads the same today. It just can't fall out of step tomorrow.

  **Superseded in this same release.** `--producer` was removed entirely — each surface now has exactly one correct producer, so there is nothing to choose and no refusal hint to keep current. `producers` and `group` outlive the flag: `producers` became a description of which producer a command _reads_ (still the fact that decides whether `--root` applies, and still what `docs/surface.json` publishes), and deriving it from the table rather than a hand-written list is what kept that removal honest.

- adeffcf: `snapshot` now rejects a typed `--root` instead of silently ignoring it.

  `snapshot` scopes each page by that page's `urls[].rootSelector` — that's what
  makes its artifact a faithful record of the config, and what keeps two snapshots
  of the same route comparable. It never read `--root`, but it accepted the flag
  and dropped it, exiting 0 with an artifact whose `v1:` fingerprints looked like
  they came from a scope that was never applied. It now errors (exit 2) and points
  at `urls[].rootSelector`, or `audit --root` for a one-off scoped run.

  A project-wide `defaults.root` is unaffected: it's config aimed at `audit`, not
  an instruction for this run, so `snapshot` still ignores it silently rather than
  failing every run. `snapshot --help` no longer lists `--root`.

- Updated dependencies [37f5859]
- Updated dependencies [37f5859]
- Updated dependencies [4e3c10a]
- Updated dependencies [b2ccee0]
- Updated dependencies [37f5859]
- Updated dependencies [bbbcb04]
- Updated dependencies [823d1cc]
- Updated dependencies [0aa04c5]
- Updated dependencies [135ccc3]
- Updated dependencies [6785622]
- Updated dependencies [43f085c]
- Updated dependencies [b304069]
- Updated dependencies [0a41085]
- Updated dependencies [c10cfad]
- Updated dependencies [a4cfac8]
  - @real-a11y-dev/browser@0.1.0-beta.12
  - @real-a11y-dev/snapshot@0.1.0-beta.12
  - @real-a11y-dev/audit@0.1.0-beta.12
  - @real-a11y-dev/serialize@0.1.0-beta.12

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
