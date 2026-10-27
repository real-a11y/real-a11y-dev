# @real-a11y-dev/storybook-addon

A Storybook panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live while the panel is open (extraction stays idle when another addon tab is active).

Requires **Storybook 9, 10 or 11**. Storybook 9 folded `@storybook/manager-api`
and `@storybook/preview-api` into the `storybook` package, so 8.x is not
supported. Storybook 11 has only published prereleases so far, which is why the
peer range is `^11.0.0-0` — a plain `^11.0.0` would not match `11.0.0-alpha.8`.
Support for 11 is provisional until it ships stable.

```sh
npm install -D @real-a11y-dev/storybook-addon
```

## Setup

```ts
// .storybook/main.ts
export default {
  addons: ["@real-a11y-dev/storybook-addon"],
};
```

That's it for a classic `.storybook/preview.ts`. A **Semantic Navigator** tab appears alongside Controls and A11y for every story.

### CSF Next (`definePreview`)

If your `.storybook/preview.ts` calls `definePreview` — CSF Next, which
Storybook 11 makes the default — Storybook composes only the addons it names,
so name this one there too. Keep it in `main.ts` as well: that is what adds the panel.

```ts
// .storybook/preview.ts
import { realA11y } from "@real-a11y-dev/storybook-addon";
import { definePreview } from "@storybook/react-vite";

export default definePreview({
  addons: [realA11y()],
});
```

Without it the panel stays on "Waiting for story to render…".

## Docs

Panel walkthrough, story parameters, channel events, and the [Storybook + React 19 recipe](https://real-a11y.dev/recipes/storybook-react-19) at **[real-a11y.dev/packages/storybook-addon](https://real-a11y.dev/packages/storybook-addon)**.

## License

MIT
