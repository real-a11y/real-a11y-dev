---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop naming an `article`, `group`, `feed`, `note`, `tabpanel`, `doc-toc`, `graphics-document` or `graphics-symbol` after the text inside it. WAI-ARIA 1.2, DPUB-ARIA 1.1 and Graphics-ARIA 1.0 let only the author name these roles (`aria-label`, `aria-labelledby`), and Chromium leaves them unnamed. The native producer gave a text-only one its text as a name, and the DOM producer did the same for `doc-toc` and `graphics-document`:

```html
<article>a</article>
<!-- was: article "a"   now: article -->
<nav role="doc-toc">x</nav>
<!-- was: doc-toc "x"   now: doc-toc -->
```

What this changes for you:

- **Native producer** (`cli`, `mcp`, `testing`'s `producer: "native"`, and the extension's side panel): the text hung directly on such an element is no longer printed. `<address>` is a `group` in Chromium, so it is covered too. `NATIVE_AX_VOCABULARY_VERSION` goes to 10.
- **DOM producer** (`inspector`, `react`, `storybook-addon`, `testing`): `doc-toc`, `graphics-document` and `graphics-symbol` are unnamed. `article`, `group`, `note` and `tabpanel` already were.
- **Snapshots and queries:** a saved native snapshot that holds `article "…"` or `group "…"` needs re-recording, and a query by role and name for one no longer matches. A name given by the author is unchanged.
- **Unchanged:** `alert`, `status`, `listitem`, `code`, and roles named from content such as `comment` and `doc-noteref`.
