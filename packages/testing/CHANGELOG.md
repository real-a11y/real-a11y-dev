# @real-a11y-dev/testing

## 0.1.0-beta.10

### Minor Changes

- d8eaaf7: Add `collectFindings(root, rules?)` — a non-throwing audit primitive that runs the accessibility rules over a single extraction and returns every violation as a structured `Finding[]` (rule, severity, message, and the offending role/name/tagName). The four `assert*` helpers are now thin wrappers over it, so running all rules is one tree extraction instead of four and reports all violations rather than stopping at the first.

  `collectFindings` accepts either a DOM `Element` or an already-extracted `ExtractionResult`. Passing a pre-extracted tree lets callers run the rules over the **same snapshot** used for the serialized tree, outline, and tab order — so a multi-view report can't be internally inconsistent on a dynamic page.

  Each `Finding` now carries a best-effort **`locator`** (a CSS selector path — an element id when present, else an `nth-of-type` chain) and **`context`** (`href`, nearest landmark), resolved via the extraction's element-ref map, so a finding can be acted on without cross-referencing the tree by hand. Severity is now **graded**: unlabeled controls and unlabeled dialogs are `error`; heading-order, duplicate landmarks, and images without a name are `warning`.

  Adds a new **`image-alt`** rule — flags `img`-role nodes with no accessible name (decorative `alt=""` images map to `presentation` and are excluded, so this only catches genuinely missing names).

  Also adds `listByRole(root, filter)` — lists every element in a category (`link`, `button`, `form`, `landmark`, `image`, `heading`, using the same `ROLE_FILTER_GROUPS` the extension's filter tabs use) as `role "name"` plus a locator. A token-efficient way to review one kind of element at a time.

  New exports: `collectFindings`, `listByRole`, `ALL_RULES`, and the `Finding` / `A11yRule` / `RoleFilter` types. The existing `assert*` functions keep their throwing behavior (each still fails on its own rule), but since they now report through the shared finding format, the thrown message is unified to `Found N accessibility issue(s):\n  - <finding>` (with the locator appended) rather than each helper's previous bespoke wording — update any tests that string-match the old message.

### Patch Changes

- 7a56937: DomObserver: add a max-wait ceiling to the mutation debounce. The debounce was trailing-only, so a page that mutates faster than the debounce interval — streaming AI responses, progress bars, live tickers, animated `style` updates — kept resetting the timer and `onTreeChange` never fired, leaving consumers (the extension side panel, `testing`'s `flow()`/`waitForMutations`) frozen for the whole stream. A second, non-resetting ceiling timer now forces a flush at least every `maxWaitMs` (new optional constructor arg, default 1000ms, clamped to at least the debounce interval).

  `testing`'s `waitForMutations` now threads its `timeout` through as the observer's ceiling, so the new default ceiling can't resolve a `timeout > 1000` wait early — its documented `timeout` contract is preserved.

- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/core@0.1.0-beta.10
  - @real-a11y-dev/serialize@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9
  - @real-a11y-dev/serialize@0.1.0-beta.9

## 0.1.0-beta.7

### Minor Changes

- 194b6ad: Add custom `expect` matchers for Vitest and Jest — `toHaveNoUnlabeledInteractive`, `toHaveValidHeadingOrder`, `toHaveLabeledDialogs`, `toHaveValidLandmarks`, and `toHaveTabSequence` — plus an `a11ySnapshot()` serializer that renders the semantic tree directly into `toMatchSnapshot()` / `toMatchInlineSnapshot()`. They ship from the new opt-in `@real-a11y-dev/testing/matchers` entry point (with a `@real-a11y-dev/testing/matchers/vitest` types augmentation) and register via `registerA11yMatchers(expect)`, so the package's main entry stays side-effect-free.

  The Playwright adapter's `auditSnapshot()` now accepts the same `redact`, `mode`, and `includeGeneric` options as the jsdom helper, marshalling each `RegExp` across the `page.evaluate()` boundary so snapshots stay deterministic in real-browser runs.

- 1270667: New package `@real-a11y-dev/validate` — ARIA semantics validation over the accessibility tree. `validateNode` runs the per-node rules (valid role, required accessible name and attributes, direct required context); `validateTree` runs the relationship rules that need the whole tree — interactive nesting (a `link` inside a `button`), presentational-children misuse (interactive/composite content inside `button`/`link`/…), and required-owned containers (an empty `tablist`, `list`, …). Rules are `aria-query`-backed so they never drift from the spec, and everything runs over a minimal `ValidatedNode` shape, so a tree authored ahead of code or extracted from the DOM is checked by one engine. `@real-a11y-dev/core` stays dependency-free — the `aria-query` dependency lives here.

  `@real-a11y-dev/testing` gains a `toBeValidA11yTree()` matcher (Vitest + Jest, from the `@real-a11y-dev/testing/matchers` entry): it extracts an element's accessibility tree, runs both validators, and fails on ARIA errors — invalid roles, missing required names/attributes, and the relationship violations above.

### Patch Changes

- 7df0e4d: New package `@real-a11y-dev/serialize` — the canonical, deterministic text serialization of the accessibility tree: `serializeTree`, `serializeOutline`, and `serializeTabSequence`, each accepting a DOM root **or** a pre-extracted `@real-a11y-dev/core` tree. It's the single source of truth for the snapshot string format shared by the testing package, the docs panel, and (next) the Chrome extension's tree export.

  `@real-a11y-dev/testing` now consumes this package and re-exports the serializers under its existing snapshot names (`auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `serializeTree`). No public API or output change — purely an internal extraction.

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
- Updated dependencies [7df0e4d]
- Updated dependencies [1270667]
  - @real-a11y-dev/core@0.1.0-beta.7
  - @real-a11y-dev/serialize@0.1.0-beta.7
  - @real-a11y-dev/validate@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies [488ca27]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
