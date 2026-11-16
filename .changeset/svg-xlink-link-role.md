---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report an SVG `<a>` that carries only `xlink:href` as a `link`. SVG-AAM maps an `a` with a valid `href` or `xlink:href` to `link`, and Chromium does. The DOM producer checked only `href`, so such an element was `generic`, though its own focus logic already counted it as a tab stop:

```html
<svg>
  <a xlink:href="/"><text>y</text></a>
</svg>
<!-- before: generic "y"   after: link "y" -->
```

An `<a>` with neither attribute is still `generic`, and an HTML `<a href>` is unchanged. What this changes for you:

- **Queries:** `findByRole("link")` now matches such an element in a DOM-produced tree, and the element offers `click` and `navigate`.
- **Tab order:** `cli tabs` and the MCP tab-order tool, which use the DOM producer, list the stop as `link "y"` instead of `generic "y"`.
- **Snapshots:** an a11y snapshot produced by the DOM producer for a page with such a link changes from `generic` to `link`, so a saved one needs re-recording. `cli` and `mcp` read Chromium's tree for everything else and already showed `link`.
