---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Give the `form` landmark the same naming condition `region` already had, and make that condition mean a name that can actually resolve.

A `<form>` came out of the in-page walk as the `form` landmark whether or not it had an accessible name. WAI-ARIA in HTML makes it a landmark only when it is named — the condition the walk already applied to `<section>` → `region`. Chromium agrees so firmly that it does not expose an unnamed form at all, so the DOM producer was reporting a landmark the native producer never does, and a landmark list carried an entry assistive technology never announces.

The shared gate behind both roles asked only whether a naming attribute was _present_. `aria-label="   "` states nothing, and an `aria-labelledby` whose every IDREF resolves to no element names nothing, yet both made a landmark with an empty name. Naming attributes are trimmed now, and `aria-labelledby` has to resolve to at least one element. A reference that resolves still counts even if the element it points at renders no text: that much is the accessible-name computation, which runs after role resolution.

**Breaking change.** Trees built by the in-page walk change shape for this markup, so a committed baseline or an assertion that names those roles can go red:

- **Snapshots:** the row for an unnamed `<form>` goes, as does the `region` row for a `<section>` whose only naming attribute is blank or dangling. In a default a11y snapshot it disappears entirely — an unnamed generic is flattened, which is what Chromium's own tree does with that form too — so its children move up one level. With `includeGeneric: true`, or in the DOM view, it reads `generic` and carries the element's own loose text, as any generic does: `<form>Search: <input></form>` snapshots as `generic "Search:"`. Re-record those baselines (`--update-snapshots`, or your snapshot runner's equivalent). A named form's row does not move.
- **Queries and assertions:** `findByRole` / `listByRole(root, "form")` and the `landmark` group no longer return an unnamed `<form>`, nor one whose only naming attribute is blank or points at a missing id. Migration: give the form the name it needs to be a landmark — `<form aria-label="Search">` — which is what AT needs to announce it anyway.
- **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view built by the in-page walk. A `<form>` is focusable only when it carries `tabindex`, and such a form prints as `generic "<its text>"` instead of `form` unless it is named. Every other view reads Chromium's own tree, which already withheld the unnamed form.
- **Panels:** the tree in `inspector`, `react` and `storybook-addon` follows the same rule.

**One wrinkle worth knowing.** The role now follows the name, and resolving `aria-labelledby` needs the referenced id to be findable — so a `<form>`/`<section>` named _only_ by `aria-labelledby`, sitting in a container that is not in the document, resolves to `generic` rather than `form`/`region`. Its accessible name is empty in that state too, for the same reason, so role and name agree; what changed is that the role now says so. Rendering into `document.body`, as Testing Library does by default, is unaffected.
