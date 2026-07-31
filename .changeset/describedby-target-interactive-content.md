---
"@real-a11y-dev/core": minor
---

Keep an `aria-describedby` target in the tree when its subtree contains interactive content. Targets are suppressed because their text is already shown inline as the referencing element's description — but the suppression dropped the target's whole subtree with it, so a control living inside help text disappeared. The everyday case is a link:

```html
<input aria-describedby="pw-help" />
<p id="pw-help">Must be 8+ characters. <a href="/rules">Full rules</a></p>
```

"Full rules" is visible, focusable content an AT user can tab to and activate, yet it was absent from both the DOM and a11y views — and from everything derived from them (the panel, search, serialization, audits). A description target is now suppressed only when nothing in it is actionable, using the same `getActions` predicate that sets `interaction.isInteractive` (which also covers plain `[tabindex]` focusables).

**Breaking change:** extraction output grows for pages using this pattern. A description target that holds a control — and that control, plus any nodes between them — now appears in the tree where it previously did not.

Migration: re-record tree snapshots that cover an `aria-describedby` target with interactive content. Audits now see those newly-visible nodes, so a suite that was green may surface findings for controls inside help text (for example an unlabeled icon link); these are real defects the tree was previously hiding, and should be fixed on the page rather than re-suppressed. Nothing changes for text-only description targets, which are the common case.
