---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Remove the unused `.sn-native-consent-error` rule, and its dark-mode variant, from the shared tree stylesheet both packages bundle (`@real-a11y-dev/semantic-navigator-ui`'s `tree.css`). It styled the failure line of the opt-in step the Chrome extension had for native mode before native mode was on by default; the note about Chrome's debugging bar that replaced that step has no failure line, so nothing renders the class any more. No visible change for either package; recorded because the stylesheet ships inside both bundles, which are now slightly smaller.
