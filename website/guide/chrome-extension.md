---
title: Semantic Navigator — Chrome extension
description: Inspect any website's DOM, accessibility tree, and tab order in a Chrome side panel. No setup, no code — open it on any URL, see what assistive tech sees.
---

# Semantic Navigator

<p class="sn-lead">Navigate the web the way your users have to.</p>

Most accessibility problems don't look like problems — until you remove the visual layer. Semantic Navigator replaces the page with its accessibility tree. You can still click, navigate, fill forms, and complete tasks. The structure is all you get.

<div class="sn-actions">
  <a href="https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom" class="sn-btn-primary">Add to Chrome</a>
  <a href="https://github.com/real-a11y/real-a11y-dev" class="sn-btn-secondary">View on GitHub</a>
  <span class="sn-meta">Free · open source · MIT license · Chrome 116+</span>
</div>

<figure class="sn-hero">
  <ZoomImage label="Screen curtain screenshot">
    <img
      src="/semantic-navigator-curtain.png"
      alt="A browser with the Semantic Navigator screen curtain turned on: the left half of the window is fully blacked out and labeled “Content hidden — navigate via Semantic Navigator,” while the side panel on the right shows the page's complete accessibility tree — banner, main navigation, breadcrumb, headings, and links and buttons with their roles and accessible names — still fully navigable, with a keyboard-key bar along the bottom."
    />
  </ZoomImage>
  <figcaption>The screen curtain blacks out the page. The accessibility tree stays — and so does every interaction.</figcaption>
</figure>

---

> *"The more your tests resemble the way your software is used, the more confidence they can give you."*
> — Testing Library

The more your navigation resembles how screen reader users experience your product, the more confidence it can give you.

---

## The problem

You build, test, and ship products you have never used the way a screen reader user does.

You navigate with your eyes: you click what you can see and skip what doesn't look relevant. Your users navigate with structure — headings to orient, landmarks to jump to, roles and names to understand what each element does. They hear the tree, one element at a time, in the order the DOM gives it to them.

Most teams have never used their own product that way. Not because they don't care, but because nothing has ever made them try.

## The test

**If you can complete the task through the accessibility tree, your users probably can too.**

**If you can't — that's the bug.**

Try to check out. Try to book an appointment. Try to find the error message after a failed form submission. Try to close the dialog that just opened. Do it through the tree, without looking at the UI.

When you can't find the button, can't tell what a control does, or can't tell whether the action worked, stop there. That's your accessibility bug, and your screen reader users hit it every day.

## This is not a replacement for real testing

NVDA, JAWS, VoiceOver and TalkBack are the tools your users depend on, each with its own keyboard model and its own way of announcing dynamic content. None of that is simulated here. Semantic Navigator shows the raw material those tools read, the semantic tree, not what a screen reader says or how it moves.

**Use it to catch structural problems early and often**: missing names, broken tab order, wrong roles, unlabeled landmarks. **Use real screen readers before you ship**: NVDA with Firefox, VoiceOver with Safari, JAWS if your users depend on it. This extension makes those sessions less painful. It does not make them optional.

## The screen curtain

The **Curtain** button in the panel's toolbar blacks out the whole page. Only an extension can paint over a whole browser tab.

The tree stays. The panel stays. You can still use the full product. The visual layer is just gone.

This is the closest a sighted developer gets to the experience. It's uncomfortable. That discomfort is information.

While the curtain is on, the panel draws no outline on the page, so use the tree's selection to keep your place.

## How it works

1. **Open the side panel.** Click the extension's icon in the Chrome toolbar. The panel opens next to the page and shows its tree.
2. **Read the structure.** By default the panel shows Chromium's own accessibility tree, the one assistive technology gets (see [Native mode](#native-mode)). **Settings ▾** → **Show** → **In-page tree** switches to the extension's own reading of the page, with three views in the toolbar: DOM (the HTML elements), A11Y (roles, names and states) and TAB (the tab order).
3. **Navigate your product.** Follow links, fill in forms, open menus and complete flows from the tree. You're using the real product, through its structure instead of its visual layer.
4. **Find where it breaks.** Whatever is hard to find, hard to understand or impossible to finish is [the test](#the-test) failing.

A long name ends in an ellipsis; hover it to read the rest, or turn on **Settings ▾** → **Show full names**. A form field shows its value, as a screen reader announces it. A password, one-time-code or card field shows `[redacted]` instead.

## Native mode

Native mode is on by default. The panel reads Chromium's own accessibility tree over `chrome.debugger`, the protocol DevTools uses. That is the tree Chrome gives assistive technology, and it includes what the in-page reading can't see, such as a video player's built-in controls. Where native mode can't read a page, the panel shows the in-page tree instead and says why.

**Chrome's debugging bar.** While the panel reads or acts on a page this way, Chrome shows a bar across every window: “Semantic Navigator” started debugging this browser. That's expected. The first time it appears, a note in the panel explains it: **Got it** hides the note, and **Turn off** turns native mode off. Pressing **Cancel** on Chrome's bar detaches, and the panel won't read that tab again on its own until you press **↻**.

**Turning it off.** Open **Settings ▾**, next to the page's title, and switch off **Read pages through Chrome (recommended)**. The setting applies to the side panel in every window. With it off, the panel reads the page itself and Chrome's bar doesn't appear. With it on, **Show** in the same menu picks the tree this panel shows: **Chrome's tree** or the **In-page tree**.

**When the tree updates.** Chrome's tree is read when you open the panel and when the page navigates. After you act, through the tree or on the page itself, it is read again for a few seconds as the page changes, so what your click opened shows up. Typing isn't followed. Other changes wait for **↻**, unless you turn on **Follow page changes** (the **⟳** button in Chrome's tree's toolbar), which reads the tree again whenever the page changes. Every read brings up Chrome's bar. Switching tabs doesn't read the new tab: press **↻**.

**What's the same.** Everything else works on Chrome's tree as on the in-page tree: acting on rows, the key bar, picking an element (**⦿**, or `Ctrl`/`Cmd`+`Shift`+`C`), outlining the selected row's element on the page, Focus sync, scoping, search, jump chips and **Copy**. Frames are read too, cross-origin ones included. What Chrome's tree doesn't have is tab order: `tabindex` never reaches a native node, so there's no TAB view and no **Tab sequence** in **Copy**. The two trees will never match exactly, by design; see [Two producers](./reading-the-a11y-view.md#two-producers).

The [extension's README](https://github.com/real-a11y/real-a11y-dev/blob/main/packages/extension/README.md#native-mode) covers how native mode decides when to read, and how it follows focus and frames.

## What only the extension does

Search, role filters, jump chips and the keyboard work as in the other panels: see [Using the panel](#using-the-panel). These need an extension:

- **The screen curtain**, [above](#the-screen-curtain).
- **Copy as a Markdown report.** **Copy ▾** puts the current view on the clipboard as a report for a bug tracker: everything, the tree, the heading outline or the tab sequence. Field values are left out. Each report starts by saying what it shows, so nobody compares a report from one tree with a report from the other by mistake:

  ```md
  # Accessibility report — Checkout · Example Store

  - **URL:** https://example.com/checkout
  - **Producer:** dom (the extension's own in-page walk)
  - **Scope:** dialog "Confirm order"
  - **Captured:** 2026-07-11T14:32:10.000Z
  - **Tool:** Semantic Navigator 0.1.9
  ```

- **Frames.** Each iframe's tree sits under its `<iframe>` row, including cross-origin frames, `about:blank` and `srcdoc` frames, and frames a script writes into, such as a rich-text editor's. The in-page tree can't reach into a sandboxed frame without `allow-same-origin`, a `data:` frame or a `blob:` frame, and marks those **embedded**.
- **Keyboard bar.** `Esc`, `Tab`, `Shift+Tab`, `Enter`, `Space`, `↓` and `↑` send a key to whatever has focus on the page. For example: open a combobox from the tree, move through its options with `↓`, choose one with `Enter`, and close it with `Esc`.
- **Close tab.** The **✕** next to the page's title closes the tab the panel is showing, which is handy for popups and login windows.
- **[Focus sync](#focus-sync), the [scope breadcrumb](#scoping) and the [live region log](#live-region-monitoring)**, and the **Dialog: …** bar that names a modal dialog when the tree [re-roots to it](#dialog-auto-scope).

For what each view shows, see [Reading the DOM view](/guide/reading-the-dom-view), [the A11y view](/guide/reading-the-a11y-view) and [the TAB view](/guide/reading-the-tab-view).

## Using the panel

The extension's in-page tree is the same panel as [`@real-a11y-dev/inspector`](/packages/inspector), [`<SemanticNavigator />`](/packages/react) and the [Storybook addon](/packages/storybook-addon), so this section holds for them too, except where it names the extension.

### Search and role filters

The search box keeps the rows whose tag name, role, accessible name, attributes or text contain what you type, with the rows above them, and hides the rest. `/` moves to it from the tree.

The six role filters, **Headings**, **Links**, **Buttons**, **Forms**, **Landmarks** and **Images**, each replace the tree with a list of the nodes in that group. **Forms** lists textboxes, search boxes, checkboxes, radios, comboboxes, list boxes, sliders and spin buttons; **Landmarks** lists `banner`, `navigation`, `main`, `complementary`, `contentinfo`, `region`, `form` and `search`. They're off in the TAB view, which is a list already.

### Jump chips

A control and what it controls, such as a menu button and its menu, are often far apart in the tree. They get a pair of chips that link them (`→ menu "Options"` and `← button "Options"`). A dashed chip is a guess from `aria-haspopup` and `aria-expanded` on a control with no `aria-controls`. `Alt`+`J` follows a chip from the keyboard.

### Focus sync

Only the extension has it. With **Focus sync** on in the toolbar, focus moving on the page, by Tab, a click or the page's own script, selects that element's row and scrolls the tree to it. Turn it off when a page moves focus so often that the tree won't stay where you are reading.

The other direction is always on. Selecting a row outlines its element on the page, scrolls it into view, and moves focus to it if it can take focus. Hovering a row outlines the element without scrolling or moving focus. The in-page panels do neither unless you opt in, with `highlightOnHover`, `scrollHostOnSelect` and `focusHostOnActivate` on the [inspector](/packages/inspector#config) or [`<SemanticNavigator />`](/packages/react#props).

### Scoping

In the extension, to show only part of the page, double-click a container row (a form, a landmark, a list: anything with children and no action of its own), or select any row with children and press `Ctrl`/`Cmd`+`Enter`. Double-clicking an interactive row still activates it. A breadcrumb above the tree shows the path: click a segment to scope back up, or use **Exit scope** (✕) or `Esc` to return to the whole tree. Chrome's tree scopes the same way, except that it scopes into a focusable container, such as a `tabindex="0"` region, where the in-page tree focuses it.

A scope limits the search and its match count, the role-filter lists, the TAB view, and what **Copy** exports, which gains a `Scope` line naming it. Selecting an element outside the scope, or focus moving to one with Focus sync on, leaves it.

The other panels have no breadcrumb, and double-clicking a row there only expands or collapses it. Scope the inspector with [`setRoot()`](/packages/inspector#setroot-root), and `<SemanticNavigator />` by passing it a different `root`.

### Dialog auto-scope

When the page opens a `<dialog>` with `showModal()`, the tree re-roots to that dialog: the dialog becomes the root row, and the page behind it drops out. That is what a screen reader user gets, since the browser makes the rest of the page inert. The tree re-roots back when the dialog closes or is removed. In the extension, a **Dialog: …** bar above the tree names the dialog (**Dialog: Modal** when it has no name), and its **Press ESC** button sends Escape to the page, which closes the dialog unless a page handler calls `preventDefault()`.

Only a modal `<dialog>` does this, and not one inside a shadow root. A `<dialog>` opened with `show()`, or an element with `role="dialog"` or `aria-modal="true"`, stays in the tree alongside the rest of the page. Dialog libraries such as Radix, MUI and Headless UI hide the rest of the page with `aria-hidden` or `inert`, so the tree shows the dialog alone, but its root is still the page and no bar appears.

The other panels re-root the same way, with no bar. An in-page panel re-roots even to a modal dialog outside its `root`; a non-modal one outside it joins the tree only when it has a `role` attribute of `dialog` or `alertdialog`, which widens the tree to the whole page, while a plain `<dialog>` opened with `show()` stays out. No dialog re-roots a panel whose root is inside a shadow root. The inspector and `<SemanticNavigator />` are part of the page, so they go inert along with it until the dialog closes; [`useActiveModal()`](/packages/react#useactivemodal-rootref) returns the dialog's node if you want your own indicator. The Storybook panel is outside the story's iframe and stays usable.

The panel doesn't check that focus stays in the dialog or that Escape closes it. Tab through the dialog and press Escape, on the page or with the keyboard bar's `Tab` and `Esc`.

### Live region monitoring

Only the extension has a live log; the other panels don't watch live regions.

While the side panel is open, when a live region on the page changes or is shown, its new text appears in the live log at the bottom of the side panel. A live region is a `role="status"`, `role="log"` or `role="alert"`, or anything with `aria-live="polite"` or `"assertive"`; `aria-live="off"` silences even an alert. Each entry shows the region's role (`status` for an `aria-live` element with no role), then its text. Assertive entries are red, polite ones blue. The log holds the last five entries, and each clears after 8 seconds.

An entry's text is what a screen reader could announce: nothing hidden or `aria-hidden`, and never a form field's markup text. Text a region already held when the panel opened isn't logged until it changes. The log approximates a screen reader rather than recording one: each entry carries the region's whole text after the change, not only the part that changed, changes within 200 ms collapse into one entry, and only the top frame is watched, so a live region inside an iframe never appears.

Use it to check that toasts, validation errors and result counts are announced, and that a loading indicator announces both "Loading…" and "Loaded."

### Keyboard

Every panel's tree takes the same keys. Chrome's tree has the differences listed under [native mode](#native-mode).

| Key | In the tree |
|---|---|
| `↑` / `↓` | Previous / next row |
| `→` | Expand the row, or move into it when it's already open |
| `←` | Collapse the row, or move to its parent when it's already closed |
| `Home` / `End` | First / last row |
| `Enter` | Run the row's action: click a link or button, toggle a checkbox, step a slider or spin button up |
| `Shift`+`Enter` | Step a slider or spin button down |
| `+` or `=` / `-` or `_` | Step a slider or spin button up / down |
| `Space` | Expand or collapse the row |
| `*` | Expand every sibling of the row |
| `/` | Move to the search box |
| Letters | Jump to the next row whose name starts with what you type |
| `Alt`+`J` / `Alt`+`Shift`+`J` | Follow the row's [jump chips](#jump-chips), and again for the next one / go back to the row you jumped from |
| `Ctrl`/`Cmd`+`Enter` | Extension only: scope the tree to the row |
| `Esc` | Extension only: leave the scope |

## Privacy

Everything happens in your browser. The extension makes no network requests and sends nothing anywhere, with no account and no tracking. It stores its own settings, and while native mode is attached, which tab it's attached to, until the browser closes. Password, one-time-code and card fields show `[redacted]`, and **Copy** leaves field values out. The [privacy policy](/privacy) lists every permission the extension asks for and why.

## Troubleshooting

- **"This page can't be inspected."** Chrome doesn't let extensions run on `chrome://` pages (the new-tab page included), the Chrome Web Store or the built-in PDF viewer. On an ordinary page, reload it and press **Try again**.
- **The panel is empty after switching tabs.** That's deliberate: it clears instead of showing the previous tab's tree. Press **Load tree**, or **↻**.
- **The panel says native mode can't read the page.** It shows the in-page tree instead. Usually DevTools is already open on that tab: close it, then choose **Chrome's tree** in **Settings ▾**.
- **Chrome's tree stopped updating.** Pressing **Cancel** on Chrome's bar, or a read that failed, pauses it. Press **↻**.

## Install

**Chrome Web Store** — [Semantic Navigator](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom).

> Chrome may show *"Proceed with caution — not trusted by Enhanced Safe Browsing"* on first install. That's ESB's default for any newly-listed extension until Google's systems have built up enough signal on the listing — it's not a specific issue with this extension. Click **Continue to install**.

**Load unpacked (developer mode)**

To run from source instead of the Web Store build:

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y-dev
pnpm install
pnpm --filter "@real-a11y-dev/semantic-navigator-extension..." build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `packages/extension/dist`

---

Open source. MIT license. No tracking. No accounts.
