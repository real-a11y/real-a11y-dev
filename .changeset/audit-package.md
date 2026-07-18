---
"@real-a11y-dev/audit": minor
"@real-a11y-dev/testing": patch
---

New package `@real-a11y-dev/audit` — the audit engine, extracted from `@real-a11y-dev/testing` as the single home for what an accessibility _finding_ is and how it's detected: the `Finding` data model, the rule set (`ALL_RULES`), the non-throwing `collectFindings`, the `listByRole` review helper, and the throwing `assert*` primitives (`assertNoUnlabeledInteractive`, `assertHeadingOrder`, `assertDialogsLabeled`, `assertLandmarkStructure`). It depends only on `@real-a11y-dev/core`, so a production consumer can reach the engine without pulling in a test-helper package.

`@real-a11y-dev/testing` now consumes this package and re-exports the same `assert*`/`collectFindings`/`listByRole` surface under its existing names. No public API or output change — purely an internal extraction; existing imports from `@real-a11y-dev/testing` keep working unchanged.
