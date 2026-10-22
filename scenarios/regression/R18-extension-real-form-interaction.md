---
id: R18
suite: regression
scenario: "Extension: real form interaction — dispatch actions, field editing, and sensitive-value masking"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.8. The dispatch-fidelity expectations mirror core's ActionDispatcher, which the CDP backend also mirrors — a fix in one belongs in both. Step 6a (a withheld field's edit box): in Chrome's tree, the first extension release with #510; in the in-page tree, the first with #512 — 0.1.16 as tagged fails both, which are the bugs those two fix. Step 6b (a sensitive textarea's markup text): extension ≥ 0.1.15; its input panel opening empty in the in-page tree: the first extension release with #512; and an untouched Enter in its edit box in Chrome's tree: the first with #516 — 0.1.16 as tagged fails both"
validUntil: ""
expected: "click/type/select dispatch on the real page; a sensitive field's value is NEVER shown in the panel — a password's, what is typed into a password or card field's edit box, empty or not, or a sensitive textarea's markup text in the live-announcement log or an editor's input panel; an untouched Enter in that edit box leaves the field as it was; Send-Tab/Esc behave or fail visibly"
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
   - **6a** — a sign-in page's password step while the field is still
     **empty**, as on Google's "Enter your password". In each tree
     (**Settings ▾** → **Show**), open the field's edit box from its row
     (**TYPE**, or `Enter`) and type a few characters. Do the same on an empty
     card number field, from a checkout form or from this, run in the page's
     DevTools console before pressing **↻** to refresh the tree:

     ```js
     document.body.insertAdjacentHTML(
       "beforeend",
       '<label>Card number <input autocomplete="cc-number"></label>',
     );
     ```

     Then type into the password's edit box again and, without closing it,
     open another field's edit box from its row. Last, open the edit box of a
     password field that already holds something, and press `Enter` without
     typing

   - **6b** — a fixture, since no real form puts a field in a live region. With
     the panel open on any page, run this in the page's DevTools console, then
     select the `Note` textbox in the **In-page tree** (**Settings ▾** →
     **Show**) and open its inline input panel:

     ```js
     document.body.insertAdjacentHTML(
       "beforeend",
       '<div role="status"></div>' +
         '<div contenteditable="true" role="textbox" aria-label="Note">Pay ' +
         '<textarea autocomplete="cc-number">CARD-SENTINEL</textarea>now</div>',
     );
     document.querySelector('[role="status"]').innerHTML =
       'Code sent <textarea autocomplete="one-time-code">OTP-SENTINEL</textarea>';
     ```

     Then go back to **Chrome's tree** (**Settings ▾** → **Show**), open the same
     textbox's edit box from its row, and press `Enter` without typing
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
- **6a** — the edit box shows dots, not what you type, for both empty fields, as it
  does for a password field that already holds something, in both trees, and the
  other field's box opens without what you typed. `Enter` without typing closes the
  filled field's box and leaves the field as it was. Before #510, Chrome's tree
  opened both empty fields' boxes in plain text, and the other field's box showed
  the password. Before #512, the in-page tree showed what you typed into the card
  field in plain text, and that `Enter` typed an empty value over the password,
  blanking it
- **6b** — neither sentinel shows in the live-announcement log or the input panel:
  the log reads `status` `Code sent`, and the input panel opens empty, as Chrome's
  tree's does, since the editor holds a card field, and shows dots as you type. In
  Chrome's tree, `Enter` in that box without typing closes it and leaves the editor
  as it was, card field and all. Extension 0.1.14 and earlier logged
  `Code sent OTP-SENTINEL` and opened the input panel holding
  `Pay CARD-SENTINELnow`; 0.1.15 and 0.1.16 opened it holding `Pay now`.
  Before #516, that `Enter` in Chrome's tree emptied the editor and removed the card
  field
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

6b is the same rule reached through text rather than a value. A `<textarea>`'s
markup text is its default value, and the panel read two things as raw
`textContent` — a live region's announcement and an editor's current text — so a
sensitive textarea inside either one put its secret on the extension's message
channel. Step 6 can't catch it: a password `<input>` has no text to read.

6a is the same rule on the way in. A password field is empty until you type into
it, so every sign-in goes through an empty one. Chrome's tree masked the edit box
only for a field that read `[redacted]`, which an empty field doesn't. The in-page
tree masked it by the field's own type, so a card or one-time-code field, which is
an ordinary text or number input, showed what you typed into it. And a filled
field's box opens empty in place of the value it can't show, so in the in-page tree
an untouched `Enter` used to type that empty value over the field. Step 6 alone
passes on a password field filled in earlier, whose own type hides it.
