---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Add a `.sn-native-capability-banner` class (with a dark-mode variant) to the shared tree stylesheet (`@real-a11y-dev/semantic-navigator-ui`'s `tree.css`), replacing an inline-styled banner that ignored the theme. Every consumer of that package bundles `tree.css` as a side effect regardless of which classes it actually renders, so this ships as a changeset even though the banner itself is only ever rendered by the extension's dev-only native-tree view — not by anything `inspector` or `storybook-addon` render today. No visible change for either package; recorded because real bytes ship into both bundles.
