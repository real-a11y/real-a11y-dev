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
  <img
    src="/semantic-navigator-curtain.png"
    alt="A browser with the Semantic Navigator screen curtain turned on: the left half of the window is fully blacked out and labeled “Content hidden — navigate via Semantic Navigator,” while the side panel on the right shows the page's complete accessibility tree — banner, main navigation, breadcrumb, headings, and links and buttons with their roles and accessible names — still fully navigable, with a keyboard-key bar along the bottom."
  />
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

**What's the same.** Everything else works on Chrome's tree as on the in-page tree: acting on rows, the key bar, picking an element (**⦿**, or `Ctrl`/`Cmd`+`Shift`+`C`), outlining the selected row's element on the page, Focus sync, scoping, search, jump chips and **Copy**. Frames are read too, cross-origin ones included. What Chrome's tree doesn't have is tab order: `tabindex` never reaches a native node, so there's no TAB view and no **Tab sequence** in **Copy**. The two trees will never match exactly, by design; see [Two producers](./core-concepts.md#two-producers).

The [extension's README](https://github.com/real-a11y/real-a11y-dev/blob/main/packages/extension/README.md#native-mode) covers how native mode decides when to read, and how it follows focus and frames.

## What only the extension does

Reading the tree, search, role filters, focus tracking and scoping work the same as in the [inspector](/packages/inspector), the [React component](/packages/react) and the [Storybook addon](/packages/storybook-addon): see [Panel features](/guide/panel-features). These need an extension:

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
- **Jump chips.** A control and what it controls, such as a menu button and its menu, are often far apart in the tree. They get a pair of chips that link them (`→ menu "Options"` and `← button "Options"`). A dashed chip is a guess from `aria-haspopup` and `aria-expanded` on a control with no `aria-controls`. `Alt`+`J` follows a chip from the keyboard.
- **The [live region log](/guide/panel-features#live-region-monitoring)**, and the **Dialog: …** bar that names a modal dialog when the tree [re-roots to it](/guide/panel-features#dialog-auto-scope).

For what each view shows, see [Reading the DOM view](/guide/reading-the-dom-view), [the A11y view](/guide/reading-the-a11y-view) and [the TAB view](/guide/reading-the-tab-view).

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
