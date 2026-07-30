---
id: R18
suite: regression
scenario: "Extension: real form interaction — dispatch actions, field editing, and sensitive-value masking"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.8. The dispatch-fidelity expectations mirror core's ActionDispatcher, which the CDP backend also mirrors — a fix in one belongs in both"
validUntil: ""
expected: "click/type/select dispatch on the real page; a password value is NEVER shown in the panel; Send-Tab/Esc behave or fail visibly"
twin: D6
notion: "https://app.notion.com/p/3aa1c354b0b5819e89f7de2edeb18fcb"
---

## Steps

Use a **real** form — a login page, a checkout, or a signup flow — not a fixture. The
point is behaviour against handlers you didn't write.

1. Click a button through the panel; confirm the page's own handler ran (not just that
   the DOM changed)
2. Click a control inside a composite widget — a `treeitem`, `menuitem`, `option`,
   `tab`, `row`
3. Click something driven by a delegated handler (jsaction, a Material-style ripple)
4. Type into a **framework-controlled** input (React/Vue), then check the app's own
   state reflects it — not just the DOM value
5. Type into a rich-text / contenteditable editor (ProseMirror, Lexical, Draft)
6. Focus a **password** field and type into it
7. Send Tab and Escape through the panel
8. Toggle a checkbox and change a `<select>`

## Expected

- **1/3** — the real handler fires. A bare `element.click()` is not enough: many
  handlers gate on the full `pointerdown → mousedown → pointerup → mouseup → click`
  sequence and ignore a synthetic click
- **2** — the action reaches the interactive descendant that owns the handler. A
  delegated `event.target.closest(…)` walk goes _upward_, so dispatching on the
  wrapper alone misses
- **4** — the framework registers the value (prototype setter + `input`/`change`), not
  just the DOM
- **5** — the editor keeps the text. A raw `textContent` write gets reverted by
  model-driven editors; a cancelable `beforeinput` must go first
- **6** — the password value is **NEVER** displayed in the panel, in any view, at any
  time
- **7** — Tab/Escape either work or fail **visibly**. Silently doing nothing is the
  failure
- **8** — state changes and is reflected

## Why this exists

The panel writes to pages the user didn't build, which makes both halves risky.

- **Dispatch fidelity** (1–5): each of these is a real site pattern that a naive
  implementation silently no-ops on. The user sees "nothing happened" and blames the
  page.
- **Redaction** (6) is absolute and unconditional. There is no view, no debug mode,
  and no error path where a password value may appear. This is the same invariant the
  act path enforces (**R24**) — same rule, different surface.
