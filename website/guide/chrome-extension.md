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

## The test

**If you can complete the task through the accessibility tree, your users probably can too. If you can't, that's the bug.**

1. **Open the side panel.** Click the extension's icon in the Chrome toolbar. The panel opens next to the page and shows its tree.
2. **Turn on the curtain.** The **Curtain** button in the panel's toolbar blacks out the page. The tree and every interaction stay.
3. **Do a real task through the tree.** Check out, book an appointment, find the error after a failed submit, close the dialog that just opened. Select a row and press `Enter` to act on it.
4. **Stop where you get stuck.** A button you can't find, a control you can't tell the purpose of, an action you can't tell worked: that's the bug your screen reader users hit.

The panel shows the tree screen readers read, not what NVDA, JAWS, VoiceOver or TalkBack say or how they move through a page. Use it to catch missing names, wrong roles and broken tab order early, and test with real screen readers before you ship.

## Native mode

By default the panel reads Chromium's own accessibility tree, the one Chrome gives assistive technology, over `chrome.debugger`. It sees what the in-page reading can't, such as a video player's built-in controls. Where it can't read a page, the panel shows the in-page tree instead and says why.

While it reads, Chrome shows a bar across every window: “Semantic Navigator” started debugging this browser. That's expected. Pressing **Cancel** on the bar stops the panel reading that tab until you press **↻**. To turn native mode off, switch off **Read pages through Chrome (recommended)** in **Settings ▾**, next to the page's title.

Chrome's tree is read when the panel opens, when the page navigates, and for a few seconds after you act. For any other change press **↻**, or turn on **Follow page changes** (**⟳**). It has no tab order of its own, because `tabindex` never reaches a native node, so its **TAB** view, next to **A11Y** in its toolbar, lists the in-page reading's tab stops in tab order, as [the in-page tree's TAB view](./reading-the-tab-view.md#how-tab-order-works) does: a positive `tabindex` first, then document order. Neither models shadow roots, iframes or focus traps. Showing it reads nothing through Chrome, so the bar doesn't come up for it. While Chrome's tree shows, the extension doesn't read the page itself, so TAB and the in-page tree take a moment to read it as they come up. **Settings ▾** → **Show** → **In-page tree** has the DOM view as well. The two trees never match exactly, by design: see [Two producers](./reading-the-a11y-view.md#two-producers).

## Using the panel

The extension's in-page tree is the same panel as [`@real-a11y-dev/inspector`](/packages/inspector), [`<SemanticNavigator />`](/packages/react) and the [Storybook addon](/packages/storybook-addon). Chrome's tree works the same way. For what each view shows, see [Reading the tree](/guide/reading-the-a11y-view).

- **Search and role filters.** The search box (`/`) keeps the rows whose role, name, tag, attributes or text match, with the rows above them. **Headings**, **Links**, **Buttons**, **Forms**, **Landmarks** and **Images** each list just those nodes.
- **Selecting a row** outlines its element on the page, scrolls it into view and focuses it if it can take focus. Hovering a row outlines it. The [inspector](/packages/inspector#config) and [`<SemanticNavigator />`](/packages/react#props) do these only if you opt in, with `highlightOnHover`, `scrollHostOnSelect` and `focusHostOnActivate`.
- **Jump chips** link a control to what it controls, such as a menu button and its menu: `→ menu "Options"` and `← button "Options"`. `Alt`+`J` follows one.
- **Modal dialogs.** When the page opens a `<dialog>` with `showModal()`, the tree re-roots to it, as a screen reader gets it. An element with `role="dialog"` stays in place among the rest of the page. The panel doesn't check that focus stays in the dialog or that Escape closes it: try both.
- **Long names** end in an ellipsis. Hover one, or turn on **Settings ▾** → **Show full names**.

Only the extension has these:

- **Focus sync.** Focus moving on the page, by Tab, a click or the page's own script, selects that element's row.
- **Scoping.** Double-click a container row, or press `Ctrl`/`Cmd`+`Enter`, to show only that part of the page. Search, filters and **Copy** follow the scope. The breadcrumb above the tree, or `Esc`, takes you back. In the other panels, scope with the inspector's [`setRoot()`](/packages/inspector#setroot-root) or a different `root` for `<SemanticNavigator />`.
- **The live log.** When a live region (`role="status"`, `"alert"` or `"log"`, or `aria-live`) changes, its text appears at the bottom of the panel, assertive in red and polite in blue. Use it to check that toasts, validation errors and loading messages are announced. It approximates a screen reader: it shows the region's whole text, and doesn't watch iframes.
- **The key bar.** `Esc`, `Tab`, `Shift+Tab`, `Enter`, `Space`, `↓` and `↑` go to whatever has focus on the page, for example to open a combobox and pick an option.
- **Copy ▾** puts the view on the clipboard as a Markdown report for a bug tracker, headed by the URL, which tree it came from and the scope. Field values are left out.
- **Frames.** Each iframe's tree sits under its `<iframe>` row, cross-origin frames included.

### Keyboard

| Key | In the tree |
|---|---|
| `↑` / `↓` | Previous / next row |
| `→` / `←` | Expand / collapse the row, or move into it / to its parent |
| `Home` / `End` | First / last row |
| `Enter` | Run the row's action: click, toggle, step a slider up (`Shift`+`Enter` steps down) |
| `Space` | Expand or collapse the row |
| `*` | Expand every sibling of the row |
| `/` | Move to the search box |
| Letters | Jump to the next row whose name starts with what you type |
| `Alt`+`J` / `Alt`+`Shift`+`J` | Follow the row's jump chip / go back |
| `Ctrl`/`Cmd`+`Enter` / `Esc` | Extension only: scope to the row / leave the scope |

## Privacy

Everything happens in your browser. The extension makes no network requests and has no account or tracking. It stores its settings and, while native mode is attached, which tab it's reading. Password, one-time-code and card fields show `[redacted]`, and **Copy** leaves field values out. The [privacy policy](/privacy) lists every permission it asks for and why.

## Troubleshooting

- **"This page can't be inspected."** Chrome doesn't let extensions run on `chrome://` pages, the Chrome Web Store or the PDF viewer. On an ordinary page, reload and press **Try again**.
- **The panel is empty after switching tabs.** That's deliberate. Press **Load tree** or **↻**.
- **Native mode can't read the page.** Usually DevTools is open on that tab: close it, then choose **Chrome's tree** in **Settings ▾**.
- **Chrome's tree stopped updating.** **Cancel** on Chrome's bar, or a failed read, pauses it. Press **↻**.

## Install

Install [Semantic Navigator from the Chrome Web Store](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom). Chrome may warn *"Proceed with caution — not trusted by Enhanced Safe Browsing"* on first install. That's its default for any newly listed extension, not a finding about this one: click **Continue to install**.

To build it from source, see the [extension's README](https://github.com/real-a11y/real-a11y-dev/blob/main/packages/extension/README.md#installation-from-source).
