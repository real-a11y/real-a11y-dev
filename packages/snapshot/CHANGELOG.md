# @real-a11y-dev/snapshot

## 0.1.0-beta.12

### Minor Changes

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

### Patch Changes

- Updated dependencies [e4e9c89]
- Updated dependencies [cd20458]
- Updated dependencies [229c5ac]
- Updated dependencies [c15960d]
- Updated dependencies [6785622]
- Updated dependencies [4aa1036]
- Updated dependencies [b304069]
- Updated dependencies [2f2ab7b]
- Updated dependencies [1ef740a]
- Updated dependencies [3b4967b]
- Updated dependencies [4d982ce]
- Updated dependencies [a4cfac8]
- Updated dependencies [3ab20f2]
  - @real-a11y-dev/core@0.1.0-beta.12
  - @real-a11y-dev/audit@0.1.0-beta.12
  - @real-a11y-dev/serialize@0.1.0-beta.12

## 0.1.0-beta.11

### Minor Changes

- 31deea2: `--producer native` — audit Chromium's own accessibility tree from the CLI.

  The default (`--producer dom`, unchanged) injects the page-bundle and walks the light DOM in the page. `--producer native` instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and serializes + audits it in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root:

  ```sh
  real-a11y tree https://example.com/player --producer native   # media controls appear
  real-a11y audit https://example.com/player --producer native  # and get audited
  real-a11y outline https://example.com --producer native
  ```

  Native is whole-document and read-only, so the flag is accepted only where that fits: `audit`, `tree`, and `outline`. Commands that carry a tab sequence (`tabs`, `inspect`, `snapshot`) or run the in-page `listByRole` (`list`) reject `--producer native` with guidance, and `--producer native` can't be combined with `--root` (it audits the whole document).

  `@real-a11y-dev/snapshot` gains `projectNativeTree(tree, options?)` — the shared projection that turns a native `ExtractionResult` into the same `CleanSnapshot` the DOM producer yields (serialize + audit in Node, empty tab order). It's what the CLI's native path builds on, and it's reusable by any consumer opting into the native producer.

- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

- ba4ba95: New package `@real-a11y-dev/snapshot` — the snapshot engine, extracted from `@real-a11y-dev/cli`. It owns the deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines, depending on nothing but `@real-a11y-dev/audit` and `@real-a11y-dev/core`. It's Node-only (`node:crypto`) and never enters the page bundle, which makes it the single place a snapshot is captured and compared — so a snapshot taken by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical. The `CliError` the artifact and baseline readers used to throw is now a domain `SnapshotFormatError`.

  **Breaking for `@real-a11y-dev/cli`: it no longer exposes a programmatic `.` library entry — the CLI is a command, not a library.** Everything the old `api` surface re-exported (fingerprints, the artifact, the findings/views/unified diff, baselines, sanitization) now lives in `@real-a11y-dev/snapshot`; import it from there instead. The `real-a11y` binary — its commands, flags, output, and exit codes — is byte-for-byte unchanged (verified against the CLI e2e suite). The CLI also drops its direct `@real-a11y-dev/core` dependency (it followed the engine into `snapshot`) and gains `@real-a11y-dev/snapshot`.

### Patch Changes

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [4fe0c7b]
- Updated dependencies [8c2a8fa]
- Updated dependencies [2915bc7]
- Updated dependencies [77b4bf2]
- Updated dependencies [22abf6b]
  - @real-a11y-dev/serialize@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/audit@0.1.0-beta.11
