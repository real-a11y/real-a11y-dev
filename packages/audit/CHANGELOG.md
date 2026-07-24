# @real-a11y-dev/audit

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
