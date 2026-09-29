---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Leave the body of a closed `<details>` out of the tree built from the page. Chromium renders a closed disclosure as its summary alone: the body sits in a slot the browser hides, so its accessibility tree omits it and Tab never reaches a control in it. The in-page walk read every child anyway, so it listed controls nobody can reach. On this page:

```html
<main>
  <details>
    <summary>S</summary>
    <a href="/x">Hidden link</a>
    <button>Hidden button</button>
  </details>
  <a href="/y">Visible</a>
</main>
```

`real-a11y tabs` printed

```
01. link "Hidden link"
02. button "Hidden button"
03. link "Visible"
```

and now prints only `01. link "Visible"`, which is where Chromium's Tab goes after the summary.

What the walk now reads, all checked against Chromium 151's tree and Tab order:

- **Closed:** a `<details>` without `open` has only its summary: the first `<summary>` child, even after other content. A second summary, the loose text, and a `<details>` nested in the body, summary and all, are left out. The `<details>`' role does not matter, `role="none"` included.
- **Shadow DOM:** content slotted into a shadow `<details>` is body, since the summary has to be a real child. A light `<summary>` slotted in is not its summary, and a slot inside the shadow `<details>`' own `<summary>` still renders.
- **Descriptions:** an `aria-describedby` from inside a closed body reaches nobody, so the paragraph it points at stays in the tree as ordinary content instead of vanishing with it.
- **Live trees:** the body appears when `open` is set, by a click on the summary or by find-in-page, and goes when it is removed.

Where it shows:

- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree, which already left the body out.
- **Snapshots, queries and assertions:** `treeSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, the `findByRole` queries, the matchers and the audit assertions no longer see a closed body. A heading, button or link in one drops out of them, so re-record those baselines, and open the `<details>` first in a test that reaches for its content.
- **Panels:** the tree and the Tab Sequence view in `inspector`, `react` and `storybook-addon` follow the same rule.
- **Text previews:** a closed `<details>`' `dom.textContent` and `dom.descendantText` hold only what its summary renders.
