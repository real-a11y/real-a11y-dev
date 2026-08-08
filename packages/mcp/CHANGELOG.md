# @real-a11y-dev/mcp

## 0.1.0-beta.3

### Minor Changes

- f54f398: Stop publishing `@real-a11y-dev/audit`, `@real-a11y-dev/serialize` and `@real-a11y-dev/snapshot`; they are internal now.

  They were on npm because the workspace grew that way, not because anyone chose them as products. None had a documentation page, and nothing on the website recommended installing one. Together they were 95 of the 295 modelled exported symbols.

  **Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `browser`, `cli`, `mcp` and `testing` install fewer packages, not more.

  If you did import one directly:

  - `@real-a11y-dev/audit` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings` and the `assert*` primitives. That is the only published home for them — `mcp` names `Finding` in its own signatures but does not re-export it.
  - `@real-a11y-dev/serialize` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `extract`, `SerializeOptions`, and the `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` serializers.
  - `@real-a11y-dev/snapshot` (last published `0.1.0-beta.12`) → **there is no drop-in replacement.** The snapshot engine — fingerprints, the diffable `a11y-snapshot.json`, baselines — is now reachable only through the `real-a11y` CLI. `real-a11y snapshot` and `real-a11y diff` take `--format json` and write with `-o`, which is the supported way to drive it from a script or CI. `@real-a11y-dev/mcp` exposes the same engine as MCP tools.

  Every consumer pairs `noExternal` with `dts.resolve`, so no shipped `.d.ts` names a package npm cannot resolve — `surface:check` fails if that regresses, and the packed tarballs were checked directly.

### Patch Changes

- Updated dependencies [f54f398]
- Updated dependencies [80d2b02]
  - @real-a11y-dev/browser@0.1.0-beta.13
  - @real-a11y-dev/core@0.1.0-beta.13

## 0.1.0-beta.2

### Minor Changes

- 823d1cc: `real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

  ```sh
  real-a11y install                           # latest Stable
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # pin an exact build
  ```

  This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

  The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

  `@real-a11y-dev/browser` gains `executablePath` on `BrowserSessionOptions`, plus `resolveChromeExecutable`/`readChromeManifest`/`chromeCacheDir` for anyone building their own installer or launch wiring. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.

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

- 135ccc3: Add **act tools** to the MCP server — `click_element`, `type_text`, and `focus_element` — closing the `checkpoint_tree` → interact → `diff_tree` loop an agent previously couldn't complete alone. Each dispatches a real action over CDP through `A11ySession.act()`, the write side the native producer shipped and nothing drove.

  Targeting is deliberately **role + accessible name** (plus a 1-based `nth` for duplicates), never a CSS selector or node id. `@real-a11y-dev/browser` gains `resolveTarget`, which resolves the query against a **fresh** native tree immediately before each dispatch — node ids stay internal (the serializer invariant holds), staleness shrinks to the instant between resolve and act, and a control that role + name can't reach is surfaced as what it is: an accessibility finding, not a targeting inconvenience. Ambiguity errors list the candidates as copy-paste `nth=` lines; disabled targets are refused with the cause rather than clicked into a void.

  The R1 redaction discipline extends to the new write path's results: `type_text` never echoes the typed value — in success or failure — and backend CDP errors stay content-free.

- abbfd6e: Named browser sessions for the MCP server.

  Every page tool gains an optional `session` parameter (1–32 chars, `A–Z a–z 0–9 _ -`, default `"default"`): separate names are independent live pages with their own findings checkpoints and tree checkpoint, calls within one session are serialized automatically, and different sessions run in parallel — the same registry semantics as the CLI's `--session` daemon, embedded in-process. Sessions launch lazily, are capped by `REAL_A11Y_MCP_MAX_SESSIONS` (default 4), and close on `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS` (default 15 min) or `close_browser`. Both variables must be non-negative integers — hex, fractions, and stray whitespace no longer parse into a limit nobody chose.

  Findings checkpoints outlive their browser: the idle timeout closes pages but keeps the store, because the cross-deploy workflow it exists for (checkpoint prod, review, diff a preview) routinely spans more than 15 minutes. `close_browser` remains the one thing that discards them, and the checkpoint-only tools (`list_checkpoints`, `diff_checkpoints`, `export_checkpoint`, `import_checkpoint`) read the store without launching a browser or spending a session slot.

  Tool surface: new `list_sessions` (name, redacted URL, busy state, timestamps); `close_browser` now takes `session` and `all`, which are not combinable. Auth is unchanged and deliberately session-agnostic: every named session inherits the operator's env-configured storage state / origin allowlist, and `session` never carries credentials.

  `buildServer` now accepts a `SessionManager` (exported, with `McpSessionManager`, `singleSessionManager`, `SessionInfo`, `SESSION_NAME_RE`, and the `SessionRegistryError` / `RegistryShutdownError` classes a custom manager signals refusals with). Passing an `A11ySession` keeps the existing single-page behavior for the default session; on that path a _named_ session is now refused with a remedy rather than silently resolving to the same page and the same checkpoint store.

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

- 38b81b1: Surface three behaviours in the tool descriptions, which is the only documentation an agent actually reads.

  Each of these was already decided deliberately and written down correctly — on the website, in the README, in a code comment — but none of it reaches an MCP client. The tool schema is the agent's entire view of the server, so a caveat that lives anywhere else may as well not exist. All three came out of dogfooding the server from an agent.

  - **`close_browser` discards saved checkpoints.** `checkpoint_findings` promised that checkpoints "survive navigation" with no further qualification, which reads as "survive everything". Both descriptions now state the loss and point at `export_checkpoint` as the way out.
  - **`open_page` reports the browser mode.** Headless is the default, so a human watching for a browser window concluded it never opened. The reply now names the mode, and mentions `REAL_A11Y_MCP_HEADFUL` when there's no window to see — except over `REAL_A11Y_MCP_CDP`, where the attached browser keeps its own window state and that variable does nothing; there it reports the attach instead of guessing at a launch that never happened. `buildServer` gained `headful` and `cdpAttached` options for this — the bin owns both decisions, so the server can only report what it's told.
  - **`open_page` states the session it actually has.** With no saved session, an agent hitting a logged-out page had no way to know the server _can_ authenticate; it now points at `REAL_A11Y_MCP_STORAGE_STATE` and `REAL_A11Y_MCP_CDP` and says plainly not to attempt a login through the tools — there is no credential parameter, deliberately, and env-only shouldn't mean invisible. A CDP attach is its own third case, not a flavour of "unauthenticated": it never carries a storage state (they're mutually exclusive) but reuses the attached browser's own context, so its pages inherit whatever that profile is signed into. It's told to verify what it got rather than assume either way, and that only the human at that window can sign in — telling it to "restart with `REAL_A11Y_MCP_CDP`" would have prescribed the setup already in force.

  No behaviour changes: same tools, same parameters, same results.

- 6785622: fix(mcp,audit): say which diff ran, and why a category came back empty

  Two agent-UX nits from the beta dogfooding pass.

  **Diff headers now name the operation.** `diff_findings` re-reads the live page;
  `diff_checkpoints` compares two stored snapshots and touches no browser. The old
  headers — `Checkpoint diff (vs. saved)` and `Checkpoint diff base → head` — did
  differ, but neither said which operation ran, and the first never said _which_
  checkpoint, so with several stored an output couldn't be traced back to its
  input. Now:

  ```
  Live page vs. saved checkpoint "prod": 1 new, 0 fixed, 0 changed, 12 unchanged.
  Saved checkpoints: "prod" → "preview" (no re-snapshot): 0 new, 2 fixed, …
  ```

  **An empty category explains itself.** `listByRole` returned a bare `(none)`,
  which answers three different questions identically — the page has none of
  these, nothing was extracted, or the category doesn't cover the role you meant.
  Each has a different fix, so the empty case now says which:

  ```
  (none — filter "image" matched 0 of 412 nodes; it looks for role img)
  (none — the tree is empty, so nothing could match filter "image"; the page may
   not have loaded, or extraction failed)
  ```

  The node count separates "this page has none" from "nothing was read". The role
  list is the other half, and carries more weight than it looks: `image` looks for
  exactly `img`, so a page whose graphics are `figure`s reports none — and
  `landmark` includes the `form` role while the `form` filter does not, because
  that one looks for the fields. Both read as a bug until the roles are visible.

  Reaches `real-a11y list` and the MCP's `list_elements`, which share the function.
  The signature is unchanged — still `(root, filter) => string` — so this is a
  change to the text, not to the type. It now never returns an empty string, so a
  caller needs no sentinel of its own.

- 43f085c: fix(mcp): a checkpoint diff across two different pages no longer dumps a structural summary

  Checkpoints deliberately survive navigation, which makes it easy to check one
  route and diff another — and the advisory structural summary then reports the
  whole page as rewritten. Hundreds of added and removed headings, landmarks and
  tab stops, none of which is a regression.

  `diff_findings` and `diff_checkpoints` now compare the two sides' addresses. When
  they are different pages, both name the two URLs and drop that section; findings
  still diff normally, since a `v1:` fingerprint keys on rule + role + locator, not
  on position.

  "Different page" means the path, query or fragment differs — **host, port and
  scheme are ignored on purpose**. Diffing prod against a preview is the headline
  workflow for these tools, and there the structural summary is the whole point.
  An unparseable address is never treated as a mismatch: dropping a section on a
  guess is worse than printing a noisy one.

  A checkpoint also now records where the page **is**, not where `open_page` landed.
  `click_element` can navigate, so those are different addresses — and recording
  the stale one left a diff across two genuinely different pages looking like one
  page twice. `A11ySession` gained `currentUrl()` (already on `BrowserSession`) so
  a consumer holding the interface can read it at extraction time.

- b1d7c33: Fix the published type declarations, which referenced a package that isn't on npm.

  `server.d.ts` shipped `import { SessionInfo } from "@real-a11y-dev/session-registry"` — but that package is private and deliberately never published; it is bundled into the server instead. The **JS** bundling always worked. The declarations are a separate emit, and tsup was not told to inline them, so the `.d.ts` kept pointing at a module npm cannot resolve.

  For a consumer that meant one of two things, and the second is the reason this went unnoticed:

  - with `skipLibCheck: false`, a hard `TS2307` — cannot find module;
  - with `skipLibCheck: true` (the common default), **no error at all** — `SessionInfo`, `SessionRegistryError`, and `RegistryShutdownError` silently degraded to `any`, so part of the public `SessionManager` contract stopped type-checking while everything looked fine.

  Those three names are part of the contract on purpose: a third-party session manager signals refusals by throwing `SessionRegistryError`, and an error class it cannot import is a contract it cannot implement. They are now inlined into the published declarations, so they arrive with real shapes and nothing points at the private package. `session-registry` stays private and unpublished.

  No API change — the same names are exported, from the same entry point.

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

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- d693a00: Surface the focused element to agents. `get_semantic_tree`, `get_tab_order`, and `inspect_page` now mark the element focused at capture time with a trailing `[focused]` (inherited from the serialize layer), so an agent can see that opening a dialog moved focus into it, or which control a keyboard user is on. Tool descriptions note the marker.

  `compare_trees` explicitly opts out (`markFocus: false`): Chromium's native tree carries no focus marker, so a `[focused]` suffix on the custom side would register as a spurious custom-vs-native divergence.

- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

- 91246b9: Make `producer: "native"` consistent across the MCP tools, and rename `compare_trees`.

  - **`producer: "native"` now works on every tree/findings/outline/list tool** — added to `get_semantic_tree`, `get_heading_outline`, and `list_elements` (it was already on `audit_page` / `inspect_page`). One rule: every tool that projects a tree/findings/outline/element-list takes `producer`; native is whole-document (`rootSelector` must be `"body"`).
  - **`get_tab_order` stays DOM-only** — a native tree carries no tab order, so the tool takes no `producer`.
  - **Removed `get_native_tree`** — it's now `get_semantic_tree` with `producer: "native"` (one canonical native tree, not two subtly-different serializations).
  - **Renamed `compare_trees` → `compare_producers`** — it diffs the DOM producer against the native producer (a _producer_ comparison at one instant), and the old name was easily confused with `diff_checkpoints` (a _temporal_ comparison of two checkpoints). It now compares against the same canonical native producer `get_semantic_tree { producer: "native" }` exposes, so a divergence it reports matches what you'd see there.

  Breaking for callers of `get_native_tree` (use `get_semantic_tree { producer: "native" }`) or `compare_trees` (use `compare_producers`).

- 484c49d: `audit_page` and `inspect_page` accept `producer: "native"` — audit Chromium's own accessibility tree.

  The default (`producer: "dom"`, unchanged) walks the page's light DOM. Passing `producer: "native"` runs the same audit over **Chromium's own accessibility tree** (read over CDP via `@real-a11y-dev/browser`'s `nativeTree`, serialized + audited in Node through `@real-a11y-dev/snapshot`'s `projectNativeTree`) — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. This is the difference between _viewing_ the native tree (`get_native_tree`, unchanged) and _auditing_ it.

  Native is whole-document and read-only: `rootSelector` must stay `"body"` (any other value is refused, since native can't scope), and a native tree carries no tab order — so `inspect_page`'s tab-order section reports N/A rather than an empty block. Chromium only.

- 0680dc9: Add **tree checkpoints** to the MCP server — the interaction diff. `checkpoint_tree` captures the current accessibility tree; after an interaction, `diff_tree` reports exactly which nodes were added, removed, or changed, plus where focus moved.

  Where the snapshot checkpoints answer _"what accessibility problems changed?"_, these answer _"what did that click change?"_ — making an interaction's effect legible: that opening a dialog added a `dialog` node **and** moved focus into it, or that a "Load more" button appended twelve links but left focus stranded.

  The captured tree lives **inside the page** — `@real-a11y-dev/browser`'s page-bundle gains `checkpointTree` / `diffSinceCheckpoint`, built on core's `diffTrees` and serialize's `serializeTreeDiff` — because node identities are realm-bound, so only the rendered diff ever crosses the boundary. That makes a tree checkpoint **page-instance-bound**: it is discarded on navigation, the deliberate asymmetry with snapshot checkpoints, which survive it. `diff_tree` re-extracts with the root the checkpoint was captured with unless you override it, so the comparison stays like-for-like.

### Patch Changes

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

- 9c3517c: The MCP server can now audit pages behind a login. Set `REAL_A11Y_MCP_STORAGE_STATE` to a saved Playwright storage-state file (create it out-of-band, e.g. with `real-a11y login`) and every page opens already authenticated — the session is operator-configured, never a tool parameter, so tokens never enter the agent's context. `REAL_A11Y_MCP_ALLOWED_ORIGINS` pins auditing to a comma-separated allowlist so a redirect can't route the session to an unintended site (the engine refuses extraction off-allowlist).

  The server validates the storage-state file at startup and refuses to boot if it's missing or malformed (a server that silently audits logged-out pages is worse than one that won't start), and rejects `STORAGE_STATE` combined with `REAL_A11Y_MCP_CDP`. When a session is loaded, `open_page` tells the agent so in its description and result — a boolean fact, never the path or contents — so it doesn't try to "fix" an already-authenticated page by logging in.

- 18dda52: New `@real-a11y-dev/mcp/browser` subpath export: `BrowserSession` (plus `OpenOptions`, `assertOpenableUrl`, and the session types) without loading the MCP SDK graph — the root export's module top-level imports the SDK and zod, which consumers that only want the browser session (like `@real-a11y-dev/cli`) shouldn't pay for. `BrowserSessionOptions` also gains an optional `proxy` pass-through to Chromium's launch options, since Chromium ignores `HTTP_PROXY`/`HTTPS_PROXY` env vars on its own. The playwright peer is now marked optional (`peerDependenciesMeta`) to match the lazy import — importing the server API (or the browser subpath's types) never requires a browser install, and downstream packages with a playwright-free surface no longer inherit an unmet-peer warning. The root export is unchanged.
- 32fc4e6: New package `@real-a11y-dev/mcp` — a Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents over stdio. Point any MCP client at it (`npx -y @real-a11y-dev/mcp`) and an agent can open a page and reason about what assistive tech actually perceives.

  Audit-first: `audit_page` runs the same rule engine as `@real-a11y-dev/testing` (`collectFindings`) and returns every violation — unlabeled controls, skipped heading levels, unlabeled dialogs, broken landmark structure — grouped and with per-instance CSS locators. `inspect_page` returns the findings plus the semantic tree, heading outline, and tab order from ONE extraction, so a multi-view report can't be internally inconsistent on a dynamic page. Perception primitives (`get_semantic_tree`, `get_heading_outline`, `get_tab_order`, `list_elements`) let it stand alone without a separate browser-automation MCP; `open_page` handles navigation, settle waits, and mobile/tablet device emulation.

  Two MCP-only tools cross-check the custom engine against the browser's own tree: `get_native_tree` reads Chromium's authoritative accessibility tree via CDP, and `compare_trees` diffs the two and reports where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs.

  Playwright is a peer dependency, lazily imported, so importing the server API (`buildServer`, types) never requires a browser to be installed. `file://` navigation is refused by default (an LLM-driven local-file exfiltration primitive) unless `REAL_A11Y_MCP_ALLOW_FILE=1`.

- 18dda52: `BrowserSession` can now load an authenticated session and pin the audited origin — the engine half of auditing pages behind a login. `BrowserSessionOptions` gains `storageState` (a Playwright storage-state file path, loaded into every launched context so pages open already authenticated; it survives device-emulation context rebuilds and is rejected together with `cdpEndpoint`) and `allowedOrigins` (when set, extraction is refused unless the page's final post-redirect origin is in the allowlist — the control that stops a redirect from an intended target to a recorded cookie domain from silently auditing an unintended authenticated page). A new `captureStorageState()` method returns the current context's cookies + origin storage for a "save the session" flow. Auth material is always caller-configured, never derived from tool input. The agent-facing MCP server surface (env vars, tool descriptions) is unchanged in this release.

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
  - @real-a11y-dev/testing@0.1.0-beta.10
