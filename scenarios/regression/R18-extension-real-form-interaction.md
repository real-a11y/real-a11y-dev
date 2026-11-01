---
id: R18
suite: regression
scenario: "Extension: real form interaction — dispatch actions, field editing, and sensitive-value masking"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.8. The dispatch-fidelity expectations mirror core's ActionDispatcher, which the CDP backend also mirrors — a fix in one belongs in both. Step 6a (a withheld field's edit box): in Chrome's tree, the first extension release with #510; in the in-page tree, the first with #512 — 0.1.16 as tagged fails both, which are the bugs those two fix. Step 6b (a sensitive textarea's markup text): extension ≥ 0.1.15; its input panel opening empty in the in-page tree: the first extension release with #512; and an untouched Enter in its edit box in Chrome's tree: the first with #516 — 0.1.16 as tagged fails both. Step 5a (an untouched Enter in an editor's edit box, in the in-page tree): the first extension release with #519 — 0.1.16 as tagged fails it. Step 5b (an untouched Enter in the edit box of an editor holding only an image, in Chrome's tree): the first extension release with #522 — 0.1.16 as tagged fails it. Step 6c (a custom textbox around a password in its shadow root): the first extension release with #520 — 0.1.16 as tagged fails it, and so does a release with #510 alone. Step 9 (a multi-line field's edit box): the first extension release with #523 — 0.1.16 as tagged fails it. From extension 0.1.18 the in-page tree is gone, and its part of a step runs from the field's stop in the TAB view, which opens the same edit box"
validUntil: ""
expected: "click/type/select dispatch on the real page; a sensitive field's value is NEVER shown in the panel — a password's, what is typed into a password or card field's edit box, empty or not, or into the edit box Chrome's tree opens on a custom textbox around a password in its shadow root, or a sensitive textarea's markup text in the live-announcement log or an editor's input panel; an untouched Enter in that edit box, or in a rich-text editor's in either tree, leaves the field as it was; a multi-line field's edit box keeps its line breaks; Send-Tab/Esc behave or fail visibly"
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
   - **5a** — in an editor whose content isn't only plain text (some bold, a
     link or an image), open the editor's edit box from its stop in the
     **TAB** view (**Activate**; extension ≤ 0.1.17: from its row in the
     **In-page tree**, **Settings ▾** → **Show**) and press `Enter` without
     typing

   - **5b** — an editor holding only an image, no text: a real editor you
     pasted a single image into, or this, run in the page's DevTools console
     before pressing **↻** to refresh the tree:

     ```js
     document.body.insertAdjacentHTML(
       "beforeend",
       '<div contenteditable="true" role="textbox" aria-label="Signature">' +
         '<img alt="Signature" width="80" height="24" src="data:image/gif;base64,' +
         'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>',
     );
     ```

     In **Chrome's tree**, open the `Signature` textbox's edit box from its row
     and press `Enter` without typing
6. Focus a **password** field and type into it
   - **6a** — a sign-in page's password step while the field is still
     **empty**, as on Google's "Enter your password". Open the field's edit box
     from its row in **Chrome's tree** (**TYPE**, or `Enter`), and from its stop
     in the **TAB** view (**Activate**), and type a few characters into each.
     (Extension ≤ 0.1.17: from its row in each tree, **Settings ▾** →
     **Show**.) Do the same on an empty
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
     select the `Note` textbox's stop in the **TAB** view and open its inline
     input panel (**Activate**; extension ≤ 0.1.17: its row in the **In-page
     tree**, **Settings ▾** → **Show**):

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

     Then go back to **Chrome's tree** (**A11Y**), open the same textbox's edit
     box from its row, and press `Enter` without typing
   - **6c** — a custom element that is a textbox itself, around the password
     input it types into in a closed shadow root of its own. Run this in the
     page's DevTools console, press **↻** (Refresh native tree), then on
     **Chrome's tree** open the edit box on the `Shadow password` row (**TYPE**,
     or `Enter`) and type a few characters:

     ```js
     {
       customElements.define(
         "x-shadow-password",
         class extends HTMLElement {
           connectedCallback() {
             if (this.input) return;
             this.input = document.createElement("input");
             this.input.type = "password";
             this.attachShadow({ mode: "closed" }).append(this.input);
           }
         },
       );
       const host = document.createElement("x-shadow-password");
       host.setAttribute("role", "textbox");
       host.setAttribute("aria-label", "Shadow password");
       document.body.append(host);
     }
     ```
7. Send Tab and Escape through the panel
8. Toggle a checkbox and change a `<select>`
9. Edit a **multi-line** field: a `<textarea>` holding a few lines (a comment or
   an address box), and a rich-text editor holding two paragraphs. From its row
   in **Chrome's tree**, and from its stop in the **TAB** view (extension ≤
   0.1.17: from its row in each tree, **Settings ▾** → **Show**), open the
   field's edit box, go to the end, add a line with `Shift+Enter`, type a few
   words, and press `Enter`

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
- **5a** — the box opens on the editor's text, and `Enter` closes it and leaves
  the editor as it was: its formatting, links and images are all still there.
  Before #519, that `Enter` typed the box's text back into the editor in place of
  its content, losing whatever wasn't text
- **5b** — the editor's row shows no value, as an empty field's does, and its edit
  box opens empty. `Enter` closes it and leaves the image in the editor. Before
  #522, that `Enter` typed an empty value over the editor and deleted the image
- **6** — the password value is **NEVER** displayed in the panel, in any view, at any
  time
- **6a** — the edit box shows dots, not what you type, for both empty fields, as it
  does for a password field that already holds something, from Chrome's tree and
  the TAB view alike (extension ≤ 0.1.17: in both trees), and the
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
- **6c** — the edit box shows dots, as the one on the password's own row does.
  Before #520 it opened in plain text, #510's mask included: nothing in the element's
  own light DOM said the row held a password
- **7** — Tab/Escape either work or fail **visibly**. Silently doing nothing is the
  failure
- **8** — state changes and is reflected
- **9** — the edit box has room for several lines and shows the textarea's own
  lines. From a TAB stop (extension ≤ 0.1.17: in the in-page tree) it shows the
  editor's paragraphs as lines too; Chrome's tree opens an editor's box empty. `Shift+Enter` starts a new line rather
  than setting the value, and after `Enter` the textarea holds its lines and the
  new one. An editor whose style keeps line breaks shows the new line, and one that
  doesn't shows it as a space. Before #523 the box was one line: it ran the
  textarea's lines together, showed the editor's paragraphs as `Dear Sam,Thanks!`,
  and `Shift+Enter` set the value, so the textarea ended up on one line

## Why this exists

The panel writes to pages the user didn't build, which makes both halves risky.

- **Dispatch fidelity** (1–5): each of these is a real site pattern that a naive
  implementation silently no-ops on. The user sees "nothing happened" and blames the
  page. 5a is the opposite failure, a write nobody asked for: the edit box holds
  plain text, and a retype replaces an editor's whole content with it, so an
  `Enter` that changed nothing in the box still changed the editor. 5b is the same
  failure in Chrome's tree, where such a box opens empty instead: an editor that
  holds no text, only an image, reads no value there, as an empty field does, so
  an untouched `Enter` typed that empty value over it and deleted the image.
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

6c is step 6 through a shadow root. A custom element can be the textbox itself,
by `role="textbox"` or by its `ElementInternals`, and keep the input it types
into in its own shadow root. Chrome's tree shows the element's row over the
input's, and the panel looked for a password only in the element's own light
DOM, which a shadow root is no part of, so the element's edit box didn't mask.
The panel now withholds every row a withheld field sits under in Chrome's tree,
and every element its own reading of the page's document has one in, through
shadow roots and slots: page script can't see into a closed shadow root at all,
and the tree has no row for a field hidden from assistive technology or not laid
out.

9 is dispatch fidelity for what the edit box holds rather than what it sends. A
one-line box drops line breaks from its text, so an edit of a multi-line field
typed it back as one line, and nothing on the page said why. Steps 4 and 5 pass on
a single line of text.
