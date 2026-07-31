---
"@real-a11y-dev/core": minor
---

Keep an `aria-describedby` target in the tree when its subtree contains interactive content. Targets are suppressed because their text is already shown inline as the referencing element's description — but the suppression dropped the target's whole subtree with it, so a control living inside help text disappeared. The everyday case is a link:

```html
<input aria-describedby="pw-help" />
<p id="pw-help">Must be 8+ characters. <a href="/rules">Full rules</a></p>
```

"Full rules" is visible, focusable content an AT user can tab to and activate, yet it was absent from both the DOM and a11y views — and from everything derived from them (the panel, search, serialization, audits). A description target is now suppressed only when it holds no control a user can actually reach, using the same `getActions` predicate that sets `interaction.isInteractive`, with two narrowings so the exception stays tight:

- Only a control that actually reaches the tree counts. One the walk never emits (hidden, inside a skipped element, or among a media element's fallback children) or that AT can't see (`aria-hidden`, `visibility:hidden`) does not keep the target alive — otherwise the target returns as a redundant node while the control it was kept for never appears.
- A bare `tabindex="-1"` does not count. It is programmatic-focus plumbing (the standard way to move focus to a `role="alert"` error container), not something a user can tab to, so text-only help and error text stays suppressed as before.

`LiveTreeExtractor` keeps up with this: the verdict now depends on the target's whole subtree, so a mutation anywhere inside one re-evaluates the target itself. A watched page that loses (or hides) the last control in its help text drops the target node, instead of leaving a stale duplicate in the panel and audits.

**Breaking change:** extraction output grows for pages using this pattern. A description target that holds a control — and that control, plus any nodes between them — now appears in the tree where it previously did not.

Migration: re-record tree snapshots that cover an `aria-describedby` target with interactive content. Audits now see those newly-visible nodes, so a suite that was green may surface findings for controls inside help text (for example an unlabeled icon link); these are real defects the tree was previously hiding, and should be fixed on the page rather than re-suppressed. Nothing changes for text-only description targets, which are the common case.
