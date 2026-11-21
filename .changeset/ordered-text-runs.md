---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/testing": minor
---

A paragraph that mixes text with links now keeps its reading order. The tree used to fold the paragraph's own text into its name and list the links after it, so `<p>You accept our <a href="/terms">terms</a> and have read our <a href="/privacy">privacy policy</a>.</p>` printed `paragraph "You accept our and have read our ."`: no sentence, and no way to tell where a link sits. Each run of text is now a `text` row between the children, in the order a browser's accessibility tree has them:

```
paragraph
  text "You accept our"
  link "terms"
  text "and have read our"
  link "privacy policy"
  text "."
```

This applies to the prose roles whose text is their content (`paragraph`, `listitem`, `blockquote`, `term`, `definition`, `caption`, `code`, `strong`, `emphasis`, `mark`, `deletion`, `insertion`, `subscript`, `superscript`, `time`), in both producers: the in-page tree (`treeSnapshot`, the matchers, the inspector, React and Storybook panels) and Chromium's tree (`real-a11y tree`, `inspect`, `snapshot`, the MCP tree tools, the Playwright adapter's `tree: "native"`).

`text` is not an ARIA role. A row has no element of its own, takes no action, and holds no children. Each run is trimmed, and a run of only white space prints no row. A role-less inline wrapper (`<b>`, `<span>`) stays part of the run around it.

## Breaking change

Snapshots of an element that mixes its own text with a link, a `<code>`, a `<strong>` or another child with a role need re-recording: the element loses its name and gains `text` rows. A test that read such an element's `a11y.name` now finds `""`, and its text on the `text` children.

What does not change: an element with only text (`paragraph "Sent"`, `<p>Pure <b>bold</b> text.</p>`), one its author named with `aria-label`, `aria-labelledby` or `title`, and every role named from its content (a heading, link, button or cell keeps its whole content as its name).
