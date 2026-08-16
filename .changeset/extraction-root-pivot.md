---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

Never widen extraction away from a root that isn't in the document.

Extraction widens to the whole document when a portal-mounted overlay sits
outside the root — so a React-portalled menu joins the tree with its trigger.
For an **attached** root that is loss-free: the document contains it, so
widening only adds.

For a root the document does **not** contain it is not. The document is then a
disjoint tree, so the caller's own subtree disappeared and the audit described
markup they never passed. That covers two shapes: a detached root, and a root
inside a **shadow root** — `isConnected` is shadow-including while the walk
reads light-DOM `children`, so a web component audited at its shadow subtree
lost all of its content to any light-DOM toast.

```js
document.body.innerHTML = '<p role="status">4 tickets</p>';
const root = document.createElement("div");
root.innerHTML = "<button>Save</button>";

auditSnapshot(root); // → 'status "4 tickets"' — the button is absent
collectFindings(root); // → []  ← reads as a clean component
```

That last line is the damage: an audit that reports nothing because it ran
against somebody else's DOM. Detached roots are ordinary — a jsdom fixture
built with `createElement`, or a component inspected before mount.

Both widening paths are fixed, not just the portal one: the modal path never
looked at the root at all, so an open dialog anywhere in the document hijacked
a detached or shadow-rooted root just as readily, and it runs first. A modal
still scopes **exclusively** over a root the document contains, including a
sibling one — content behind a modal is inert to AT, and that is deliberate.

An **ancestor** live region is no longer treated as a portal either. "Outside
the root" was accepting anything above it too, so the route announcer that
Next.js, Remix and React Router wrap around the whole app matched on every
extraction — pivoting every component root on the page permanently, not just
while a toast was up.

Three narrower corrections in the same check:

- **`aria-live` is an allowlist.** It matched the attribute's _presence_, and
  component kits ship exactly that shell — a permanent body-level announcer
  with updates switched off until needed. `polite`/`assertive` pivot; `off`
  does not; anything absent, empty or invalid falls through to the role's
  implicit politeness, per ARIA. `!== "off"` was a denylist, so `none`,
  `false`, `0` and a typo'd `polit` — the hand-written spellings of "switched
  off" — all pivoted. An explicit value also beats a role's implicit
  politeness, so `<div role="status" aria-live="off">` is inert too.
- **A `role` token list is read as a list**, and case is **not** folded. The
  selector matched `role` exactly, so `role="status announcer"` was invisible;
  it now decides on the first token, the same parse `getImplicitRole` uses, so
  the pivot and the extracted tree always agree about what an element is.
  Folding made `<div role="MENU" aria-live="off">` an overlay — it matched the
  container check before the `off` check — giving one element opposite scoping
  depending on an unrelated attribute.
- **The rule lives in one place now.** The same selector existed as a
  hand-copied string in three files; the fix landing in one of them meant a
  `role="status announcer"` toast pivoted a one-shot `auditSnapshot` while
  never waking the inspector, the extension or a live MCP session — the same
  DOM producing two different trees depending on which path ran.

Unchanged: an attached root still widens for a genuine portal, and still scopes
exclusively to an open modal. The remaining sharp edge — an _ordinary_ in-page
live region widening an attached root, since "outside the root" cannot tell it
from a portal — is now documented under Troubleshooting rather than silent.
