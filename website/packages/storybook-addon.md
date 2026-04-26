---
title: "@real-a11y-dev/storybook-addon — A11y panel for every story"
description: One line in .storybook/main.ts adds a live accessibility tree panel next to every story. Tree, outline, and tab sequence — updated as the story re-renders.
---

# @real-a11y-dev/storybook-addon

> **TL;DR** — One line in `.storybook/main.ts` and every story gets a Semantic Navigator panel next to Controls / A11y — showing the tree, heading outline, and tab sequence, updating live as the story re-renders. Reach for this when you **develop components in Storybook** and want per-story a11y insight without writing tests.

A Storybook 8 panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live as the story renders.

## Install

```sh
npm install -D @real-a11y-dev/storybook-addon
```

**Peer dependencies:** `storybook >= 8`, `react >= 18`, `react-dom >= 18`, `@storybook/manager-api >= 8`, `@storybook/preview-api >= 8`

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

The panel has three views:

| Tab | Shows |
|---|---|
| **Tree** | Full semantic tree in `auditSnapshot()` format — indented text showing roles, names, and levels. |
| **Outline** | Heading outline in `outlineSnapshot()` format — h1..h6 structure for quick structure review. |
| **Tab sequence** | Focusable elements in tab order via `tabSequenceSnapshot()`. |

A mode switcher (A11y / DOM) is available in the panel header. Switching mode re-extracts the tree immediately.

---

## How it works

The addon follows Storybook 8's manager/preview split:

- **Preview** (`@real-a11y-dev/storybook-addon/preview`) runs inside the story iframe. It observes `#storybook-root` with a `DomObserver` (200ms debounce) and emits `TREE_UPDATED` events over the Storybook channel whenever the story DOM changes.

- **Manager** (`@real-a11y-dev/storybook-addon/manager`) runs in the Storybook UI shell (React). It subscribes to `TREE_UPDATED` events and renders the latest snapshot in the panel.

```
Preview iframe                        Manager (Storybook UI)
────────────────                      ──────────────────────
story renders                         Panel subscribes
DomObserver fires          channel    to TREE_UPDATED
→ auditSnapshot() ──TREE_UPDATED───▶  → renders <pre>
→ outlineSnapshot()
→ tabSequenceSnapshot()
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

You can disable the addon for individual stories:

```ts
export const MyStory: Story = {
  parameters: {
    semanticNavigator: {
      disabled: true,
    },
  },
};
```

::: tip
Per-story assertions (expected outline, expected tab sequence) are planned for v0.2. The channel architecture is already in place to support them.
:::

---

## Channel events

If you need to integrate with the addon from your own tooling:

```ts
import { EVENTS, type TreeUpdatePayload } from "@real-a11y-dev/storybook-addon";

// EVENTS.TREE_UPDATED — fired by the preview, consumed by the manager
// EVENTS.SET_MODE     — fired by the manager, consumed by the preview

const channel = addons.getChannel();
channel.on(EVENTS.TREE_UPDATED, (payload: TreeUpdatePayload) => {
  console.log(payload.serialized);   // auditSnapshot output
  console.log(payload.outline);      // outlineSnapshot output
  console.log(payload.tabSequence);  // tabSequenceSnapshot output
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

The addon listens to `storyRendered` and `storyChanged` events. If your framework delays rendering past the `storyRendered` event, the first snapshot may capture an empty state. A second extraction fires automatically on the next DOM mutation, so the panel catches up within 200ms.

---

## See it running

- **Storybook 8 + Vite + React** — [`examples/storybook/`](/examples/storybook): Button / Form / Dialog / Navigation stories showing how the panel reacts to Controls changes.
- **Storybook 8 + React 19** — the [Storybook + React 19 recipe](/recipes/storybook-react-19) covers the `viteFinal` JSX override needed with React 19 projects.

---

## Panel features

Inside every story's panel: search, role filters, focus tracking, scoping, live region monitoring, keyboard navigation. Same UI as the Chrome extension and inspector — see the shared reference for what each control does and when to reach for it.

→ [Panel features reference](/guide/panel-features)
