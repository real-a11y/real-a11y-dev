---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep what surrounds a `<form>` whose control is named `tagName`. A form lets a control shadow the form's own members, so in

```html
<table>
  <tr>
    <td>
      Ready
      <form><input name="tagName" aria-label="Tag name" /></form>
    </td>
  </tr>
</table>
```

`form.tagName` is the input, and `form.tagName.toLowerCase()` throws. The DOM walk skips such a form, with what is inside it, as before. But the walk also read the form's tag while working out _other_ elements, and the throw was charged to them:

- **Hosts that hold such a form:** a heading, link, button or table cell whose name comes from its content walked into the form and was dropped with everything in it, so the table above lost its `Ready` cell. A field's `aria-describedby` text that held such a form was dropped the same way, along with any link beside it. These now keep their nodes and names.
- **An extraction rooted inside such a form** dropped everything focusable in it, because whether it is disabled is read up its ancestors, and every `<header>` and `<footer>`, whose landmark role is read the same way. They are now kept.
- **Findings:** a finding's locator reads the tag of every sibling it counts on its way up, so a finding with such a form beside it, or beside one of its ancestors, threw and took the whole audit with it. In `testing`'s Playwright adapter, which audits in the page by default, the call failed with a `TypeError` instead of reporting the findings.
- **Live panels:** in `inspector`, `react` and `storybook-addon`, a change inside such a form, or to the form itself, now updates the tree in place. It used to make the refresh throw and fall back to a full extraction of the page, with a console warning outside production.

What this changes for you:

- **Snapshots and tree diffs:** a tree from such a page gains the hosts above. A committed baseline from one changes, so re-record it.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` walk the page themselves, so on such a page they now list the stops those hosts hold, and a `--root` inside such a form lists its controls. Native trees are unaffected.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.
