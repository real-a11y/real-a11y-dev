---
id: R35
suite: regression
scenario: "Extraction — the audit root is the root you passed, or you are told it moved"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.15. The behaviour lives in `resolveEffectiveRoot` (packages/core/src/extraction/dom-extractor.ts), but `core` is PRIVATE and bundled — there is no core version to pin or install, so assert against `@real-a11y-dev/testing` only. The same pivot reaches users through `inspector` and `react`, which bundle their own copy."
validUntil: ""
expected: "a portal pivot never DROPS the caller's own subtree, and an ordinary in-page live region does not silently turn a component audit into a whole-page audit"
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/testing
notion: ""
---

## Steps

Build a page with an ordinary, non-portalled live region — a result count, a
form status, a save confirmation — as a **sibling** of the element under test:

```html
<main><h1>Host application</h1></main>
<p role="status">4 tickets</p>
<div id="component"><button>Save</button></div>
```

1. `auditSnapshot(document.getElementById("component"))`
2. The same, with the root **detached** (never appended to the document) —
   the React Testing Library shape before mount, and the jsdom fixture shape
3. `outlineSnapshot(root)` and `collectFindings(root)` in the same state
4. Repeat 1 with each trigger role in turn: `status`, `alert`, `log`,
   `aria-live="polite"`, `aria-live="assertive"`, `aria-live="off"`,
   `alertdialog`, `menu`, `listbox`, `tooltip`
5. A genuinely portal-mounted overlay — a dropdown rendered to `document.body`
   by a portal while its trigger sits inside the root
6. The same root, audited twice: once with the live region present, once with it
   removed
7. `attach(page, { rootSelector: "main" })` on a page with a toast viewport

## Expected

- **1** — the snapshot contains the component. Pivoting an ATTACHED root to
  `document.body` is loss-free (body is a superset) but it silently converts a
  component snapshot into a whole-page snapshot, so it must be **visible**:
  either don't pivot for a non-portalled sibling, or say the scope moved
- **2** — the caller's subtree must **never disappear**. `document.body` is not
  a superset of a detached root, so pivoting there returns a tree with nothing
  in common with what was passed. Today this is silent
- **3** — must not report headings the root does not contain, and must not come
  back **clean** because it audited a different, well-formed part of the page
- **4** — `aria-live="off"` explicitly declares itself inert; it must not
  trigger a pivot. The selector matches attribute presence
- **5** — this is the case the feature exists for, and it must keep working
- **6** — the same element must not produce two different snapshots because of
  markup outside it
- **7** — a `rootSelector` is an explicit instruction, and should be the hardest
  thing in the system to override silently

## Why this exists

`resolveEffectiveRoot` pivots extraction to `document.body` when a portal-overlay
role sits outside the root. The intent is right — a React-portalled dropdown
belongs in the tree with its trigger — and the code already defends against the
obvious foot-gun, `hasOverlayContent` refusing to pivot for an empty announcer
shell that a component kit mounts forever.

What it cannot do is tell a **portal-mounted overlay** from an **ordinary
in-page live region**, because the only test available is "not contained by
root". `<p role="status">4 tickets</p>` next to a table is not a portal and not
an overlay; it is the most ordinary markup there is, and it moves the scope of
every audit on the page.

Two consequences, in increasing severity:

- An attached root quietly becomes a whole-page snapshot. The test still passes
  today and starts failing next week for a reason in a different file.
- A **detached** root is replaced outright. `collectFindings` then returns the
  findings of somebody else's DOM — and if that DOM is well-formed, it returns
  none, which reads as "this component is clean".

Nothing under `website/packages/testing/` mentions any of this. What the docs do
say is `guide/troubleshooting.md` — "scope the assertion to the subtree that
should have its own hierarchy" for portaled content — which is the advice the
pivot overrides.

## Notes

Minimal reproduction, no framework involved:

```js
document.body.innerHTML = '<p role="status">4 tickets</p>';
const root = document.createElement("div");
root.innerHTML = "<button>Save</button>";
auditSnapshot(root); // → 'status "4 tickets"' — the button is absent
```
