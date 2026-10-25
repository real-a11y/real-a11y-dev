---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Ship the tree stylesheet minified. Both packages inline the shared stylesheet (`@real-a11y-dev/semantic-navigator-ui`'s `themes.css` and `tree.css`) as a string and inject it into the panel's shadow root, and nothing minified that string, so every CSS comment and all of its indentation shipped to users. The build now strips whitespace and comments and nothing else, so every rule and value is exactly as written. Each bundle shrinks by about 3.3 kB gzipped (11.6 kB raw). The inlined copy also drops the `@import "./themes.css"` it carried, which browsers ignored because it came after other rules. No visible change.
