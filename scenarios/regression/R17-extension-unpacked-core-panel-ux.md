---
id: R17
suite: regression
scenario: "Extension: load unpacked build in Chrome — core panel UX (tree, views, search, select, picker, keyboard)"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.8 (private — versioned separately from the npm packages; ships via the Chrome Web Store). Load unpacked from packages/extension/dist"
validUntil: ""
expected: "Panel connects and renders the tree; all views/search/picker work; arrowing announces the active row to a screen reader"
twin: D6
notion: "https://app.notion.com/p/3aa1c354b0b581f9ad79e56b74cc7bc4"
---

## Steps

```bash
pnpm --filter @real-a11y-dev/semantic-navigator-extension build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `packages/extension/dist`. (After any rebuild, click the refresh icon on that
page — a stale service worker is the usual cause of "it didn't change".)

1. Open the side panel on a content-rich page — does it connect and render a tree?
2. Switch views: tree / outline / tab order / findings
3. Search, and type-ahead within the tree
4. Select a node — is the corresponding element highlighted on the page?
5. The element picker: pick from the page, land on the right node. Pick a node on a
   **widget that reacts before `click`** — a dropdown trigger (Radix/Headless UI open
   on `pointerdown`), a button with a Material-style ripple, a focusable input — and
   confirm the page does not react at all: no menu opens, no ripple, focus does not
   move to what you picked
6. **Keyboard only**, no mouse: reach the panel, move through the tree with arrows,
   expand/collapse, activate
7. Repeat 6 with a screen reader running (VoiceOver / NVDA)
8. A heavy page (a long docs page, a big table) — is it usable, or does it stall?
9. Open the panel on `chrome://newtab` (or the Chrome Web Store, or a PDF opened in
   Chrome's built-in viewer) — does the panel say the page can't be inspected, rather
   than sitting on "Connecting to page…"? Then, from a normal page with a tree loaded,
   switch to one of those tabs and press **Load tree** — same message? (Switching alone
   shows the ordinary empty state; the panel does not auto-request on a tab switch.)
   Finally navigate that same tab back to an `http(s)` page and hit **Try again** / `↻`
   — does it attach?

## Expected

- Panel connects and renders without a manual reload
- Every view populates and stays in sync with the page
- Selection highlights the right element; the picker resolves to the right node
- **Picking never activates what you picked.** Before `core 0.1.0-beta.12` the picker
  cancelled only the `click`, so on a run against an earlier release the menu opening
  or focus moving on step 5 is the known defect, not a new one
- **Arrowing announces the active row** to the screen reader. This is the one that
  actually matters
- Expand/collapse state survives live tree updates — a re-render that collapses
  everything makes the panel unusable on a real page
- No visible stall on a heavy page
- **A page Chrome won't run a content script on says so.** From the next extension
  release (the `Unreleased` entry in `packages/extension/CHANGELOG.md`) step 9 shows
  "This page can't be inspected" with a **Try again** button; on an earlier build the
  panel shows "Connecting to page…" indefinitely there, which is the defect this step
  exists for, not a new one

## Why this exists

This is an accessibility tool: a panel that is itself unusable by keyboard or screen
reader is not a partial failure, it's a contradiction. Steps 6–7 are the point of the
row and cannot be automated meaningfully — they need a human with a screen reader on.

Step 8 is here because tree virtualization and live-update handling have both
regressed before in ways that only show at scale, never on a fixture.

Step 9 is the day-one path and was silently broken: the new-tab page is what's open
when most people first click the extension, and the panel's "am I attached?" signal
is a tree arriving — which on a restricted page never does. The background reported
delivery before Chrome had confirmed it, so there was nothing to distinguish "still
loading" from "impossible here". It needs a human because it is a Chrome restriction
no test environment reproduces: the background half has a regression test, the panel
half has none — the extension's vitest config only collects `*.test.ts`, so there are
no side-panel component tests to add one to.

## Notes

**On `covers:`** — the extension is private and not in the published package set, so
it has no manifest path to cover. The coverage matrix tracks the shipped CLI and MCP
surface; extension rows are tracked by area instead.
