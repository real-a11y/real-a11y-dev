---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Visually hidden content that screen readers still read (the "sr-only" pattern) now counts: it appears in snapshots, outlines, queries and audits, as it does in Chromium's own tree.

The DOM extractor flags sr-only elements `dom.isHidden` because they aren't visible, while keeping them exposed to assistive technology. Every query built on the tree walk skipped anything flagged `isHidden`, so content a screen reader announces was silently dropped. For example, GitHub's visually hidden `h2 Navigation Menu` was missing from the DOM heading outline but present in the native one. Now only content that is hidden from sight **and** from AT is skipped.

What changes on a page with sr-only content:

- **Tree and outline snapshots** (`toMatchA11ySnapshot`, `treeSnapshot`, `outlineSnapshot`, the extension's export) include the sr-only nodes. **Expect snapshot changes.**
- **`findByRole` / `findAllByRole`** return sr-only matches by default, the way Testing Library's `getByRole` does.
- **Audit rules** see them too. The heading-order rule no longer reports "Missing <h1>" on a page whose only `h1` is visually hidden.

Unchanged: `visibility: hidden` and `aria-hidden` content is still left out, and `includeHidden: true` still brings it back. Native form controls, links and anything with a `tabindex` were never flagged sr-only, so the tab sequence is effectively unaffected.

In a DOM-less runtime (no computed styles), an inline `visibility: hidden` now counts as hidden from AT too, matching how it already counted as not visible. Without that, such an element would have looked like sr-only content and been kept.
