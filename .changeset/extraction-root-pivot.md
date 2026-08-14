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

For a **detached** root it is not. The document is a disjoint tree, so the
caller's own subtree disappeared and the audit described markup they never
passed:

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
a detached root just as readily, and it runs first.

Two narrower corrections in the same check:

- **`aria-live="off"` no longer counts as a live region.** The selector matched
  the attribute's _presence_, and component kits ship exactly that shell — a
  permanent body-level announcer with updates switched off until needed. An
  explicit `aria-live` also wins over a role's implicit politeness, so
  `<div role="status" aria-live="off">` is inert too. A container role (menu,
  dialog…) is unaffected: it is an overlay because of what it is.
- **A `role` token list is read as a list.** The selector matched `role`
  exactly, so `role="status announcer"` was invisible to it; it now matches on
  the token and decides on the first one, which is the role that wins.

Unchanged: an attached root still widens for a genuine portal, and still scopes
exclusively to an open modal. The remaining sharp edge — an _ordinary_ in-page
live region widening an attached root, since "outside the root" cannot tell it
from a portal — is now documented under Troubleshooting rather than silent.
