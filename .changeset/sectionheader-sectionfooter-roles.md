---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Map a `<header>` / `<footer>` inside `main` or sectioning content (`article`, `aside`, `nav`, `section`) to the ARIA 1.3 `sectionheader` / `sectionfooter` roles, per HTML-AAM, instead of `generic`. Body-scoped ones are still `banner` / `contentinfo`.

HTML-AAM lets user agents leave these roles unexposed when the element has no accessible name, isn't focusable and carries no other global ARIA attribute. Both producers now apply that rule the same way. These roles take their name from author attributes only (`aria-label`, `aria-labelledby`, `title`), as they do in Chromium, so a header is no longer named from its loose text (a byline such as `By Ada · <time>…</time>`).

- **DOM producer** (`testing` matchers, `inspector`, `react`, `storybook-addon`): the a11y view still flattens a bare one, so **most a11y-view snapshots are unchanged**. A named, focusable or ARIA-annotated header/footer now appears as `sectionheader "…"` / `sectionfooter "…"` instead of `generic "…"`. The DOM view and DOM-mode serialization now show every such element as `sectionheader` / `sectionfooter`, where a bare one was previously hidden as `generic`.
- **Native producer** (`cli`, `mcp`): Chromium exposes these roles even when bare. The normalizer now drops a bare one and re-parents its children, as the DOM producer does. Native trees and baselines lose a `sectionheader` / `sectionfooter` level on most real pages. `NATIVE_AX_VOCABULARY_VERSION` goes to 3.
