---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read lists, list items, cells, grid cells, column and row headers and visible tooltips into the name of the button, link or heading that holds them, and name a grid row from its cells. The DOM producer stopped at every one of those roles, so `<button><ul><li>One</li><li>Two</li></ul></button>` was `button ""` where Chromium says `"One Two"`, and `no-unlabeled-interactive` reported it as unlabeled. A row is named from its content only in a `grid` or `treegrid`, as in Chromium, so an orphan `role="row"` or a row in a `role="table"` that held direct text no longer takes it as a name:

```html
<button>
  <ul>
    <li>One</li>
    <li>Two</li>
  </ul>
</button>
<!-- before: button ""      after: button "One Two" -->
<button>Save<span role="tooltip">Saves the file</span></button>
<!-- before: button "Save"  after: button "SaveSaves the file" -->
<table role="grid">
  <tr>
    <th>H</th>
    <td>C</td>
  </tr>
</table>
<!-- before: row ""         after: row "H C" -->
```

Saved a11y snapshots and diffs of such markup change and need re-recording. Item widgets nested in item widgets, and tables, stay barriers. `cli` and `mcp` change only in the tab order (`real-a11y tabs`, `get_tab_order`), the one output they build with the DOM producer; everything else they print reads Chromium's own tree, which already had these names.
