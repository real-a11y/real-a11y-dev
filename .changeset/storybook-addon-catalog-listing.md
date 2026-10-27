---
"@real-a11y-dev/storybook-addon": patch
---

List the addon properly in the Storybook integration catalog. The catalog builds its card from `package.json`, which carried none of its metadata, so the card showed the scoped package name and the default Storybook icon, under no category and with no "Works with" frameworks. The manifest now has a `storybook` block — display name **Semantic Navigator** (the panel's own tab name), the Real A11y icon, and `react-native` as the one unsupported framework, since the preview reads the rendered DOM and works with any web renderer — and its keywords lead with `storybook-addon` and the `test` category, as the catalog requires. The npm description now says what the panel shows: the accessibility tree, heading outline and tab order of every story.
