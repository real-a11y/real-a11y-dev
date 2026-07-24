---
title: "@real-a11y-dev/storybook-addon — A11y panel for every story"
description: One line in .storybook/main.ts adds a live accessibility tree panel next to every story. Tree, outline, and tab sequence — updated while the panel is open.
---

# @real-a11y-dev/storybook-addon

> **TL;DR** — One line in `.storybook/main.ts` and every story gets a Semantic Navigator panel next to Controls / A11y — showing the tree, heading outline, and tab sequence, updating live while the panel is open (idle when another tab is active). Reach for this when you **develop components in Storybook** and want per-story a11y insight without writing tests.

A Storybook 8 panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live while the panel is open.

## Install

```sh
npm install -D @real-a11y-dev/storybook-addon
```

**Peer dependencies:** `storybook >= 8`, `react >= 18`, `react-dom >= 18`, `@storybook/manager-api >= 8`, `@storybook/preview-api >= 8`, and `@storybook/theming >= 8` (optional)

---

## Setup

Add the addon to `.storybook/main.ts`:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  addons: [
    "@storybook/addon-essentials",
    "@real-a11y-dev/storybook-addon",    // ← add this
  ],
  // ...
};

export default config;
```

That's it. No decorator, no parameters required. A **Semantic Navigator** panel appears next to Controls, Actions, and A11y for every story.

---

## The panel

The panel embeds the full interactive **Semantic Navigator** tree — the same `TreePanel` used by the Chrome extension and inspector — rendered inside a CSS-isolated shadow root. A mode switcher in the panel header offers three views:

| Mode | Shows |
|---|---|
| **A11y** | The accessibility tree — roles, accessible names, and ARIA states for every node in the story. |
| **DOM** | The raw DOM tree — tag names and attributes, useful to confirm whether a semantic element is actually being rendered. |
| **Tab** | Focusable elements in tab order, derived from the current a11y tree. |

Switching between **A11y** and **DOM** re-extracts the story via the channel; **Tab** is a client-side transform of the current tree, so it switches instantly.

---

## How it works

The addon follows Storybook 8's manager/preview split:

- **Preview** (`@real-a11y-dev/storybook-addon/preview`) runs inside the story iframe. Extraction is **lazy**: it only stands up a `DomObserver` (200ms debounce) after the manager emits `REQUEST_TREE` (panel open), and tears it down on `STOP_TREE` (panel hidden). While active it emits `TREE_UPDATED` over the Storybook channel whenever the story DOM changes — so animating or Controls-driven stories don't pay extract + `postMessage` cost while you're on another addon tab.

- **Manager** (`@real-a11y-dev/storybook-addon/manager`) runs in the Storybook UI shell (React). It mounts only when the Semantic Navigator tab is active, subscribes to `TREE_UPDATED` events, deserializes the tree (the `[id, node][]` array back into a `Map`), and renders the interactive `TreePanel` from `@real-a11y-dev/semantic-navigator-ui` inside a shadow root.

```
Preview iframe                              Manager (Storybook UI)
────────────────                            ──────────────────────
(idle until panel opens)                    Panel mounts → REQUEST_TREE
←──────────────────────────────────────────
start DomObserver + extract
→ TREE_UPDATED ───────── channel ─────────▶ deserialize tree (array → Map)
   { tree, mode, extractedAt }              → render <TreePanel/> in a shadow root
storyRendered (incl. after canvas reload)   Panel still open → REQUEST_TREE again
←──────────────────────────────────────────
Panel unmounts → STOP_TREE
←──────────────────────────────────────────
stop DomObserver (no further extracts)
```

---

## Using the panel effectively

Open any story and click the **Semantic Navigator** tab. Then:

1. **Tree** — inspect the role, accessible name, and ARIA states of every element in the story canvas. Compare what you see here to what the design intent was.
2. **Outline** — verify the heading hierarchy at a glance. Stories that embed full page templates should still produce a coherent outline.
3. **Tab sequence** — press the keyboard-navigation icon and confirm the focus order matches user expectation. Disabled controls correctly drop out of the sequence; positive `tabindex` values show a warning badge.
4. **Mode toggle** — flip between A11y and DOM modes. In DOM mode you see raw tag names (e.g. `div` instead of the implicit role); useful to confirm whether a semantic element is actually being rendered.
5. **Combine with Controls** — change a prop (e.g. `disabled`, `aria-label`) in the Controls panel and watch the Semantic Navigator panel re-extract within 200 ms. Great for regression-checking state-dependent a11y.

---

## Story parameters

The addon reads no story parameters today — it runs on every story with no per-story configuration required.

::: tip
Per-story controls (disabling the panel for a specific story, expected-outline / expected-tab-sequence assertions) are planned for v0.2. The channel architecture is already in place to support them.
:::

---

## Channel events

If you need to integrate with the addon from your own tooling:

```ts
import { EVENTS, type TreeUpdatePayload } from "@real-a11y-dev/storybook-addon";

// Preview → manager:
//   EVENTS.TREE_UPDATED    — a fresh extraction (on every debounced DOM change while the panel is open)
// Manager → preview:
//   EVENTS.REQUEST_TREE    — start observing (if needed) and send the current tree (panel mount)
//   EVENTS.STOP_TREE       — tear down the observer (panel unmount / hidden)
//   EVENTS.SET_MODE        — re-extract with a new view mode
//   EVENTS.HIGHLIGHT_NODE  — highlight a node in the story by id
//   EVENTS.CLEAR_HIGHLIGHT — clear the highlight overlay
//   EVENTS.ACTIVATE_NODE   — dispatch a node's primary action in the story

const channel = addons.getChannel();
channel.on(EVENTS.TREE_UPDATED, (payload: TreeUpdatePayload) => {
  // payload.tree is a SerializableTree: { nodes: [id, node][], rootId }
  const { nodes, rootId } = payload.tree;
  console.log(rootId, `${nodes.length} nodes`);
  console.log(payload.mode);         // "a11y" | "dom" | "tab"
  console.log(payload.extractedAt);  // Date.now() timestamp
});
```

---

## Troubleshooting

**Panel shows "Waiting for story to render…"**

This means the preview hasn't emitted a `TREE_UPDATED` event yet. Check:
- The story is in `story` view mode (not `docs`)
- `#storybook-root` exists in the iframe DOM
- No errors in the Storybook preview console

**Panel content is out of date after a story change**

The addon listens to `storyRendered` and `storyChanged` events **while the panel is open**. If your framework delays rendering past the `storyRendered` event, the first snapshot may capture an empty state. A second extraction fires automatically on the next DOM mutation, so the panel catches up within 200ms. With the panel closed, the preview stays idle — open the Semantic Navigator tab to resume.

---

## See it running

- **Storybook 8 + Vite + React** — [`examples/storybook/`](/examples/storybook): Button / Form / Dialog / Navigation stories showing how the panel reacts to Controls changes.
- **Storybook 8 + React 19** — the [Storybook + React 19 recipe](/recipes/storybook-react-19) covers the `viteFinal` JSX override needed with React 19 projects.

---

## Panel features

Inside every story's panel: search, role filters, focus tracking, scoping, live region monitoring, keyboard navigation. Same UI as the Chrome extension and inspector — see the shared reference for what each control does and when to reach for it.

→ [Panel features reference](/guide/panel-features)
