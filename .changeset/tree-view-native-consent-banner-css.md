---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Add `.sn-native-consent-banner`, `.sn-native-consent-actions` and `.sn-native-consent-error` classes (with dark-mode variants) to the shared tree stylesheet (`@real-a11y-dev/semantic-navigator-ui`'s `tree.css`), for the note the extension's side panel shows about Chrome's debugging bar the first time native mode reads a page. The `-error` class is styled but no longer rendered. Every consumer of that package bundles `tree.css` as a side effect regardless of which classes it actually renders, so this ships as a changeset even though the note itself is only ever rendered by the extension's side panel — not by anything `inspector` or `storybook-addon` render. A toolbar button marked `aria-disabled="true"` now looks and hovers like a disabled one. No visible change for either package, which mark none that way; recorded because real bytes ship into both bundles.
