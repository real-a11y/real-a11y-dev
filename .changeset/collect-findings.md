---
"@real-a11y-dev/testing": minor
---

Add `collectFindings(root, rules?)` — a non-throwing audit primitive that runs the accessibility rules over a single extraction and returns every violation as a structured `Finding[]` (rule, severity, message, and the offending role/name/tagName). The four `assert*` helpers are now thin wrappers over it, so running all rules is one tree extraction instead of four and reports all violations rather than stopping at the first.

`collectFindings` accepts either a DOM `Element` or an already-extracted `ExtractionResult`. Passing a pre-extracted tree lets callers run the rules over the **same snapshot** used for the serialized tree, outline, and tab order — so a multi-view report can't be internally inconsistent on a dynamic page.

Each `Finding` now carries a best-effort **`locator`** (a CSS selector path — an element id when present, else an `nth-of-type` chain) and **`context`** (`href`, nearest landmark), resolved via the extraction's element-ref map, so a finding can be acted on without cross-referencing the tree by hand. Severity is now **graded**: unlabeled controls and unlabeled dialogs are `error`; heading-order, duplicate landmarks, and images without a name are `warning`.

Adds a new **`image-alt`** rule — flags `img`-role nodes with no accessible name (decorative `alt=""` images map to `presentation` and are excluded, so this only catches genuinely missing names).

Also adds `listByRole(root, filter)` — lists every element in a category (`link`, `button`, `form`, `landmark`, `image`, `heading`, using the same `ROLE_FILTER_GROUPS` the extension's filter tabs use) as `role "name"` plus a locator. A token-efficient way to review one kind of element at a time.

New exports: `collectFindings`, `listByRole`, `ALL_RULES`, and the `Finding` / `A11yRule` / `RoleFilter` types. The existing `assert*` functions keep their throwing behavior (each still fails on its own rule), but since they now report through the shared finding format, the thrown message is unified to `Found N accessibility issue(s):\n  - <finding>` (with the locator appended) rather than each helper's previous bespoke wording — update any tests that string-match the old message.
