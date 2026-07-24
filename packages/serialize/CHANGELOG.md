# @real-a11y-dev/serialize

## 0.1.0-beta.11

### Minor Changes

- 1d0eef0: Add a11y **contract verification** — assert that a tree satisfies an authored contract instead of snapshotting the whole thing.

  A contract is a partial tree in the same `role "name" (level N)` grammar the snapshots use. `@real-a11y-dev/testing` gains a `toMatchA11yContract(contract, { strict? })` matcher (the `toMatchObject` of a11y trees): containment by default with ancestor semantics — every contract node must appear, in order, nested under its parent's match, but **extra nodes in the implementation are allowed**, so a contract survives cosmetic churn and fails only on a structural regression (a `<button>` shipped as a `<div>`, a demoted heading, a field that lost its label). Received may be a DOM Element or an already-serialized string, so a committed snapshot artifact can be checked too; names fold typographic punctuation; `strict: true` switches to exact equality. Failures pinpoint the first missing node and why.

  `@real-a11y-dev/serialize` exports `foldTypography` — the accessible-name typography normalizer (curly quotes, ellipsis, dashes, NBSP, NFC), used by the testing package's name matchers at comparison time. Serialized output itself is never folded; it stays faithful to what assistive tech announces.

- d693a00: Mark the focused element in the tree, outline, and tab-order serializations with a trailing `[focused]`. This makes focus management — invisible in a plain tree dump — a one-line, committable assertion: "opening this dialog moved focus onto its heading", "this control is where focus lands after the click".

  ```
  form "Sign-in form"
    textbox "Email" [focused]
    button "Sign in"
  ```

  On by default (new `SerializeOptions.markFocus`, default `true`); pass `markFocus: false` for marker-free output. `serializeOutline` and `serializeTabSequence` now accept an options argument too. The marker is deterministic (same steps → same focus → same string) and appears **only when something inside the tree actually holds focus** — a fresh page (focus on `<body>`) serializes unchanged.

  **Upgrading:** a committed snapshot captured _after_ an interaction that moved focus will gain a `[focused]` line the first time you run it on this version — the marker surfacing focus the snapshot was omitting. Review the diff and re-record once (`-u`). Snapshots of un-interacted UI are unaffected. To keep the old marker-free output, pass `markFocus: false`.

- 4fe0c7b: Fix indentation when hidden nodes are dropped, so the serialized tree reflects real nesting. `serializeTree` indented each line by `node.depth` — the node's depth in the _extracted_ tree — while also hiding nodes from the output. A hidden node's indent level stayed behind, so its children rendered under whatever printed line happened to precede them.

  Concretely, `<main><h1>Dash</h1><div aria-label="Decor"><a href="/more">More</a></div></main>` serialized as:

  ```
    main
      heading "Dash" (level 1)
        link "More"
  ```

  The link is a sibling of the heading, not its child — and `main` is indented under a root that was never printed. It now serializes as:

  ```
  main
    heading "Dash" (level 1)
    link "More"
  ```

  Indent is now the node's number of _printed_ ancestors. Three cases were affected, all where a node reaches the serializer and is dropped at print time rather than flattened during extraction:

  - **The root.** The extractor keeps the root even when it's generic (`<body>`, or a test-mount wrapper), so dropping it left every line indented by one level. Every tree snapshot started at indent 2.
  - **Named or interactive generics.** The a11y extractor deliberately keeps these; the serializer drops them, orphaning their children (the case above).
  - **`mode: "dom"`.** No extraction-time flattening happens, so every wrapper is a generic the serializer drops — indentation there could be off by several levels.

  Unnamed, non-interactive generics were never affected: the a11y extractor flattens those during extraction and rebases depth correctly.

  **This churns committed tree snapshots.** Baselines shift left by one level (the dropped root), and any tree containing a named/interactive generic re-nests to its true shape. Re-record with your framework's update flag (`vitest -u`, `jest -u`, `playwright --update-snapshots`) or `real-a11y snapshot`, and expect a one-time diff. Heading-outline and tab-sequence snapshots are unaffected — they don't use tree depth. `includeGeneric: true` output is unchanged, since nothing is dropped.

- 22abf6b: Add `serializeTreeDiff(diff, options?)` — render a `TreeDiff` from core's `diffTrees` as a deterministic, committable change list. This is the renderer that turns tree diffing from a raw primitive into something you can assert on: what **one interaction changed**, in a line each.

  ```
  + option "Spain"
  + option "France"
  ~ combobox "Country": a11y.states.expanded false → true
  ~ listbox "Countries": childIds 0 children → 2 children
  focus: button "Country" → listbox "Countries"
  ```

  One line per added (`+`) / removed (`-`) node and per changed field (`~`), in document order, then an optional focus transition. Nodes are labeled `role "name" (level N)` in the same vocabulary as `serializeTree` — **never a node id** (ids are a global counter; a committed snapshot containing one would flake with test order), which is also why a child-list change renders as counts (`3 children → 5 children`). A pure **reorder** — which core flags even when the count is unchanged — renders `childIds reordered (3 children)` (never a misleading identical `3 → 3`), and a membership change that also reorders the survivors is annotated `… (reordered)`, so a tab-order/menu reorder regression is visible in a committed snapshot. A field present on only one side reads `(unset)`; `redact` masks names and string values; an empty diff renders `(no changes)`.

  `focusBefore`/`focusAfter` are supplied by the caller — a tree captured earlier can't answer "what was focused then" after the fact (`ExtractionResult.focusedId` records it at capture time), and core's `diffTrees` stays focus-agnostic. A `(none)` side is how a focus-management bug becomes visible: `focus: button "Save" → (none)`.

### Patch Changes

- 8c2a8fa: `serializeTree` / `serializeOutline` / `serializeTabSequence` now work in plain Node when given a pre-extracted tree.

  The input check was a bare `input instanceof Element`, which throws `TypeError: Right-hand side of 'instanceof' is not an object` in any runtime without a DOM `Element` global — making every serializer unusable on a perfectly good `ExtractionResult` (a deserialized snapshot, a native browser tree read over CDP) outside jsdom/browser. The check now feature-detects the global first: no `Element` global means the caller can't be holding a DOM root, so the input is treated as an already-extracted tree. Behavior in jsdom, browsers, and the extension panel is unchanged.

- 2915bc7: Fix `serializeTree`/`serializeTreeDiff` redaction leaking repeated matches. `redact` patterns were applied with a plain `String.prototype.replace`, which only replaces the **first** match unless the RegExp is global — so a name or change value holding a pattern twice (two `$`-amounts, two "N minutes ago" timestamps, a repeated token) leaked every occurrence after the first into output that is meant to be a deterministic, PII-free, committable snapshot. Each `redact` pattern is now normalized to global once per serialize call before use (an already-global pattern is left untouched), so **all** occurrences are redacted.
- 77b4bf2: Fix `serializeOutline` and `serializeTabSequence` silently ignoring the `redact` option. Both functions accept `SerializeOptions` — whose `redact` is documented as stripping matching substrings from accessible names — but neither applied it: the heading outline emitted `e.name` raw and the tab sequence emitted `n.a11y.name` raw, so passing `redact` was a no-op that leaked user data / timestamps into output meant to be a deterministic, PII-free, committable snapshot. Both now normalize each `redact` pattern to global once per call (matching `serializeTree`/`serializeTreeDiff`) and mask **every** occurrence of every pattern.
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
  - @real-a11y-dev/core@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/core@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9

## 0.1.0-beta.7

### Minor Changes

- 7df0e4d: New package `@real-a11y-dev/serialize` — the canonical, deterministic text serialization of the accessibility tree: `serializeTree`, `serializeOutline`, and `serializeTabSequence`, each accepting a DOM root **or** a pre-extracted `@real-a11y-dev/core` tree. It's the single source of truth for the snapshot string format shared by the testing package, the docs panel, and (next) the Chrome extension's tree export.

  `@real-a11y-dev/testing` now consumes this package and re-exports the serializers under its existing snapshot names (`auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `serializeTree`). No public API or output change — purely an internal extraction.

### Patch Changes

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
  - @real-a11y-dev/core@0.1.0-beta.7
