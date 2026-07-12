# Example: Vanilla / Vite

A minimal Vite + TypeScript application demonstrating `@real-a11y-dev/inspector` as a floating dev-tools overlay.

**Source:** [`examples/vanilla/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/vanilla)

## What it shows

- Mounting the panel into a floating container via Shadow DOM
- Switching between A11y and DOM modes at runtime
- Using `setRoot()` to narrow the observed subtree to just a dialog
- Calling `refresh()` after a programmatic DOM update
- `highlightOnHover` — hover a tree node to highlight the corresponding DOM element

## Run it locally

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y-dev
pnpm install
pnpm --filter @real-a11y-dev/example-vanilla dev
```

Opens at `http://localhost:5173` (Vite's default port).

## Key code

```ts
// examples/vanilla/src/main.ts
import { createInspector } from "@real-a11y-dev/inspector";

// Create a floating panel in the bottom-right corner
const panel = document.createElement("div");
Object.assign(panel.style, {
  position: "fixed",
  bottom: "0",
  right: "0",
  width: "380px",
  height: "50vh",
  zIndex: "9999",
  background: "white",
  border: "1px solid #ccc",
  borderRadius: "8px 0 0 0",
  overflow: "hidden",
});
document.body.appendChild(panel);

const sn = createInspector({
  root: document.getElementById("app")!,
  container: panel,
  viewMode: "a11y",
  highlightOnHover: true,
});

sn.mount();

// Switch mode button
let currentMode: "a11y" | "dom" = "a11y";
document.getElementById("btn-mode")!.addEventListener("click", () => {
  const next = currentMode === "a11y" ? "dom" : "a11y";
  sn.setViewMode(next);
  currentMode = next;
});

// Narrow to dialog button
document.getElementById("btn-dialog")!.addEventListener("click", () => {
  const dialog = document.querySelector("[role='dialog']");
  if (dialog) sn.setRoot(dialog);
});
```
