# @real-a11y-dev/testing

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
