---
"@real-a11y-dev/audit": minor
---

Export `assertRules` and `formatFindings`, and make the audit engine run in plain Node over a pre-extracted tree.

- **`assertRules(root, rules)`** is now public: throw an `A11yAssertionError` for an arbitrary subset of rules over either a DOM `Element` or an already-extracted `ExtractionResult`. The single-rule `assert*` helpers are thin wrappers over it. This is what lets a caller run the audit rules against a **native** tree (Chromium's a11y tree read over CDP) without a DOM.
- **`formatFindings(findings)`** is exported — the multi-line message builder the `assert*` helpers throw — so a custom reporter can reuse the exact wording.
- **DOM-less runtime fix:** `collectFindings` / `listByRole` / `assertRules` used a bare `root instanceof Element`, which throws `ReferenceError: Element is not defined` in any runtime without a DOM `Element` global. They now feature-detect the global first (the same guard `@real-a11y-dev/serialize` already uses), so auditing an `ExtractionResult` from a non-DOM producer works in Node. Behavior in jsdom, browsers, and the extension panel is unchanged.
