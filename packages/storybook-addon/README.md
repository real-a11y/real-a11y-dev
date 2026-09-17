# @real-a11y-dev/storybook-addon

A Storybook panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live while the panel is open (extraction stays idle when another addon tab is active).

Requires **Storybook 9 or 10**. Storybook 9 folded `@storybook/manager-api` and
`@storybook/preview-api` into the `storybook` package, so 8.x is not supported.

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

That's it. A **Semantic Navigator** tab appears alongside Controls and A11y for every story.

## Docs

Panel walkthrough, story parameters, channel events, and the [Storybook + React 19 recipe](https://real-a11y.dev/recipes/storybook-react-19) at **[real-a11y.dev/packages/storybook-addon](https://real-a11y.dev/packages/storybook-addon)**.

## License

MIT
