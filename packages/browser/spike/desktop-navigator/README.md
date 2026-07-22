# Desktop Semantic Navigator — idea validation

**Status:** Spike · **Branch:** `cursor/desktop-navigator-spike-67b2`  
**Run:** `pnpm --filter @real-a11y-dev/browser run test:spike:desktop`

## Product thesis

Semantic Navigator’s pitch is not “another a11y inspector.” It is:

> **The accessibility tree is the interface.** Hide the visual page. Click, type, and complete tasks through roles and names. If the page doesn’t make sense as a tree, it doesn’t make sense.

The Chrome extension already does this with a **screen curtain** — but it is limited to the **DOM producer** (content script, no CDP). Media controls and other UA-shadow structure stay invisible; fidelity is capped.

A **desktop (or headless shell) app** can own Chromium over CDP the way CLI/MCP already do, and therefore:

1. Show the **native** accessibility tree (Blink).
2. **Dispatch actions** through that tree (justified here — interaction *is* the product; unlike CLI/MCP snapshots).
3. Keep the curtain philosophy: the auditor’s UI is **tree-only**; the visual page is hidden.

That is a credible “best tool for auditing a11y websites” in the *experience* sense Real A11y already claims — structure AT consumes — without pretending to be VoiceOver/NVDA (the extension docs already say we don’t reproduce speech/rotor).

## What this spike proves

| Claim | Result |
|---|---|
| Tree-only UI, no page preview | **Yes** — `panel.html` is the sole auditor surface |
| Page invisible | **Yes** — headless Chromium + curtain overlay |
| Native AX via CDP | **Yes** — `Accessibility.getFullAXTree` |
| Complete a task through the tree | **Yes** — check “gift” → click “Pay now” → live region updates |
| CDP action dispatch belongs here | **Yes** — unlike cli/mcp (snapshot-only), this product *is* interaction |

Checkout fixture flow exercised through `/api/click` only — the test never looks at pixels.

## What it is not (yet)

- Not Electron / packaged desktop app
- Not the full `semantic-navigator-ui` panel (deliberately thin HTML)
- Not live region / focus announcement emulation (structure + action only)
- Not a replacement for the Chrome extension (extension still wins “any tab I’m already on”)

> **Architecture:** the product design for this app — one engine (`A11ySession`), panel protocol v0, packaging ladder — is [`docs/rfcs/native-tree-v3.md`](../../../../docs/rfcs/native-tree-v3.md) §4.

## Recommended product split

| Surface | Role |
|---|---|
| **Chrome extension** | Lightweight: any tab, DOM tree, curtain, daily browsing |
| **Desktop / Navigator app** | Full fidelity: native tree + CDP actions + curtain-first audit sessions |
| **CLI / MCP / Playwright testing** | Headless snapshot & CI (native read; no tree-dispatch required) |

## Manual try

```bash
pnpm --filter @real-a11y-dev/browser build   # if needed
pnpm --filter @real-a11y-dev/browser run test:spike:desktop
```

To open the panel in a real browser while the hidden page runs, add a tiny `run.mts` later that prints `http://127.0.0.1:<port>/` after `startPanelServer`.
