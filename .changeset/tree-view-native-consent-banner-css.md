---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Add `.sn-native-consent-banner`, `.sn-native-consent-actions` and `.sn-native-consent-error` classes (with dark-mode variants) to the shared tree stylesheet (`@real-a11y-dev/semantic-navigator-ui`'s `tree.css`), for the extension's new native-mode consent step (now that native mode ships in the production build behind a runtime setting rather than a dev-only build) — including its inline failure state, shown when enabling the setting doesn't actually take (the service worker unreachable, or an internal handler error). Every consumer of that package bundles `tree.css` as a side effect regardless of which classes it actually renders, so this ships as a changeset even though the banner itself is only ever rendered by the extension's side panel — not by anything `inspector` or `storybook-addon` render today. No visible change for either package; recorded because real bytes ship into both bundles.
