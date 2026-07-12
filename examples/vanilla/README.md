# Vanilla / Vite example — `@real-a11y-dev/inspector`

Framework-free demo of the `@real-a11y-dev/inspector` embed. Renders a small sample page and mounts the A11y tree panel next to it inside a shadow root, so the panel's styles never collide with the host page.

## What this shows

- How to call `createInspector()` with a `root` and a `container`
- Shadow-DOM isolation (the default `mount: "shadow"`)
- Switching `viewMode` between `"dom"` and `"a11y"` at runtime
- Opt-in host-page side effects — `highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate` are off by default

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/example-vanilla dev
```

Open the URL Vite prints (typically `http://localhost:5173`). Edit `src/main.ts` to experiment with different config.

## Key file

- [`src/main.ts`](./src/main.ts) — the entire wiring plus a small floating-panel shell (resize, drag-to-move, collapse/expand).

## See also

- [`@real-a11y-dev/inspector` package docs](../../packages/inspector)
- [`@real-a11y-dev/core` query helpers](../../packages/core) for headless tree inspection
