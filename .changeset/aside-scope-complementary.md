---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop reporting an unnamed `<aside>` inside sectioning content as a `complementary` landmark. The DOM producer mapped every `<aside>` to `complementary`; HTML-AAM maps one inside `article`, `aside`, `nav` or `section` to `complementary` only when it has an accessible name, and to `generic` otherwise, as Chromium's own tree does:

```html
<article><aside>x</aside></article>
<!-- generic -->
<section><aside aria-label="Related">x</aside></section>
<!-- complementary "Related" -->
<main><aside>x</aside></main>
<!-- complementary -->
```

An `<aside>` directly under `<body>` or `<main>` is unchanged, and so is an explicit `role="complementary"`. What this changes for you:

- **Known difference from Chromium:** `<aside title="">` in sectioning content is `generic` here, as the spec says, but Chromium 153 still reports `complementary`. An `aria-labelledby` that points at an element with no text still counts as a name here.
- **Queries:** `findByRole("complementary")` no longer matches an unnamed nested `<aside>`.
- **Panels:** the Landmarks filter in `inspector`, `react` and `storybook-addon` no longer lists it.
- **Snapshots:** an a11y snapshot or diff produced by the DOM producer drops the `complementary` line for such an `<aside>`, so a saved one needs re-recording. `cli` and `mcp` ship the engine too, but they read Chromium's tree and already behaved this way: only their `tabs` output uses the DOM producer, and it does not list landmarks.
