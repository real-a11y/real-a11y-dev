# Storybook example — `@real-a11y-dev/storybook-addon`

A minimal Storybook 8 project with the Real A11y addon enabled. Every story gets a per-story panel showing the semantic tree, heading outline, and tab sequence for its canvas.

## What this shows

- Wiring `@real-a11y-dev/storybook-addon` into `.storybook/main.ts` and `.storybook/preview.ts`
- A set of sample stories (`Button`, `Form`, `Dialog`, and more) so you can see what the panel looks like for well-structured vs. deliberately-broken markup
- Live per-story views — semantic tree, heading outline, and tab sequence — with an A11y/DOM toggle, driven off the story's real canvas

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/example-storybook storybook
```

Storybook opens on `http://localhost:6006`. Open the **Real A11y** tab in the addon panel (next to Controls / Accessibility).

Build a static bundle:

```bash
pnpm --filter @real-a11y-dev/example-storybook build-storybook
```

## Key files

- [`src/stories/`](./src/stories) — sample stories
- [`src/Button.tsx`](./src/Button.tsx), [`src/Form.tsx`](./src/Form.tsx) — components under test

## See also

- [`@real-a11y-dev/storybook-addon` package docs](../../packages/storybook-addon)
- Storybook 8 [addon authoring guide](https://storybook.js.org/docs/addons/introduction)
