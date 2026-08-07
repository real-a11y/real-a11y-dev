# @real-a11y-dev/audit

## 0.1.0-beta.12

### Minor Changes

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

- b304069: Findings from the native producer now say **where**.

  `audit` is rule · severity · locator, but `--producer native` (and MCP `producer: "native"`) reported every finding with no locator at all — a real defect with no address. The DOM producer derives the locator from a live `Element` it holds in an in-page map; the native producer runs in Node over a CDP snapshot and has no such element, so nothing was left to derive from.

  The path is now computed during the `DOM.getDocument` walk the native producer already makes — the only place it ever sees parent and sibling links, and free, since that walk was happening anyway. Both producers share one builder (`buildCssPath`, exported from `@real-a11y-dev/core` with `CssPathAdapter` and `DOM_ELEMENT_ADAPTER`), each supplying accessors for its own node shape, so `#panel > div > img:nth-of-type(2)` means the same thing whichever producer found the problem. `SemanticNode["dom"]` gains an optional `locator` to carry it. `list_elements` / `listByRole` gain native locators for the same reason, and the docs that said native had none are corrected.

  ```
  # before                          # after
  image-alt   locator: (none)       image-alt   locator: body > main > img
  image-alt   locator: (none)       image-alt   locator: #panel > div > img
  ```

  One case has no honest answer and is treated as one: the native walk pierces shadow roots and the in-page walk doesn't, so native alone reaches elements with no whole-document selector. Those paths stop at the boundary — `button:nth-of-type(2)`, not a `#document-fragment > button` that would look queryable and match nothing.

  **Native snapshots taken before this will not diff cleanly against ones taken after.** A finding's fingerprint includes its locator, so native findings that previously fingerprinted with an empty anchor now fingerprint with a real one: `real-a11y diff` will read a re-run of an unchanged page as every finding fixed and re-introduced. Re-baseline native artifacts once. DOM-producer artifacts are unaffected — their locators never changed.

### Patch Changes

- Updated dependencies [e4e9c89]
- Updated dependencies [cd20458]
- Updated dependencies [229c5ac]
- Updated dependencies [c15960d]
- Updated dependencies [4aa1036]
- Updated dependencies [b304069]
- Updated dependencies [2f2ab7b]
- Updated dependencies [1ef740a]
- Updated dependencies [3b4967b]
- Updated dependencies [4d982ce]
- Updated dependencies [3ab20f2]
  - @real-a11y-dev/core@0.1.0-beta.12

## 0.1.0-beta.11

### Minor Changes

- beae032: Export `assertRules` and `formatFindings`, and make the audit engine run in plain Node over a pre-extracted tree.

  - **`assertRules(root, rules)`** is now public: throw an `A11yAssertionError` for an arbitrary subset of rules over either a DOM `Element` or an already-extracted `ExtractionResult`. The single-rule `assert*` helpers are thin wrappers over it. This is what lets a caller run the audit rules against a **native** tree (Chromium's a11y tree read over CDP) without a DOM.
  - **`formatFindings(findings)`** is exported — the multi-line message builder the `assert*` helpers throw — so a custom reporter can reuse the exact wording.
  - **DOM-less runtime fix:** `collectFindings` / `listByRole` / `assertRules` used a bare `root instanceof Element`, which throws `ReferenceError: Element is not defined` in any runtime without a DOM `Element` global. They now feature-detect the global first (the same guard `@real-a11y-dev/serialize` already uses), so auditing an `ExtractionResult` from a non-DOM producer works in Node. Behavior in jsdom, browsers, and the extension panel is unchanged.

- cafe048: New package `@real-a11y-dev/audit` — the audit engine, extracted from `@real-a11y-dev/testing` as the single home for what an accessibility _finding_ is and how it's detected: the `Finding` data model, the rule set (`ALL_RULES`), the non-throwing `collectFindings`, the `listByRole` review helper, and the throwing `assert*` primitives (`assertNoUnlabeledInteractive`, `assertHeadingOrder`, `assertDialogsLabeled`, `assertLandmarkStructure`). It depends only on `@real-a11y-dev/core`, so a production consumer can reach the engine without pulling in a test-helper package.

  `@real-a11y-dev/testing` now consumes this package and re-exports the same `assert*`/`collectFindings`/`listByRole` surface under its existing names. No public API or output change — purely an internal extraction; existing imports from `@real-a11y-dev/testing` keep working unchanged.

### Patch Changes

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
