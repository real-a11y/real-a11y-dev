---
id: R35
suite: regression
scenario: "Extraction — a pivot may only ever WIDEN, never replace the root you passed"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.15 for the row; the detached-root guard and the aria-live=off correction ship in the FIRST release after 0.1.0-beta.15. Running steps 2–4 against 0.1.0-beta.15 or earlier reproduces the defect rather than failing the test — there a detached root is replaced outright and an inert announcer pivots the whole extraction. That is the old behaviour, not a fail. Step 1 is a KNOWN OPEN GAP at every version so far, not a regression. The behaviour lives in `resolveEffectiveRoot` (packages/core/src/extraction/dom-extractor.ts), but `core` is PRIVATE and bundled — there is no core version to pin or install, so assert against `@real-a11y-dev/testing` only. The same pivot reaches users through `inspector` and `react`, which bundle their own copy."
validUntil: ""
expected: "a pivot never DROPS the caller's own subtree — detached, shadow-rooted and ancestor-live-region cases all return the root passed. Step 1 is a KNOWN OPEN GAP: an ordinary in-page live region beside an attached root still widens to the whole document, and there is no scope-moved signal; it is documented rather than fixed"
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
   `alertdialog`, `menu`, `listbox`, `tooltip`. Then the shapes a bare list
   misses, each of which was a live defect:
   - `role="status" aria-live="off"` — an explicit value beats a role's
     implicit politeness
   - `role="status announcer"` — a token list; the role that wins is the first
     token
   - `role="MENU" aria-live="off"` — case is not folded, so this must stay off
   - `aria-live="none"`, `"false"`, `"0"`, `"polit"` — the hand-written
     spellings of "switched off", which a denylist admitted
   - bare `aria-live` and `aria-live=""` — invalid, so the role's implicit
     value applies
5. A root inside a **shadow root**, with a light-DOM live region outside it —
   the shape `isConnected` reads as connected while the walk cannot cross
6. An **ancestor** live region: `<main aria-live="polite">` wrapping the root,
   which is the SPA route-announcer pattern Next.js, Remix and React Router
   ship
7. A genuinely portal-mounted overlay — a dropdown rendered to `document.body`
   by a portal while its trigger sits inside the root
8. The same root, audited twice: once with the live region present, once with it
   removed
9. `attach(page, { rootSelector: "main" })` on a page with a toast viewport

## Expected

- **1** — the snapshot still contains the whole page, and that is the **known
  remaining gap**, not a pass. Pivoting an ATTACHED root is loss-free (the
  document is a superset) but silently turns a component snapshot into a
  page snapshot, because "outside the root" cannot tell an ordinary in-page
  live region from a portal. Documented under Troubleshooting; narrowing the
  trigger is a design decision that is still open
- **2** — the caller's subtree must **never disappear**, and no longer does: a
  root that is not in the document is never pivoted, on either path. Check the
  MODAL path too — it ignored `root` entirely and runs first, so an open dialog
  hijacked a detached root as readily as a portal did
- **3** — must not report headings the root does not contain, and must not come
  back **clean** because it audited a different, well-formed part of the page.
  This is the damage that made 2 worth fixing first: no findings reads as a
  clean component
- **4** — `aria-live="off"` declares itself inert and must not trigger a pivot,
  nor must `role="status" aria-live="off"` (an explicit value wins over a
  role's implicit politeness). A CONTAINER role — menu, dialog — is unaffected:
  it is an overlay because of what it is, not because it announces
- **5** — the shadow-rooted root comes back unchanged. This is the one
  `isConnected` could never catch: it is shadow-including and reports the root
  as connected, while the walk reads light-DOM `children` and cannot cross the
  boundary, so widening replaced a web component's whole subtree with the host
  page
- **6** — an ANCESTOR is not a portal by any definition. Getting this wrong
  pivoted every component root on an SPA permanently — not only while a toast
  was up — because the route announcer wraps the entire app
- **7** — this is the case the feature exists for, and it must keep working
- **8** — the same element must not produce two different snapshots because of
  markup outside it. Detached, shadow and ancestor: satisfied. Sibling live
  region on an attached root: see 1
- **9** — a `rootSelector` is an explicit instruction, and should be the hardest
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

`guide/troubleshooting.md` now carries both halves: the widening symptom with
two ways around it, and the trade that comes with the fix — a detached root
never sees teleported content either, which matters to Vue Test Utils and
Enzyme fixtures that render unappended and teleport dialogs to `document.body`.
Its older "scope the assertion to the subtree" advice, which the pivot used to
override silently, now points at that section.

## Notes

Minimal reproduction, no framework involved. **This is the behaviour on
`testing ≤ 0.1.0-beta.15`** — on later releases the button is present, which is
the fix, not a regression:

```js
document.body.innerHTML = '<p role="status">4 tickets</p>';
const root = document.createElement("div");
root.innerHTML = "<button>Save</button>";
auditSnapshot(root); // beta.15: 'status "4 tickets"' — the button is absent
// after:    'button "Save"'
```

Step 1 is deliberately left open, so the thing keeping it visible is a test
rather than this paragraph: `packages/core/src/extraction/root-pivot.test.ts`
asserts the whole-page result for a sibling live region on an attached root and
says in place that it is the known gap. If that test starts failing, the gap
closed and this row needs rewriting.
