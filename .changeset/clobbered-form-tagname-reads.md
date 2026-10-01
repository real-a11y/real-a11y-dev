---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep the live tree updating, and keep what surrounds a `<form>`, when one of the form's controls is named `tagName`. A form lets a control shadow the form's own members, so in

```html
<form>
  <input name="tagName" aria-label="Tag name" />
  <span>Saved</span>
</form>
```

`form.tagName` is the input, and `form.tagName.toLowerCase()` throws. The DOM walk skips such a form, with what is inside it, as it did before. But other reads landed on the form while the code was working on a _different_ element, and the throw was charged to that element:

- **Panels dropped updates.** In `inspector`, `react` and `storybook-addon`, a change inside such a form, or to the form itself, threw out of the live refresh, which climbs every ancestor of a change to find whose name and value it affects. The panel lost that whole batch of changes, those elsewhere on the page included, and went on showing the tree from before it. The refresh now goes through and gives the tree a fresh extraction would.
- **Hosts that hold such a form were dropped.** A heading, link, button or table cell whose name comes from its content walked into the form and threw, so it was skipped with everything in it: `<td>Ready <form>…</form></td>` cost the table that cell. A field's `aria-describedby` text that held such a form was dropped the same way, along with a link beside it.
- **An extraction rooted inside such a form** lost everything focusable in it, because whether it is disabled is read up its ancestors, and every `<header>` and `<footer>`, whose landmark role is read the same way.
- **Findings:** a finding's locator reads the tag of every sibling it counts on its way up, so a finding with such a form beside it, or beside one of its ancestors, threw and took the whole audit with it. In `testing`'s Playwright adapter, which audits in the page by default, that failed the assertion with a `TypeError` instead of reporting the findings.

What this changes for you:

- **Snapshots and tree diffs:** a tree from such a page gains the hosts above. A committed baseline from one changes, so re-record it.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the stops those hosts hold, and `--root` inside such a form lists its controls. Native trees are unaffected.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.
