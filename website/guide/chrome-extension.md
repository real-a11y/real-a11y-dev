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

You build, test, and ship products you have never actually experienced.

Not the way a screen reader user experiences them.

You navigate with your eyes. You click what you can see, skip what doesn't look relevant, and scan for what matters. Your users navigate with structure — headings to orient, landmarks to jump to, roles and names to understand what each element does. They hear the tree, one element at a time, in the order the DOM gives it to them.

That's not a different preference. That's a completely different product.

Most teams have never experienced their own product that way. Not because they don't care — but because nothing has ever made them sit down and try it.

---

## The test

**If you can complete the task through the accessibility tree, your users probably can too.**

**If you can't — that's the bug.**

Try to check out. Try to book an appointment. Try to find the error message after a failed form submission. Try to close the dialog that just opened. Try to understand where you are in the page.

Do it through the tree. Without looking at the UI.

When it's hard — when you can't find the button, can't figure out what a control does, can't tell if the action worked — stop there.

That's not a usability problem. That's your accessibility bug. And your screen reader users hit it every day.

---

## This is not a replacement for real testing

NVDA. JAWS. VoiceOver. TalkBack. These are the tools your users actually depend on. Each one has its own quirks, its own keyboard model, its own way of announcing dynamic content. None of that is simulated here.

Semantic Navigator does not reproduce what a screen reader sounds like, how it moves, or what it announces in response to focus changes. What it does is expose the raw material — the semantic tree — that screen readers consume.

Think of it as the difference between reading a recipe and tasting the dish. The tree tells you what's there. A real screen reader tells you how it's experienced.

**Use this tool to catch structural problems early and often.** Missing names, broken tab order, incorrect roles, unlabeled landmarks — these are findable here, in your normal development workflow, without spinning up AT.

**Use real screen readers before you ship.** Test with NVDA on Firefox. Test with VoiceOver on Safari. Test with JAWS if your users depend on it. There is no tool — this one or any other — that substitutes for that.

This extension makes those sessions less painful. It does not make them optional.

---

## The screen curtain

Semantic Navigator includes a screen curtain — a single `Curtain ON` toggle that blacks out the entire page. Only an extension can paint over a whole browser tab.

The tree stays. The panel stays. You can still interact with the full product. The visual layer is just gone.

This is the closest a sighted developer gets to the experience. It's uncomfortable. It should be. That discomfort is information.

While the curtain is on, the focus-ring overlay is suppressed too (no point drawing on a blacked-out page) — lean on the panel's tree selection to orient yourself.

---

## How it works

**1. Open the side panel**
Click the extension icon in your Chrome toolbar. The side panel opens next to the current page and populates immediately.

**2. See the semantic structure**
The page renders as an interactive tree — DOM view (raw HTML elements) or A11y view (roles, accessible names, states). This is what assistive technology perceives.

**3. Navigate your product**
Click links, fill forms, submit, expand menus, complete flows. You're using the real product — just through its structure instead of its visual layer.

**4. Find where it breaks**
When something is hard to locate, hard to understand, or impossible to complete, that's [the test](#the-test) failing — not a hypothetical, not a lint warning. Something your users have been hitting silently for months.

---

## What's unique to the Chrome extension

The extension surfaces the same engine as `@real-a11y-dev/inspector`, `@real-a11y-dev/react`, and `@real-a11y-dev/storybook-addon`. Everything *about reading the tree* is shared across those — see [the panel features guide](/guide/panel-features) for filters, search, focus tracking, scoping, and live region monitoring.

What only an extension can give you is the handful of capabilities that require a browser extension to reach across tabs and frames. The [screen curtain](#the-screen-curtain) above is one; here are the rest:

### Copy the tree as a Markdown report

The `Copy ▾` dropdown in the panel toolbar puts the current view on your clipboard as a Markdown accessibility report — the button's own tooltip reads *"Copy the tree as Markdown — paste into a bug report."* Only the extension has this: the clipboard/export code lives solely in the extension (`packages/extension/src/sidepanel/export.ts`), not in the shared `inspector` or `react` packages.

Pick what to copy:

- **Everything** — the tree, heading outline, and tab sequence in one document.
- **A11y tree** / **DOM tree** — just the tree currently shown (the label follows your active view mode).
- **Headings** — the heading outline (`h1`..`h6`).
- **Tab sequence** — the focusable nodes in tab order.

Every export opens with a reproducibility header, so a pasted report is self-describing:

```md
# Accessibility report — Checkout · Example Store

- **URL:** https://example.com/checkout
- **Scope:** dialog "Confirm order"
- **Captured:** 2026-07-11T14:32:10.000Z
- **Tool:** Semantic Navigator 0.1.7
```

The `Scope` line appears only when the panel is scoped to a subtree, so the report states exactly what it covers. Each selected view then follows as its own fenced `##` section — drop the whole thing into a GitHub issue or any Markdown tracker and the person reading it can see the structure without re-running anything.

### Cross-iframe tree merging

iframes are merged into the parent tree at the correct depth. The extension's background script reaches across frame boundaries (a privilege only extensions have) and stitches each iframe's locally-extracted tree onto its `<iframe>` placeholder in the parent. Embedded widgets, third-party flows, payment forms — all in scope.

In-page packages (`inspector`, `react`) only see their own document and can't merge across origins. The extension is the only surface that gives you the full picture for sites that use iframes heavily.

### Keyboard bar — `Esc` · `Tab` · `Shift+Tab` · `Enter` · `Space` · `↑` · `↓`

Buttons that dispatch a synthetic `KeyboardEvent` to whatever element currently has focus on the host page. Possible only because the extension's content script can `dispatchEvent` against the page's DOM from outside.

**Common flow:** navigate to a combobox in the tree → press Enter (in the tree) to activate it → the combobox opens on the page → use the keyboard bar's `↓`/`↑` to move through options → `Enter` to select → `Esc` to dismiss.

### Close tab — `×` next to the page title

Closes the current browser tab. Handy for dismissing popups, login windows, or test tabs without reaching for the mouse. Extension-only because it uses `chrome.tabs.remove`.

### Cross-link chips on disclosure pairs

Disclosure widgets — a button that opens a menu, a tab that controls a panel, a combobox bound to a listbox — render as two separate rows in the tree, often far apart. The relationship between them is the most useful piece of information when debugging the widget, and it's the easiest to miss.

The panel renders that relationship as paired clickable chips:

- On the **trigger** row: `→ <role> "<name>"` pointing at the controlled element.
- On the **controlled** row: `← <role> "<name>"` pointing back at the trigger.

Click either chip and the panel expands every collapsed ancestor of the target, scrolls it to the center of the viewport, and briefly flashes its row.

**Two link sources, distinguished visually:**

- **Solid border** — the link comes from an explicit `aria-controls` attribute. Properly authored disclosure pattern.
- **Dashed border** — the link is **inferred** from `aria-haspopup` + `aria-expanded="true"` plus DOM proximity, because the trigger has no `aria-controls`. Common in apps that skip `aria-controls` (Drive, Gmail, plenty of in-house component libraries). The hedged tooltip ("Likely controls …") sets the right expectation — when two unrelated menus are open at once, the inferred pairing can be wrong.

### Manual refresh on tab switch — `↻` toolbar button

When you switch browser tabs, the panel **clears its tree** and shows the empty "Connecting…" state instead of stale content from the previous tab. Hit the `↻` refresh button to load the new tab's tree.

This is intentional: auto-refresh on tab switch was unreliable across the long tail of pages (restricted URLs with no content script, lazy-injected content scripts that aren't ready yet, races between the panel and the content script becoming reachable). The manual refresh trades one extra click for predictability — you always know what you're seeing.

### BETA pill in the panel header

Sets expectations during the pre-1.0 phase. Linked to the GitHub issues page. Goes away at v1.0.

---

## Reading the tree, scoping, filtering, focus tracking

These behaviors are shared with `@real-a11y-dev/inspector` (and every package built on it). They work the same way in the extension's panel as they do anywhere else the tree is rendered:

- **[Reading the DOM view](/guide/reading-the-dom-view)** · **[A11y view](/guide/reading-the-a11y-view)** · **[TAB view](/guide/reading-the-tab-view)** — what each view shows
- **[Panel features](/guide/panel-features)** — filters, search, focus tracking, scoping, live region monitoring, keyboard navigation

---

## Install

**Chrome Web Store** — [Semantic Navigator](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom).

> Chrome may show *"Proceed with caution — not trusted by Enhanced Safe Browsing"* on first install. That's ESB's default for any newly-listed extension until Google's systems have built up enough signal on the listing — it's not a specific issue with this extension. Click **Continue to install**.

**Load unpacked (developer mode)**

To run from source instead of the Web Store build:

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y
pnpm install
pnpm --filter @real-a11y-dev/semantic-navigator-extension build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `packages/extension/dist`

---

Open source. MIT license. No tracking. No accounts.
