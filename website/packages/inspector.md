---
title: "@real-a11y-dev/inspector — framework-agnostic a11y panel"
description: Drop-in accessibility tree panel for any web app. Shadow-DOM isolated, mounts into any container, supports inline and floating modes.
---

# @real-a11y-dev/inspector

> **TL;DR** — A drop-in, framework-agnostic tree-inspector panel. Call `createInspector({ root, container })` and you get an interactive A11y / DOM / TAB view rendered into any DOM node, CSS-isolated via Shadow DOM. Reach for this in **vanilla / non-React projects**, or when you want the panel without framework coupling.

Framework-agnostic interactive accessibility tree panel. Mounts into any container element, isolated via Shadow DOM by default.

## Install

```sh
npm install -D @real-a11y-dev/inspector
```

**Peer dependencies:** none (Preact is bundled).

::: tip Install as a dev dependency
`@real-a11y-dev/inspector` is a developer audit panel (~40 KB gzipped, Preact + tree view). Keep it in `devDependencies` and load it via a dynamic `import()` behind a build flag so it never ships to end users.

See [Keep it out of production](/guide/getting-started#keep-it-out-of-production) for the Vite / webpack / vanilla gating patterns.
:::

---

## Quick start

```ts
import { createInspector } from "@real-a11y-dev/inspector";

const inspector = createInspector({
  root: document.getElementById("app")!,
  container: document.getElementById("inspector-panel")!,
});

inspector.mount();
```

The panel renders inside a `ShadowRoot` attached to `#inspector-panel`. Your app's CSS cannot leak in; the panel's CSS cannot leak out. Toggle mode, switch view, or unmount programmatically at any time.

---

## `createInspector(config)`

Returns an `InspectorInstance`.

### Config

| Option | Type | Default | Description |
|---|---|---|---|
| `root` | `Element` | — | **Required.** The DOM subtree to observe and render. |
| `container` | `Element` | — | **Required.** The element that will host the panel. |
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Initial tree mode. |
| `mount` | `"shadow" \| "light"` | `"shadow"` | `"shadow"` isolates styles via ShadowRoot. `"light"` renders directly into `container` (useful if you need to restyle). |
| `highlightOnHover` | `boolean` | `false` | Highlight the corresponding DOM element when hovering a tree node. |
| `scrollHostOnSelect` | `boolean` | `false` | Scroll the host DOM element into view when selecting a tree node. |
| `focusHostOnActivate` | `boolean` | `false` | Move focus to the host DOM element when activating a tree node action. |
| `styleNonce` | `string` | — | CSP nonce applied to injected `<style>` elements. |

::: tip Shadow DOM is the right default
With `mount: "shadow"`, the panel's styles live inside the ShadowRoot and cannot conflict with your app. Your app's CSS cannot accidentally override the panel's layout. Keep this default unless you have a specific reason to opt out.
:::

::: tip Why `highlightOnHover` / `scrollHostOnSelect` / `focusHostOnActivate` default to false
The inspector renders into the same document as your app, so activating a tree row could steal focus from the panel or scroll the page underneath you. The panel itself stays fully interactive either way — selection, chip navigation, keyboard movement — what's gated is the side effect on the *real* DOM element. See [Panel interaction vs. host side effects](/guide/panel-features#panel-interaction-vs-host-side-effects) for the full rationale and when to flip them on.
:::

---

## Instance API

```ts
interface InspectorInstance {
  mount(): void;
  unmount(): void;
  destroy(): void;           // alias for unmount()
  setViewMode(mode: "a11y" | "dom" | "tab"): void;
  setRoot(root: Element): void;
  refresh(): void;
  getTree(): ExtractionResult;
}
```

### `mount()`

Attaches the panel to `container` and starts observing `root` for DOM mutations.

### `unmount()` / `destroy()`

Removes the panel from `container`, stops the observer, and cleans up all event listeners. Safe to call multiple times.

### `setViewMode(mode)`

Switches between `"a11y"`, `"dom"`, and `"tab"` modes without remounting.

### `setRoot(root)`

Swaps the observed root element. The observer is restarted on the new root; the panel re-renders immediately.

```ts
// Narrow the panel to just the open modal
inspector.setRoot(document.querySelector("[role='dialog']")!);
```

### `refresh()`

Forces an immediate re-extraction without waiting for the next DOM mutation. Useful in tests or after programmatic DOM changes.

### `getTree()`

Returns the most recently extracted tree as an `ExtractionResult`.

```ts
const tree = inspector.getTree();
const submit = findByRole(tree, "button", { name: /submit/i });
```

---

## Shadow DOM explained

When `mount: "shadow"` (the default), the inspector:

1. Calls `container.attachShadow({ mode: "open" })`.
2. Injects a `<style>` element with the bundled panel CSS inside the shadow root.
3. Renders the tree panel into an inner `<div>` inside the shadow root.

Your application's CSS does not pierce the shadow boundary. The panel's CSS does not leak out. If you set `styleNonce`, the same nonce is applied to the injected style element for CSP compliance.

### Opting out

```ts
createInspector({
  root, container,
  mount: "light",  // renders directly into container, no shadow root
});
```

With `mount: "light"`, a `<style id="sn-styles">` element is injected into `document.head` instead.

---

## Interaction flags

All host-side effects are opt-in:

```ts
createInspector({
  root, container,
  highlightOnHover: true,      // draw a highlight ring on the host element
  scrollHostOnSelect: true,    // scrollIntoView when a tree node is selected
  focusHostOnActivate: true,   // focus the host element when its action fires
});
```

These are off by default so that using the panel during testing never disturbs the host app's own focus or scroll state.

---

## Example: dev-tools overlay

```ts
// Floating overlay in the bottom-right corner of the screen.
const panel = document.createElement("div");
panel.style.cssText = `
  position: fixed; bottom: 0; right: 0;
  width: 380px; height: 50vh;
  z-index: 9999; border: 1px solid #ccc;
  background: white; overflow: hidden;
`;
document.body.appendChild(panel);

const inspector = createInspector({
  root: document.body,
  container: panel,
  highlightOnHover: true,
});
inspector.mount();
```

---

## See it running

- **Vanilla / Vite** — [`examples/vanilla/`](/examples/vanilla): mode switcher, `setRoot()` to narrow the audit to an open dialog, `refresh()` after programmatic DOM changes.

---

## Panel features

Once the inspector is mounted, all the same in-panel behaviors as the Chrome extension and Storybook addon are available — search, role filters, focus tracking, scoping, live region monitoring, keyboard navigation. They're shared across every Real A11y surface.

→ [Panel features reference](/guide/panel-features)
