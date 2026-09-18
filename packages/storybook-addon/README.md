# @real-a11y-dev/storybook-addon

A Storybook panel that shows the semantic tree, heading outline, and tab sequence for every story — updated live while the panel is open (extraction stays idle when another addon tab is active).

Requires **Storybook 9, 10 or 11**. Storybook 9 folded `@storybook/manager-api`
and `@storybook/preview-api` into the `storybook` package, so 8.x is not
supported. Storybook 11 is still prerelease, which is why the peer range is
`^11.0.0-0` — a plain `^11.0.0` would not match `11.0.0-alpha.0`. Support for 11
is verified by type-checking and building against it, and is provisional while
it is in alpha.

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
