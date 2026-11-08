---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Keep the element an `aria-describedby` points at in the DOM-produced tree. The DOM producer used to drop a visible, text-only description target (a hint paragraph, a heading, a list, a tooltip) on the grounds that its text already shows as the referrer's description. WAI-ARIA 1.2 §7.2 requires an accessible object for a non-hidden element whose id another element references, and Chromium and the native producer keep it, so the DOM tree now has a `paragraph`, `heading` or `list` where it had none. The referrer's description is unchanged, and a hidden target is still left out of the tree while it keeps feeding the description.

The panel, `getOutline` (so the `heading-order` audit now sees a referenced heading), matchers and `toMatchA11ySnapshot` baselines gain these nodes, so saved DOM-produced snapshots of pages with description targets will churn: regenerate them. Native-produced trees (`cli`, `mcp`) are unchanged.
