---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/testing": minor
---

New audit rule `unique-interactive-names`: a `warning` for two controls of one role that share an accessible name, such as a list of cards that each end in an "Accept" button. A screen-reader user who hears only the name, in the Tab order or in a list of the page's buttons, can't tell them apart. No specification requires unique names, so the message calls it best practice (WCAG 2.4.6, 2.4.9).

- Buttons, links, checkboxes and switches are compared across the whole page. Radios, options, tabs, menu items and tree items are compared only within their own container, so the same "Yes" under two questions passes. Text fields aren't compared.
- States and descriptions don't count: an expanded and a collapsed "Options" are two "Options", and a different `aria-describedby` doesn't make two names unique. Links with the same name and the same `href` pass, and so do a path and an absolute URL with that path; `href="#"` and `javascript:` links don't count as one destination.
- In a native tree, each frame is compared on its own, and so is each player or field that draws controls of its own (every `<video controls>` has a "play", every date input a "Show date picker").
- Each control gets a finding with its locator and, as context, its landmark (`in <region "Requests">`) and a link's `href` without its query or fragment, where a token would be, and the count stays out of the message, so adding a row doesn't change the findings already in a saved snapshot.

`@real-a11y-dev/testing` adds `assertUniqueInteractiveNames(root)`, the matcher `toHaveUniqueInteractiveNames()` and `sn.assertUniqueInteractiveNames()` on the Playwright handle, for both trees. All three throw on a finding, as `assertLandmarkStructure` does on its warnings.

**The rule is in `ALL_RULES`, so it runs by default.** What changes for existing callers:

- `collectFindings(root)` returns the new warnings, and `assertRules(root, ALL_RULES)` throws on them. A test that expects no findings at all can fail. Give each control a name of its own, filter the findings by `severity`, or pass a rule list without `unique-interactive-names`.
- `real-a11y audit` lists the warnings but exits 0 under the default `--fail-on error`; only `--fail-on warning` gates on them. `real-a11y snapshot` lists them, and `real-a11y diff` against a baseline from before this release reports them as new warnings, which gate only under `--fail-on warning`.
- The MCP `audit_page`, `inspect_page` and `checkpoint_findings` tools return them, and accept `unique-interactive-names` in `rules`.
- `A11yRule` gains a member, so a `switch` or `Record` that covers every rule must add one.
