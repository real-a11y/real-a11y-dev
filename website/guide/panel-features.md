---
title: Panel features — filtering, scoping, focus tracking
description: Filters, search, focus tracking, scoping, and live region monitoring — the shared interactive behaviors of every Real A11y panel (Chrome extension, inspector, React, Storybook).
---

# Panel features

> These behaviors are **shared across every Real A11y surface** — the [Chrome extension](/guide/chrome-extension), the [`@real-a11y-dev/inspector`](/packages/inspector) embed, the [React component](/packages/react), and the [Storybook addon](/packages/storybook-addon). If a feature exists in one, it exists in all of them. Where the per-package APIs differ, this page calls out which prop / option to reach for.

---

## Search

A live filter over the tree. Matches on **tag name**, **role**, **accessible name**, **attributes**, and **visible text**. Type "email" → every input, label, and heading whose name or content contains "email" stays visible; everything else collapses. Clearing the field restores the full tree.

Works in DOM, A11y, and TAB views.

| Surface | How it appears |
|---|---|
| Chrome extension | The "Search nodes…" input at the top of the panel toolbar |
| `inspector` / React `<SemanticNavigator />` | Same input, rendered by `@real-a11y-dev/semantic-navigator-ui` |
| Storybook addon | Same input in the addon panel header |

---

## Role filters

Six chip-style toggles that hide every node except the matching role (and the ancestors needed to reach it). Click the same chip again to clear.

| Filter | What it shows | What it's for |
|---|---|---|
| **Headings** | `h1`–`h6` and `role="heading"` | Verify the document outline — exactly one h1, no skipped levels |
| **Links** | `<a href>` and `role="link"` | Audit link text — every link should have a unique, meaningful name |
| **Buttons** | `<button>` and `role="button"` | Catch icon-only buttons missing `aria-label` |
| **Forms** | Every form control with its label | Catch unlabeled fields fast |
| **Landmarks** | `main`, `banner`, `contentinfo`, `nav`, `region`, etc. | Verify structural landmarks — one `main`, named `nav`s when there are several |
| **Images** | `<img>` and `role="img"` with their alt/aria-label | Empty alts (decorative) stand out from missing alts (a bug) |

**Disabled in TAB view** — the tab sequence is already a flat projection; filtering it by role would double-filter.

| Surface | How to enable |
|---|---|
| Chrome extension | The chip row above the tree |
| `inspector` / React | Built into the panel UI; nothing to wire up |
| Storybook addon | Same chip row in the addon panel |

---

## Focus tracking

When focus tracking is **on**, the panel and the host page stay in sync **bidirectionally**:

- **Page → panel** — when focus moves on the page (Tab, click on a focusable element), the panel draws the highlight overlay on that element, scrolls the tree to its node, and selects the row. **This is what the "Focus sync" toggle controls.** Implemented by the [Chrome extension](/guide/chrome-extension) via a `focusin` listener in its content script; the in-page surfaces don't ship this auto-sync (the host app would have to wire it up itself).
- **Panel → page** — selecting a tree node draws the highlight overlay on the corresponding element. The Chrome extension *also* moves real focus to that element on selection — its DevTools panel lives in a separate window, so it can do that without disrupting panel navigation. For the in-page surfaces (`inspector`, React `<SemanticNavigator />`), focus and scroll side effects on the host element are **opt-in**, to avoid stealing focus from the panel itself. See [Panel interaction vs. host side effects](#panel-interaction-vs-host-side-effects).

### When to leave it on
The default. It's the single strongest feature for understanding "what a keyboard user is looking at right now." Tab through a form with the panel open and you'll see the experience.

### When to turn it off
Three cases:

1. **Focus-heavy pages** — forms with 30+ fields, SPAs that grab focus on every interaction, or pages with aggressive focus-trap libraries. The tree would jump around continuously; turning the sync off keeps it stable on the node you're inspecting.
2. **Auditing a specific subtree** — when you've scoped into a dialog or region and want to prod the page without losing your place.
3. **Curtain mode** *(extension only)* — with the page blacked out, the overlay is suppressed anyway; turning the sync off avoids unnecessary message traffic.

### How to verify it's working
Focus the page itself first (click anywhere on the page, not the panel), then press Tab. You should see **both** a blue rectangle on the focused page element **and** the corresponding tree node highlight in the panel. If only one happens — or neither — see the [troubleshooting page](/guide/troubleshooting).

| Surface | API |
|---|---|
| Chrome extension | "Focus sync" / "Focus OFF" toggle in the toolbar — controls page → panel sync; panel → page focus is always on (separate window, no conflict) |
| `inspector` | `createInspector({ root, container, highlightOnHover: true, scrollHostOnSelect: true, focusHostOnActivate: true })` — opt in to overlay / scroll / focus on the host page; all three default to off, see [the rationale](#panel-interaction-vs-host-side-effects) |
| React `<SemanticNavigator />` | `<SemanticNavigator highlightOnHover scrollHostOnSelect focusHostOnActivate />` — same opt-ins as the inspector; see [the package reference](/packages/react#props) |
| Storybook addon | Selection draws an overlay on the story preview by default; the addon hardcodes safe values since the manager iframe is isolated from the preview |

---

## Scoping

Narrow the audit root to a subtree. Useful when you want to focus on one form, one dialog, or one widget without the rest of the page in the way.

In the panel, double-click any node to scope into it. The tree re-renders showing only that subtree. A breadcrumb at the top shows the path; click any breadcrumb segment to scope back up, or the `×` to exit to the full tree.

Scoping affects:
- **What's visible** in the tree (only the scoped subtree's descendants)
- **What's audited** (search and role filters operate inside the scope)
- **The tab sequence** (TAB view only lists focusable elements inside the scope)

| Surface | API |
|---|---|
| Chrome extension | Double-click any node to scope; breadcrumb + `×` button to exit |
| `inspector` | `inspector.setRoot(element)` to scope; `inspector.setRoot(originalRoot)` to exit |
| React `<SemanticNavigator />` | Update the `root` prop's ref to point at the scoped element |
| `@real-a11y-dev/testing` | `attach(page, { rootSelector: "form" })` for Playwright; `auditSnapshot(form, …)` for jsdom — see [the testing reference](/packages/testing/snapshots#auditsnapshot-root-options) |

### Dialog auto-scope

When the page opens a `<dialog>` or `[role="dialog"]`, the panel automatically scopes into it. A "Dialog: …" indicator appears with the dialog's accessible name. This is what a screen reader user effectively gets — the rest of the page becomes inert and the dialog is the only thing they can navigate. Verifying that auto-scope works correctly (proper labeling, focus trap, escape to close) is one of the highest-value audits the panel enables.

---

## Live region monitoring

Every `aria-live` region update, `role="status"` change, and `role="alert"` on the page appears in the panel's live log in real time, labeled *polite* or *assertive*. The order, timing, and content are what a screen reader would announce.

Use this to verify:
- **Toast notifications** announce on appearance
- **Form validation errors** announce when triggered
- **Loading indicators** announce both their start ("Loading…") and completion ("Loaded.")
- **Search-result counts** announce as you type

| Surface | Where the log appears |
|---|---|
| Chrome extension | Bottom of the side panel |
| `inspector` / React | Bottom of the panel by default |
| Storybook addon | Inside the panel — same position |

---

## Keyboard navigation

The panel itself is fully keyboard-operable.

| Key | Action |
|---|---|
| `↑` / `↓` | Move between tree rows |
| `→` | Expand the current row |
| `←` | Collapse the current row, or move to its parent |
| `Enter` | Activate the current node — clicks links, submits buttons, opens menus |
| `Space` | Same as Enter for most elements; toggles checkboxes/radios |
| `/` | Focus the search input |
| `Home` / `End` | Jump to the first / last visible row |
| Printable characters | Type-ahead — jump to the next row whose accessible name starts with the typed characters (multi-character within ~500ms; repeating the same letter cycles matches) |
| `Esc` | Clear scope, then clear search, then close the panel |

Implemented in `@real-a11y-dev/semantic-navigator-ui` via `useTreeKeyboard` (and the same type-ahead helper on filtered / tab-sequence listboxes) — every package that mounts the tree gets the same keymap.

---

## Panel interaction vs. host side effects

A distinction worth pinning down before wiring up an in-page panel for the first time, because the framing "interaction is opt-in" gets it backwards:

- **Panel-internal interaction is always on, in every surface.** Selecting a row, clicking a cross-link chip and jumping to its target, expanding / collapsing, arrow-key tree movement — all of this mutates panel state only. Nothing you do *inside* the panel reaches the real DOM until you ask it to. This is identical across the Chrome extension, the inspector embed, the React component, and the Storybook addon.
- **Host-page side effects are what's gated.** Calling `.focus()` or `.scrollIntoView()` on the *real* element in response to a panel action — that's opt-in for the in-page surfaces and on by default for the isolated ones.

| Surface | Where the panel renders | `highlightOnHover` / `scrollHostOnSelect` / `focusHostOnActivate` |
|---|---|---|
| Chrome extension | DevTools panel (separate window) | On by default — no focus/scroll conflict possible |
| Storybook addon | Manager iframe (separate document from story preview) | Hardcoded to safe values — addon doesn't expose the props |
| `@real-a11y-dev/inspector` | Same document as the audited app | **Off by default** — opt in via config |
| React `<SemanticNavigator />` | Same document as the audited app | **Off by default** — opt in via props |

### Why the in-page surfaces default to off

If activating a tree row stole focus to the host element, every Enter / Space on a row would yank focus out of the panel and break tree-pattern keyboard navigation. Same for scroll — every arrow-key step would scroll the page out from under you. The extension and Storybook addon don't have that problem because the panel and the inspected DOM live in different windows / iframes; `.focus()` on a host element in one document can't pull focus out of a panel in another.

The broader principle, recorded in the changelog when these defaults were established: *opt-in host-app side effects so audits and test harnesses don't disturb the app under test.*

### Opting in for the in-page surfaces

```ts
// Vanilla
createInspector({
  root,
  container,
  highlightOnHover: true,
  scrollHostOnSelect: true,
  focusHostOnActivate: true,
});
```

```tsx
// React
<SemanticNavigator
  root={rootRef}
  highlightOnHover
  scrollHostOnSelect
  focusHostOnActivate
/>
```

`highlightOnHover` is the safest of the three to enable — the overlay just paints over the host page without touching its layout or focus. `scrollHostOnSelect` and `focusHostOnActivate` are the ones that affect the page underneath; turn them on when the panel is set up as an active inspection tool, leave them off when the panel is mounted in production for end users.

---

## See also

- [Reading the DOM View](/guide/reading-the-dom-view) · [A11y View](/guide/reading-the-a11y-view) · [TAB View](/guide/reading-the-tab-view) — what the tree itself shows in each mode
- [Accessible Names](/guide/accessible-names) — the algorithm behind every accessible name in the tree
- [Architecture](/guide/architecture) — where the engine and renderer split lives
- [Troubleshooting](/guide/troubleshooting) — empty audits, flapping snapshots, focus-sync diagnostics
