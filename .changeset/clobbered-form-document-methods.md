---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep building the tree on a page that names an image or a form control after a DOM method. A `<form>` lets a control shadow any of the form's own members, methods included, and the document does the same for a named `<img>`, `<form>`, `<embed>` or `<object>`. On this page

```html
<main>
  <img name="getElementById" alt="" />
  <span id="lbl">Save draft</span>
  <button aria-labelledby="lbl"><svg aria-hidden="true"></svg></button>
</main>
```

`document.getElementById` is the image, so calling it throws. The walk resolves every `aria-labelledby` and `aria-describedby` that way, so it dropped the button, and every other labelled or described element on the page, along with everything inside it. `treeSnapshot()` printed a bare `main`, and now prints `button "Save draft"`.

What else broke, and now works:

- **`<label for>`:** an `<img name="querySelector">` dropped every form control with an `id` the same way.
- **Whole extractions:** an `<img name="querySelectorAll">`, or an `<img name="contains">` while a modal `<dialog>` is open, made every extraction on the page throw. So did a `<form role="search">` holding a control named `getAttribute` (or after another method the overlay scan calls), when it sits outside a root narrower than `<body>`: a `rootSelector`, or a Storybook story's root.
- **Live panels:** in `inspector`, `react` and `storybook-addon`, adding, removing or changing a form with a control named `getAttribute`, `tagName`, `contains`, `matches`, `querySelectorAll` or `ownerDocument`, or changing anything inside it, made the refresh throw, so the panel kept showing the old tree. With `getAttribute`, the mutation observer also lost the whole batch the change arrived in, unrelated changes elsewhere on the page included. Such a refresh now falls back to a full extraction, which gives the tree a fresh extraction would. Outside production it logs a console warning when it does, as a skipped element already does.
- **Portals:** a form mounted straight into `<body>`, outside the root being watched, whose control is named `matches` or `getAttribute`, hid any dialog or menu inside it from the observer. It now triggers a full re-extraction.
- **Form roots:** extracting a `<form>` whose control is named `querySelectorAll`, or a detached one whose control is named `ownerDocument`, now gives its tree instead of throwing or coming back empty.

What this changes for you:

- **Pages without such names** are unaffected.
- **jsdom** doesn't implement this shadowing, so suites on jsdom never hit it. A real browser does, including through the Playwright adapter.
- **A form that shadows what the walk reads on every element** (`getAttribute`, `tagName`) is still left out of the tree with its contents, as before. It just no longer takes anything else with it.
- **Snapshots and tree diffs:** a tree that lost labelled controls, or came back empty, now has them, so re-record a baseline taken from such a page.
- **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` walk the page themselves, so only they change, and only on such a page.
