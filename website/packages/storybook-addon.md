---
title: "@real-a11y-dev/storybook-addon — A11y panel for every story"
description: One line in .storybook/main.ts adds a live accessibility tree panel next to every story. Tree, outline, and tab sequence — updated while the panel is open.
---

# @real-a11y-dev/storybook-addon

> **TL;DR** — One line in `.storybook/main.ts` and every story gets a Semantic Navigator panel next to Controls / A11y — showing the tree, heading outline, and tab sequence, updating live while the panel is open (idle when another tab is active). Reach for this when you **develop components in Storybook** and want per-story a11y insight without writing tests.

A Storybook panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live while the panel is open.

## Install

```sh
npm install -D @real-a11y-dev/storybook-addon
```

**Peer dependencies:** `storybook` (9.x, 10.x or 11.x), `react ^18.0.0 || ^19.0.0`, `react-dom ^18.0.0 || ^19.0.0`.

::: warning Storybook 8 is not supported
Storybook 9 folded `@storybook/manager-api`, `@storybook/preview-api` and
`@storybook/theming` into the `storybook` package as the subpath exports
`storybook/manager-api`, `storybook/preview-api` and `storybook/theming`. The
standalone packages stopped publishing at 8.6, and `storybook@8` has no
equivalent subpath — so no single build can serve both. On Storybook 8, stay on
`@real-a11y-dev/storybook-addon@0.1.0-beta.16`.

Storybook 11 **is** in the peer range, as `^11.0.0-0`. The `-0` is load-bearing:
Storybook 11 has only published prereleases so far, and a plain `^11.0.0` does
not match a prerelease — the range would have excluded every Storybook 11 that
actually exists. An advisory CI job installs `storybook@next` and re-runs the
addon's type-check, build and tests against it, so a breaking change in 11
surfaces here rather than in your install.

Be precise about what that verifies. `tsc` checks every Storybook API the addon
uses against 11's own declarations, and the build resolves the same specifiers
as externals. Of the tests, the ones that carry an 11 signal are those that
compose the addon through Storybook's real `definePreview` and `composeConfigs`
— the rest mock the Storybook API. Nothing in CI renders the panel on 11; that
was checked by hand, on `11.0.0-alpha.8` with Vite, under both a classic and a
CSF Next preview. Treat 11 support as provisional until 11 ships stable.
:::

---

## Setup

Add the addon to `.storybook/main.ts`:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  addons: [
    "@real-a11y-dev/storybook-addon",    // ← add this
  ],
  // ...
};

export default config;
```

That's it for a classic `.storybook/preview.ts`. No decorator, no parameters required. A **Semantic Navigator** panel appears next to Controls, Actions, and A11y for every story.

### CSF Next (`definePreview`)

If your `.storybook/preview.ts` calls `definePreview` — CSF Next, which
Storybook 11 makes the default — name the addon there too:

```ts
// .storybook/preview.ts
import { realA11y } from "@real-a11y-dev/storybook-addon";
import { definePreview } from "@storybook/react-vite";

export default definePreview({
  addons: [realA11y()],
});
```

Keep it in `main.ts` as well. The two do different jobs: `main.ts` adds the
panel to Storybook's UI, and `definePreview` runs the half that lives in the
story iframe. A classic preview gets that half from `main.ts` automatically; a
`definePreview` one composes only the addons it names, so without this line the
panel stays on "Waiting for story to render…".

`storybook add` writes the other form Storybook supports for a third-party
addon, a namespace import of its preview entry. That works too:

```ts
import * as realA11yPreview from "@real-a11y-dev/storybook-addon/preview";

export default definePreview({
  addons: [realA11yPreview],
});
```

Name it one way, not both. Naming it twice is harmless — the second is ignored —
but it is redundant.

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

The addon follows Storybook's manager/preview split:

- **Preview** (`@real-a11y-dev/storybook-addon/preview`) runs inside the story iframe, as a project-level `beforeAll` annotation: Storybook runs it once when the preview starts, whichever way the addon reached the project's annotations (from `main.ts`, or named in `definePreview`). Extraction is **lazy**: it only stands up a `DomObserver` (200ms debounce) after the manager emits `REQUEST_TREE` (panel open), and tears it down on `STOP_TREE` (panel hidden). While active it re-extracts on every debounced DOM mutation, but emits `TREE_UPDATED` over the Storybook channel **only when that extraction differs from the last one it published** — so a mutation that extracts to an identical tree (an animation frame rewriting inline `style`, a change inside an `aria-hidden` subtree) costs no `postMessage` and no panel re-render at all. And because the observer only exists while the panel is open, animating or Controls-driven stories pay no extract and no `postMessage` cost at all while you're on another addon tab.

- **Manager** (`@real-a11y-dev/storybook-addon/manager`) runs in the Storybook UI shell (React). It asks for a tree only while its tab is selected and the addon panel is showing — read off its own box, since from Storybook 10.1 every addon panel stays mounted — subscribes to `TREE_UPDATED` events, deserializes the tree (the `[id, node][]` array back into a `Map`), re-applies the user's expand/collapse via `preserveExpandedState` (so a Controls tweak or animation does not snap open every row), and renders the interactive `TreePanel` from `@real-a11y-dev/semantic-navigator-ui` inside a shadow root.

```
Preview iframe                              Manager (Storybook UI)
────────────────                            ──────────────────────
(idle until panel opens)                    Panel shown → REQUEST_TREE (mode)
←──────────────────────────────────────────
start DomObserver + extract
→ TREE_UPDATED ───────── channel ─────────▶ deserialize tree (array → Map)
   { tree, mode, extractedAt }              → render <TreePanel/> in a shadow root
canvas reload → PREVIEW_READY ────────────▶ Panel still open → REQUEST_TREE (mode)
←──────────────────────────────────────────
Panel hidden → STOP_TREE
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
// From Storybook 9 on, the channel APIs live on the `storybook` package:
// `storybook/manager-api` in the UI shell, `storybook/preview-api` in the iframe.
import { addons } from "storybook/manager-api";

// Preview → manager:
//   EVENTS.TREE_UPDATED    — a fresh extraction (on every debounced DOM change that
//                            altered the tree, while the panel is open)
//   EVENTS.PREVIEW_READY   — preview iframe (re)booted; manager re-sends REQUEST_TREE if still open
// Manager → preview:
//   EVENTS.REQUEST_TREE    — start observing, in the mode it carries, and send the current tree
//                            (panel shown); a no-op while already observing in that mode
//   EVENTS.STOP_TREE       — tear down the observer (panel hidden or unmounted)
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

`TREE_UPDATED` is de-duplicated: the preview compares each extraction against the
last one it published (`mode` included, `extractedAt` excluded) and stays quiet
when they are byte-identical. So it fires on **changes to the extracted tree**,
not on every mutation — do not use it as a DOM-mutation heartbeat, and do not
expect a fresh `extractedAt` while a story is animating without semantic effect.
The first publish after the panel opens and after a story renders is always
sent, as is one whose `mode` differs from the last published — re-selecting the
mode the panel is already in changes nothing and stays quiet like any other
no-op.

It is not a general mutation filter, though. `class` is a key attribute and
lands in `dom.attributes`, so a class toggle always publishes; and node ids are
minted per DOM element, so a re-render that **replaces** elements publishes even
when the resulting markup is identical. Only a framework that patches nodes in
place de-duplicates.

---

## Troubleshooting

**Panel shows "Waiting for story to render…"**

This means the preview hasn't emitted a `TREE_UPDATED` event yet. Check:
- If `.storybook/preview.ts` calls `definePreview`, it names the addon in `addons` — see [CSF Next](#csf-next-definepreview). This is the cause when the panel waits on every story.
- The story is in `story` view mode (not `docs`)
- `#storybook-root` exists in the iframe DOM
- No errors in the Storybook preview console

**Panel content is out of date after a story change**

The addon listens to `storyRendered` and `storyChanged` events **while the panel is open**. If your framework delays rendering past the `storyRendered` event, the first snapshot may capture an empty state. A second extraction fires automatically on the next DOM mutation, so the panel catches up within 200ms. With the panel closed, the preview stays idle — open the Semantic Navigator tab to resume.

---

## See it running

- **Storybook 10 + Vite + React** — [`examples/storybook/`](/examples/storybook): Button / Form / Dialog / Navigation stories showing how the panel reacts to Controls changes.
- **Storybook + React 19** — the [Storybook + React 19 recipe](/recipes/storybook-react-19) covers the `viteFinal` JSX override some React 19 projects need.

---

## Panel features

Inside every story's panel is the same tree as the Chrome extension, with its search, role filters and [keyboard](/guide/chrome-extension#keyboard). Selecting or hovering a row outlines its element in the story canvas, without scrolling it, and activating a row runs its action in the story. Unlike the inspector's `highlightOnHover` and `scrollHostOnSelect`, none of this is configurable. **Show full names**, under ⚙ at the end of the toolbar, holds across stories until Storybook reloads. The addon has no Focus sync, scope breadcrumb or live region log.

→ [Using the panel](/guide/chrome-extension#using-the-panel)
