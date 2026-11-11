---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop reporting an authored `role="region"` or `role="form"` with no accessible name as a landmark. The DOM producer kept the role on any element, so `region ""` and `form ""` appeared in trees where assistive technology exposes nothing; Core-AAM says an unnamed region or form is not exposed as a landmark and the element keeps its host-language role. The producer now skips the unnamed token and tries the next one, as Chromium's own tree does:

```html
<div role="region">x</div>
<!-- generic -->
<div role="region group">x</div>
<!-- group -->
<div role="form navigation">x</div>
<!-- navigation -->
<nav role="form">x</nav>
<!-- navigation -->
<div role="form" aria-label="Search">x</div>
<!-- form "Search" -->
```

A name from `aria-label`, a resolving `aria-labelledby` or `title` keeps the landmark. What this changes for you:

- **Queries:** `findByRole("region")` and `findByRole("form")` no longer match an unnamed element.
- **Panels:** the Landmarks filter in `inspector`, `react` and `storybook-addon` no longer lists it.
- **Snapshots:** an a11y snapshot or diff produced by the DOM producer changes for such an element (a `region` or `form` line becomes `generic`, `group` or `navigation`), so a saved one needs re-recording. `cli` and `mcp` ship the engine too, but they read Chromium's tree and already behaved this way: only their `tabs` output uses the DOM producer, and it does not list landmarks.
- **Required context:** an unnamed `role="region group"` parent now counts as the `group` it is, so a `role="listitem"` child inside it keeps its role.
