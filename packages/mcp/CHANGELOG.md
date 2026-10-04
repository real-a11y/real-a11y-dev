# @real-a11y-dev/mcp

## 0.1.0-beta.8

### Minor Changes

- d3bcc06: Give the `form` landmark the same naming condition `region` already had, and make that condition mean a name that can actually resolve.

  A `<form>` came out of the in-page walk as the `form` landmark whether or not it had an accessible name. WAI-ARIA in HTML makes it a landmark only when it is named — the condition the walk already applied to `<section>` → `region`. Chromium agrees so firmly that it does not expose an unnamed form at all, so the DOM producer was reporting a landmark the native producer never does, and a landmark list carried an entry assistive technology never announces.

  The shared gate behind both roles asked only whether a naming attribute was _present_. `aria-label="   "` states nothing, and an `aria-labelledby` whose every IDREF resolves to no element names nothing, yet both made a landmark with an empty name. Naming attributes are trimmed now, and `aria-labelledby` has to resolve to at least one element. A reference that resolves still counts even if the element it points at renders no text: that much is the accessible-name computation, which runs after role resolution.

  **Breaking change.** Trees built by the in-page walk change shape for this markup, so a committed baseline or an assertion that names those roles can go red:

  - **Snapshots:** the row for an unnamed `<form>` goes, as does the `region` row for a `<section>` whose only naming attribute is blank or dangling. In a default a11y snapshot it disappears entirely — an unnamed generic is flattened, which is what Chromium's own tree does with that form too — so its children move up one level. With `includeGeneric: true`, or in the DOM view, it reads `generic` and carries the element's own loose text, as any generic does: `<form>Search: <input></form>` snapshots as `generic "Search:"`. Re-record those baselines (`--update-snapshots`, or your snapshot runner's equivalent). A named form's row does not move.
  - **Queries and assertions:** `findByRole` / `listByRole(root, "form")` and the `landmark` group no longer return an unnamed `<form>`, nor one whose only naming attribute is blank or points at a missing id. Migration: give the form the name it needs to be a landmark — `<form aria-label="Search">` — which is what AT needs to announce it anyway.
  - **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view built by the in-page walk. A `<form>` is focusable only when it carries `tabindex`, and such a form prints as `generic "<its text>"` instead of `form` unless it is named. Every other view reads Chromium's own tree, which already withheld the unnamed form.
  - **Panels:** the tree in `inspector`, `react` and `storybook-addon` follows the same rule.

  **One wrinkle worth knowing.** The role now follows the name, and resolving `aria-labelledby` needs the referenced id to be findable — so a `<form>`/`<section>` named _only_ by `aria-labelledby`, sitting in a container that is not in the document, resolves to `generic` rather than `form`/`region`. Its accessible name is empty in that state too, for the same reason, so role and name agree; what changed is that the role now says so. Rendering into `document.body`, as Testing Library does by default, is unaffected.

### Patch Changes

- 7e425fb: Read every ARIA state value the way Chromium does. The DOM producer copied `aria-disabled`, `aria-checked` and the other states literally: `"true"` became `true`, `"false"` became `false`, and anything else stayed a string. So `aria-disabled="TRUE"` reported `a11y.states.disabled: "TRUE"`, and `aria-disabled=""` reported `""`, where Chromium reports disabled, and not set:

  ```html
  <div role="group" aria-disabled="TRUE">…</div>
  <button aria-pressed="MIXED">Bold</button>
  <a href="/" aria-current="PAGE">Home</a>
  <span aria-hidden="yes">★</span>
  ```

  Each rule matches Chromium 151's own tree, value by value. None of them trims whitespace, so `" true"` is not `"true"`:

  - **`disabled`, `hidden`, `busy`, `required`, `readonly`, `expanded`, `selected`:** `false` in any case is `false`. An empty value or `undefined` in any case leaves the state unset. Anything else is `true`, including `TRUE`, `yes`, `0`, `mixed` and `" false"`.
  - **`checked`, `pressed`:** as above, except that `mixed` in any case is `"mixed"`, and only a lowercase `undefined` leaves the state unset (`UNDEFINED` is `true`). A `radio`, `switch` or `menuitemradio` has no mixed state, so its `aria-checked="mixed"` is `false`.
  - **`current`:** `page`, `step`, `location`, `date` and `time` in any case come out lowercase. `false` in any case is `false`, an empty value or a lowercase `undefined` leaves it unset, and anything else is `true`.
  - **`<optgroup>`** is never marked disabled, even with `aria-disabled="true"`, as in Chromium. Its options still inherit the state from it.
  - **`aria-hidden`** hides for every value that reads as `true` above, not only for `"true"`. `<span aria-hidden="yes">` now leaves the tree, and its text leaves the accessible name of whatever contains it, as `aria-hidden="true"` always did.

  What this changes for you:

  - **Queries:** `findByRole` / `findAllByRole` with `{ checked: true }`, `{ disabled: true }` and the other state options now match `aria-checked="TRUE"`, `aria-disabled="yes"` and the like. A node inside `aria-hidden="TRUE"` is now left out, as one inside `aria-hidden="true"` already was.
  - **Tree diffs:** `a11yDiff` prints these states as booleans, and `aria-current` in lowercase. A committed diff snapshot that shows one of them as a string, such as `a11y.states.disabled "TRUE"`, needs re-recording. Changing only the case of a value, such as `aria-expanded="true"` to `"TRUE"`, no longer prints a change.
  - **Panels:** the tree's state badges in `inspector`, `react` and `storybook-addon` show `disabled` for `aria-disabled="TRUE"`, where they showed `disabled=TRUE`, and `current=page` for `aria-current="PAGE"`.
  - **Snapshots:** an a11y snapshot prints roles and names, not states, so it changes only on a page that uses a value like `aria-hidden="TRUE"`, whose content now leaves the snapshot and the names that included it. A `<header>` or `<footer>` inside a `<section>` that is kept only for an `aria-busy=""` also drops out now, as it does from the native tree.
  - **`cli` / `mcp`:** the tab order from `real-a11y tabs` and `get_tab_order` now leaves out a control inside `aria-hidden="TRUE"` or `aria-hidden="yes"`, as it already did inside `aria-hidden="true"`. Nothing else they print changes, because their other output reads Chromium's own tree.

- 0b723a9: Keep building the tree on a page that names an image or a form control after a DOM method. A `<form>` lets a control shadow any of the form's own members, methods included, and the document does the same for a named `<img>`, `<form>`, `<embed>` or `<object>`. On this page

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
  - **Live panels:** in `inspector`, `react` and `storybook-addon`, adding, removing or changing a form with a control named `getAttribute`, `tagName`, `contains`, `matches`, `querySelectorAll` or `ownerDocument`, or changing anything inside it, made the refresh throw, so the panel kept showing the old tree. With `getAttribute`, the mutation observer also lost the whole batch the change arrived in, unrelated changes elsewhere on the page included. Such a refresh now falls back to a full extraction, which gives the tree a fresh extraction would. Outside production it logs a console warning the first time it does, as a skipped element already does.
  - **Portals:** a form mounted straight into `<body>`, outside the root being watched, whose control is named `matches` or `getAttribute`, hid any dialog or menu inside it from the observer. It now triggers a full re-extraction.
  - **Form roots:** extracting a `<form>` whose control is named `querySelectorAll`, or a detached one whose control is named `ownerDocument`, now gives its tree instead of throwing or coming back empty.

  What this changes for you:

  - **Pages without such names** are unaffected.
  - **jsdom** doesn't implement this shadowing, so suites on jsdom never hit it. A real browser does, including through the Playwright adapter.
  - **A form that shadows what the walk reads on every element** (`getAttribute`, `tagName`) is still left out of the tree with its contents, as before. It just no longer takes anything else with it.
  - **Snapshots and tree diffs:** a tree that lost labelled controls, or came back empty, now has them, so re-record a baseline taken from such a page.
  - **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` walk the page themselves, so only they change, and only on such a page.

- 191f363: Keep a `<form>` in the tree when one of its controls is named `hasAttribute`. A form lets a control shadow the form's own members, methods included, so in

  ```html
  <form aria-label="Signup">
    <input name="hasAttribute" aria-label="Nickname" />
    <button>Join</button>
  </form>
  ```

  `form.hasAttribute` is the input, and calling it throws. The DOM walk asks every element whether it carries a few attributes (the inspector panel's marker, `inert`, `onclick`, `tabindex`), so the throw dropped the form from the tree along with everything inside it. It now extracts as `form "Signup"` holding `textbox "Nickname"` and `button "Join"`.

  The other questions asked of any element, whatever its tag, now survive such a form too:

  - **Overlays outside the root:** a menu or dialog inside a form whose control is named `hasAttribute`, or a `<form role="dialog">` whose control is named `contains`, never widened the tree to take it in, so a component's or story's tree left it out while it was open.
  - **Live panels:** in `inspector`, `react` and `storybook-addon`, a change in or around a form whose control is named `contains` or `matches` fell back to a full extraction, with a console warning outside production. It now updates in place. A plain form with a control named `matches`, mounted straight into `<body>`, no longer triggers a full re-extraction, since it can now be asked whether it is an overlay.
  - **A form as the root:** watching a `<form>` whose control is named `contains`, through `react`'s `useSemanticTree` or `testing`'s `waitForMutations`, threw as the observer started.

  What this changes for you:

  - **Pages without such names** are unaffected.
  - **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls.
  - **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.

- 84392f0: Keep a `<form>` in the tree when one of its controls is named `nodeType`. A form lets a control shadow the form's own members, so in

  ```html
  <main>
    <form aria-label="Pay">
      <input type="hidden" name="nodeType" />
      <label>Card <input /></label>
      <button>Pay</button>
    </form>
  </main>
  ```

  `form.nodeType` is the hidden input, not `1`. The DOM walk keeps an element's children by testing that number, so it took the form for something other than an element and dropped it with everything inside it: `treeSnapshot()` printed a bare `main`, and `tabSequenceSnapshot()` printed `(nothing focusable)`. The tree now has `form "Pay"` with `textbox "Card"` and `button "Pay"` in it, and the tab sequence lists both controls.

  Other walks dropped such a form the same way, and now read through it:

  - **Names and text:** a heading, link, button or cell named from its content left out the text inside such a form, so `<h2>Checkout <form>…<span>now</span></form></h2>` was `heading "Checkout"` and is now `heading "Checkout now"`. So did a wrapping `<label>`'s text, the text preview of an element with no name, and the value of a contenteditable editor holding one.
  - **Live panels:** in `inspector`, `react` and `storybook-addon`, adding or removing such a form left any element named or described through `aria-labelledby` or `aria-describedby` from inside it with its old name or description.
  - **Portals:** a form mounted straight into `<body>`, outside the root being watched, was never checked for a dialog or menu, so opening one left the tree as it was. It now triggers a full re-extraction.

  What this changes for you:

  - **Pages without such a name** are unaffected.
  - **A form that also shadows `getAttribute`**, which the walk calls on every element, is still left out of the tree with its contents, and out of the names around it, as before. One that also shadows `tagName` is still left out of the tree, but its text now counts toward the names around it.
  - **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls. Native trees are unaffected.
  - **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.

- 58fcb39: Walk up past a `<form>` with a control named `nodeType`. A form lets a control shadow the form's own properties, so on

  ```html
  <main>
    <form>
      <input type="hidden" name="nodeType" />
      <fieldset>
        <header>Order summary</header>
        <button>Pay</button>
      </fieldset>
    </form>
  </main>
  ```

  `form.nodeType` is the hidden input rather than `1`. The walks up the page read each parent clobber-safely, then checked that it was an element with a plain `nodeType` read, which took the form for no element at all: a walk from anywhere inside the form stopped below it. Nothing threw; the answers were wrong.

  - **A tree rooted inside such a form**, such as a matcher on the `<fieldset>` above or a panel whose root is inside the form, read as if nothing were above its root, and so did its refreshes. The `<header>` came out a `banner` landmark although `<main>` scopes it, `aria-disabled` on an ancestor of the form no longer disabled the controls in it, and in a `contenteditable` form a link counted as a tab stop.
  - **Element picker:** hovering or clicking inside such a form highlighted and picked nothing, rather than the nearest node above it.
  - **Audit locators:** an in-page audit finding inside such a form had its locator cut short at the form's child, such as `fieldset > button`, which can match elsewhere on the page.

  What this changes for you:

  - **Trees, picks and locators inside such a form** now take the form and what is above it into account, so a finding's locator there can get longer. A page with no form control named `nodeType` is unaffected.
  - **jsdom** doesn't shadow a form's properties, so a suite running on it never hit this, and its output doesn't change.
  - **`cli` / `mcp`:** their trees are Chromium's own and don't change. Tab order is the one in-page walk they run, and it can: with `tabs --root`, or `get_tab_order`'s `rootSelector`, inside a `contenteditable` form holding such a control, a link in it is no longer listed as a tab stop.

- cda9aef: Stop freezing the page when something changes inside a `<form>` with a control named `parentElement`. A form lets a control shadow the form's own properties, so on

  ```html
  <form>
    <input type="hidden" name="parentElement" />
    <p>Total: <span>$10</span></p>
  </form>
  ```

  `form.parentElement` is the hidden input, and the input's parent is the form again. Extracting such a page already works, but the walks that run after it went round that pair forever, freezing the tab with nothing thrown. Each now reads the form's real parent:

  - **Live panels:** a refresh after a change inside such a form froze the `inspector`, `react` and `storybook-addon` panels, walking up from the change for the name, the description and the field value it moved.
  - **Mutation observer:** the panels' observer, and `testing`'s `waitForMutations`, froze on a text change inside a form with a control named `parentNode` — and on a text change anywhere on a page with an `<img>`, `<form>`, `<embed>` or `<object>` named `parentNode`, which the document lets shadow its own properties the same way.
  - **Element picker:** with pick mode on, hovering inside such a form froze the page when the form itself was not in the tree.
  - **Portal visibility:** in browsers without `checkVisibility()`, the check that a portal overlay is visible walked up the same way.

  What this changes for you:

  - **Pages that froze** now refresh, observe and pick. A page with no such form, and nothing named `parentNode`, is unaffected.
  - **jsdom** doesn't shadow a form's or the document's properties, so a suite running on it never froze, and its output doesn't change. These pages froze in a real browser.
  - **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but none of their commands runs the walks above.

- 63e9628: Keep what surrounds a `<form>` whose control is named `tagName`. A form lets a control shadow the form's own members, so in

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

  - **Hosts that hold such a form:** a heading, link, button or table cell whose name comes from its content walked into the form and was dropped with everything in it, so the table above lost its `Ready` cell. A field's `aria-describedby` text that held such a form was dropped the same way, along with any link beside it. These now keep their nodes and names. Help text whose only control sits inside such a form folds into the field's description, as any help text with nothing reachable in it does, since that control never makes the tree.
  - **An extraction rooted inside such a form** dropped everything focusable in it, because whether it is disabled is read up its ancestors, and every `<header>` and `<footer>`, whose landmark role is read the same way. They are now kept.
  - **Findings:** a finding's locator reads the tag of every sibling it counts on its way up, so a finding with such a form beside it, or beside one of its ancestors, threw and took the whole audit with it. In `testing`'s Playwright adapter, which audits in the page by default, the call failed with a `TypeError` instead of reporting the findings.
  - **Live panels:** in `inspector`, `react` and `storybook-addon`, a change inside such a form, or to the form itself, now updates the tree in place. It used to make the refresh throw and fall back to a full extraction of the page, with a console warning outside production.

  What this changes for you:

  - **Snapshots and tree diffs:** a tree from such a page gains the hosts above. A committed baseline from one changes, so re-record it.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` walk the page themselves, so on such a page they now list the stops those hosts hold, and a `--root` inside such a form lists its controls. Native trees are unaffected.
  - **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.

- 5016dd2: Keep a `<form>` in the tree when one of its controls is named `getRootNode`. A form lets a control shadow the form's own members, methods included, so in

  ```html
  <h2 id="pay-title">Payment</h2>
  <form aria-labelledby="pay-title">
    <input type="hidden" name="getRootNode" />
    <button>Pay</button>
  </form>
  ```

  `form.getRootNode` is the hidden input, and calling it throws. The DOM walk calls it to find the tree an ID reference resolves in, so the throw dropped the form from the tree along with everything inside it:

  - **Named by `aria-labelledby`:** the form above and its `Pay` button were missing. They now extract as `form "Payment"` and `button "Pay"`.
  - **A description target:** a form that another field's `aria-describedby` points at was dropped the same way, even when it held a control. It is now kept, like any other target that holds a control.

  A finding's locator walks up from the element it names, too. It read a control named `parentElement` as the form's parent, and ran round the form and that control until its depth cap, giving a selector like `form > input > form > input > form > button` that matches nothing. It now follows the form's real ancestors, so for an unlabeled button in `<div id="app"><section><form>` it reads `#app > section > form > button`. A control named `children` also cost the path its `nth-of-type`, which it now keeps.

  What this changes for you:

  - **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
  - **Findings:** a locator inside such a form now matches the element.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls.
  - **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.

- ffc1ec0: Make an `<input>` whose `list` names a `<datalist>` a `combobox`. Typing in one offers the datalist's suggestions in a popup, and HTML-AAM and Chromium both make it a combobox. The DOM producer ignored `list`, so it reported a `textbox` (or a `searchbox` or `spinbutton`) where Chromium's own tree reports a `combobox`:

  | Markup                                                | Was          | Now        |
  | ----------------------------------------------------- | ------------ | ---------- |
  | `<input list="fruits">` with `<datalist id="fruits">` | `textbox`    | `combobox` |
  | `<input type="search" list="fruits">`                 | `searchbox`  | `combobox` |
  | `<input type="number" list="fruits">`                 | `spinbutton` | `combobox` |

  The text, search, email, tel and url types become a combobox, and so do number, date, datetime-local, month, week and time, as in Chromium. A password, range or color input keeps its role. The `list` has to name a `<datalist>` in the input's own document or shadow root. A missing id, another element, or a datalist across a shadow boundary leaves the role unchanged. An empty or hidden datalist still counts. Each case matches the role in Chromium 151's and 153's own accessibility trees.

  - **Queries:** `findByRole("textbox")` / `findAllByRole` no longer find such an input. Query it as `combobox`. Its actions are unchanged: `.type(value)` still writes into it, and a number input still steps.
  - **Snapshots and contracts:** a DOM-mode snapshot, tab sequence or `toMatchA11yContract` contract naming such an input changes from `textbox "Fruit"` to `combobox "Fruit"`. Re-record those baselines.
  - **`toBeValidA11yTree`:** a combobox requires `aria-expanded` and `aria-controls`, but the browser runs a datalist's popup and tells the page nothing about it. So neither attribute is required on such an input, even under a redundant `role="combobox"`. An `<input role="combobox">` without a datalist is still reported for both.
  - **Live trees:** panels in `inspector`, `react` and `storybook-addon` re-read an input's role when its `list` changes, or when the datalist it names is added or removed.
  - **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view the in-page walk builds. Such an input now prints as `combobox` there, as the native `tree` already did.

- e502e40: Resolve `role` the way Chromium does. The DOM producer took the first token of `role` whatever it said, so it kept roles Chromium's accessibility tree throws away. Each rule below was measured over CDP in Chromium 151 and 153, which agree:

  - **An unknown or abstract token is skipped** for the next token, and with none left the element keeps its own role. `role="foo"` and `role="widget"` on a `<div>` are a `generic`, `<button role="foo">` is a `button`, and `role="foo button"` is a `button` named by its content. Tokens are read ASCII-case-insensitively — `role="BUTTON"` is a button — and the deprecated `directory` is a `list`.
  - **`listitem`, `option` and `treeitem` need their container.** Outside `<ul>`/`<ol>`/`<menu>` or `role="list"`, `<select>` or `role="listbox"`, `role="tree"` — or a `role="group"` — the role is dropped for the next token or the element's own: a lone `<div role="listitem">` is a `generic`, `<details role="treeitem">` a `group`, `<li role="option">` in a list a `listitem`. Role-less `div`/`span`/custom-element wrappers and presentational elements may sit in between, and an `aria-owns` owner counts; anything else, such as a `<section>`, breaks the context. No other role is dropped for its context.
  - **An `<li>` whose list carries a role other than `list` is presentational**, so `<ul role="none">` strips its items as well as itself.

  Everything that follows the role follows too: an element's name from content, whether it folds out of the a11y view, the actions offered on it (a `role="foo button"` clicks; an option the browser discarded doesn't), a heading's `aria-level` (`role="HEADING" aria-level="4"` is in the outline at 4), and whether its text reaches an ancestor's name — `<button><span role="option">Apple</span> pie</button>` is now "Apple pie", as Chromium names it.

  - **Snapshots:** a DOM-mode snapshot changes wherever one of these appears. `foo "x"` becomes the element's own role (for a `<div>`, the same `generic` a role-less one gives), an item outside its container loses its role, and the items of a `<ul role="none">` drop out. Re-record those baselines.
  - **`toBeValidA11yTree`** still reports the role that was written, even once the element has folded out of the view: `"foo" is not a valid ARIA role`. A role the browser drops for its missing container is now an error — `role "listitem" is discarded outside its required context (directory / list)` — where it was at most an advisory warning, so markup like a lone `role="listitem"` or an `option` with a `<section>` between it and its listbox now fails. Put the item in its container, or remove the role. An uppercase role Chromium accepts (`role="BUTTON"`) is no longer reported as invalid. The matcher also checks the nodes the a11y view folds away, so a bad role inside a `<label>`, `<legend>` or `<summary>`, whose text only names its owner, is reported now too. The audits (`collectFindings` and the `assert*` helpers) judge the corrected roles too.
  - **`cli` / `mcp`:** only the tab sequence (`real-a11y tabs`, the `get_tab_order` tool) changes, as the one view built by the in-page walk. Native trees already reported Chromium's roles and are untouched.

- abb9f8c: Give a `<select>` the role of the widget it renders as. The DOM producer made every `<select>` a `combobox` unless it had `multiple`, but a select's role depends on how many rows it shows. Chromium reports a `listbox` when more than one row shows, and a `combobox` (a drop-down) when one row does:

  | Markup                       | Was        | Now        |
  | ---------------------------- | ---------- | ---------- |
  | `<select size="3">`          | `combobox` | `listbox`  |
  | `<select multiple size="1">` | `listbox`  | `combobox` |

  The row count is the `size` attribute when it parses to a positive integer, as HTML parses one: `" 3"`, `"+3"`, `"3.5"` and `"2abc"` all count, while `"0"`, `"-1"` and `"abc"` do not. Without a usable `size`, a `multiple` select shows 4 rows and any other select shows 1. HTML-AAM maps every `multiple` select to `listbox`, but HTML allows a `multiple` select with one row to render as a drop-down, and Chromium does. Each case matches the role in Chromium 151's and 153's own accessibility trees.

  - **Queries:** `findByRole("combobox")` / `findAllByRole` no longer find a `<select size="3">`. Query it as `listbox`. A `<select multiple size="1">` is now found as `combobox`. The select's actions are unchanged: `.select(value)` works on it under either role.
  - **Snapshots and contracts:** a DOM-mode snapshot, tab sequence or `toMatchA11yContract` contract naming such a select changes from `combobox "Plan"` to `listbox "Plan"`, or the reverse for `multiple size="1"`. Re-record those baselines.
  - **`toBeValidA11yTree`:** an authored role counts as redundant only when it matches the select's role, and `size` now decides that role. `role="listbox"` on `<select size="3">` is redundant. `role="combobox"` on that select, or on a `multiple` select with no `size`, is authored, so its options are reported as `option` nested inside `combobox`. The matcher used to count both as redundant, because `multiple` was never recorded on the node.
  - **`dom.attributes`:** now records `size` and `multiple`. Panels in `inspector`, `react` and `storybook-addon` also re-read the tree when either one changes, so the role updates live.
  - **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view the in-page walk builds. A focusable `<select size="3">` now prints as `listbox` there, as the native `tree` already did.

- 78d054e: Read an editor's `a11y.value` the way Chromium does. The DOM producer left `aria-hidden` text and any popup out of every non-native field's value. Chromium does that only for a combobox you can't type into. It reads an editor's value, and any ARIA textbox's or searchbox's, as the text the field renders, which knows nothing of ARIA:

  ```html
  <div contenteditable="true" role="textbox" aria-label="Message">
    Hello <span aria-hidden="true">[x]</span>world
  </div>
  ```

  The DOM producer read `"Hello world"`, and Chromium's own tree, which the native producer reads, says `"Hello [x]world"`. Both now say `"Hello [x]world"`.

  The same rule covers a role-less or `plaintext-only` editor, an editable combobox or searchbox, a `role="textbox"` or `role="searchbox"` that isn't editable, and a popup inside any of them: `Apple` followed by a `role="listbox"` holding `Pear` reads `"Apple Pear"`. Each case matches the `value` in Chromium 151's tree over CDP. A combobox you can't type into still reads `"Apple"` in both cases, as before.

  What stays out is unchanged: `display:none` and `hidden` text, `visibility:hidden` text, a closed `<details>`'s body, and the text of a nested `<select>`, `<textarea>` or `<datalist>`. So a sensitive control inside an editor still adds nothing to the editor's value, even inside `aria-hidden`, and it still reads `"[redacted]"` itself.

  - **Snapshots and diffs with values on:** `treeSnapshot(root, { values: true })` and `a11yDiff(…, { values: true })` print the longer value for these fields. Re-record a committed snapshot that holds one. Snapshots without values don't change.
  - **Panels:** a checkpoint diff in the `inspector`, `react` or `storybook-addon` panel now marks such a field as changed when `aria-hidden` text or a popup inside it comes or goes.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` read the tab order from this page walk, so an editor's tab stop now prints the value that `real-a11y tree` and `get_semantic_tree` already print for it: `textbox "Message" = "Hello [x]world"`. Under `--redact-input` / `REAL_A11Y_REDACT_INPUT=1` they still print no values. Nothing else they print changes, because their other output reads Chromium's own tree.

- 5d498f5: Report `expanded` only on a role Chromium gives the state. The DOM producer copied `aria-expanded` onto an element whatever its role, so each of these reported `a11y.states.expanded: true`, where Chromium's tree, which `cli` and `mcp` read, has no expanded state at all:

  ```html
  <button role="radio" aria-checked="false" aria-expanded="true">Small</button>
  <button role="heading" aria-expanded="true">Shipping</button>
  <div role="listbox" tabindex="0" aria-label="Sizes" aria-expanded="true">
    …
  </div>
  <input type="text" aria-label="Search" aria-expanded="true" />
  ```

  The rule, as measured against Chromium 151 and 153, which agree on every case:

  - **Roles with the state:** `application`, `button`, `checkbox`, `columnheader`, `combobox`, `gridcell`, `link`, `listitem`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `row`, `rowheader`, `switch`, `tab` and `treeitem` read `aria-expanded` as before.
  - **Every other role ignores it**, including `listbox`, `option`, `radio`, `heading`, `textbox`, `searchbox`, `dialog`, `menu`, `tree`, `grid`, `cell` and `generic`. An element with no `role` goes by its own: a `<div>`, a `<span>`, an `<a>` without `href`, a text `<input>` or `<textarea>`, and a table's `<td>` have none. Neither does a `<td>` in a `role="grid"` table, which Chromium calls a gridcell; only an authored `role="gridcell"` has the state.
  - **`<details>`:** it no longer has an expanded state of its own. The DOM producer set one from `open`, which Chromium never does: the summary carries the state. A `<details>` with one of the roles above, such as `role="button"`, reads `aria-expanded`, and `open` doesn't change it.
  - **`<select>` under an author role:** reads `aria-expanded` only in one of the roles above, so `role="tab"` does and `role="menu"` doesn't.

  What this changes for you:

  - **Queries:** `findByRole` / `findAllByRole` with `{ expanded: true }` or `{ expanded: false }` no longer match an element whose role has no expanded state, such as a `listbox` with `aria-expanded`, or a `<details>`. Query what carries it: the `combobox` that opens the list box, or the details' `<summary>`.
  - **Tree diffs:** `a11yDiff` no longer prints `a11y.states.expanded` changes on those elements. Toggling a `<details>` prints a change on its summary only.
  - **Panels:** the `expanded` badge in `inspector`, `react` and `storybook-addon` no longer shows on those elements.
  - **`toBeValidA11yTree`:** unaffected. Of the roles ARIA gives `aria-expanded`, only `combobox` requires it, and a combobox keeps the state.
  - **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
  - **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.

- 5496d93: Fix image map areas going missing from the tab sequence and the DOM tree. Since Chromium 153, which Playwright 1.63 installs, Chromium's UA stylesheet gives every `<area>` `display: none`, as jsdom's always has. The in-page walk skips anything `display: none`, so it dropped every area, although Chromium still tabs to one. On this page:

  ```html
  <button>Before</button>
  <img src="map.png" alt="Site map" usemap="#nav" />
  <map name="nav"><area href="/home" alt="Home" coords="0,0,10,10" /></map>
  <button>After</button>
  ```

  `real-a11y tabs` printed, on Chromium 153:

  ```
  01. button "Before"
  02. button "After"
  ```

  and now prints the stops Chromium tabs through, as it did on 151:

  ```
  01. button "Before"
  02. link "Home"
  03. button "After"
  ```

  An area now follows its image, the way Chromium decides it. Each rule was checked against Chromium 151 and 153 with a Tab walk, scripted `focus()` and Chromium's accessibility tree:

  - **Rendered:** an area is in the tree while the first image whose `usemap` names its map is rendered: not `display: none` or `hidden`, itself or through an ancestor, and not `visibility: hidden` or `inert`. The area's own `display`, `hidden` and `visibility` don't count. An image inside a shadow root gives a map's areas nothing.
  - **Order:** an area is a stop at its own place in the document, not at its image's.
  - **Hidden map:** an area in a hidden or `inert` `<map>` stays out. Chromium tabs to one, but its accessibility tree leaves it out, and the walk follows the tree.
  - **Accessibility:** an area whose image is `aria-hidden`, or which is `inert` itself, is hidden from AT, as Chromium's accessibility tree has it. Like an `aria-hidden` button, it then stays out of the a11y view and every tab list read from it, although Chromium tabs to it; the DOM view keeps it focusable. An area adds nothing to the name of the element its map sits in.
  - **`tabindex`:** it makes an area focusable without an `href`, but only while an image uses its map, and a negative one leaves the area unfocusable even from script.

  Where it shows:

  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree, which kept the areas.
  - **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` list the areas again on Chromium 153, and for the first time in jsdom, whose stylesheet always hid them. Any area whose image isn't rendered stays out, on every version. A DOM-mode a11y snapshot gains a `link` per area. Re-record those baselines.
  - **Panels:** the Tab Sequence view and the tree in `inspector`, `react` and `storybook-addon` show each area where its `<map>` sits, and drop or restore a map's areas when its image is hidden or shown.

- c8ff10a: Separate a name-from-content child that has a box of its own with a space, instead of gluing it to the text beside it.

  The DOM extractor appended each element child's contribution with no separator at all, so a label split across two blocks came out as one word: `<button><div>Save</div><div>now</div></button>` was named `"Savenow"`, and `<h1><p>One</p><p>Two</p></h1>` `"OneTwo"`. Chromium — and the screen reader reading it — announce "Save now" and "One Two". accname-1.2 §4.3.2 step 2F appends each descendant's result "with a space".

  The rule is the one Chromium applies: **a child that has a box of its own separates the text either side of it, whether or not it lends the name any text.** Spacing therefore follows the child's computed `display`, and every case below matches what Chromium 141 computes for the same markup:

  - **Spaced:** blocks, list items, table parts, and the atomic inline-level boxes (`inline-block`, `inline-flex`, `inline-table`), which Chromium separates even though they sit on the line. Flex and grid items, floats and absolutely positioned children come along with them, because CSS blockifies their computed `display`. A `<br>` now separates the text either side of it (`<a>Read<br>more</a>` is `"Read more"`, not `"Readmore"`), and so does an empty block (`<button>Save<div></div>now</button>`).
  - **Spaced even though they lend no text:** a child that name-from-content skips but that still renders — a form control or other name-barrier element (`<h1>Save<input>now</h1>` is `"Save now"`), and a rendered `aria-hidden="true"` child.
  - **Not spaced, so unchanged:** the inline boxes text really does flow into — `display: inline` (including a `<div>` an author styled that way), `inline list-item`, and the `ruby` family. `<button><span>Sa</span><span>ve</span></button>` is still `"Save"`, not `"Sa ve"`. A child with no box at all — `display: none`, `[hidden]` — separates nothing, and `display: contents` generates no box, so its children decide their own spacing.

  The existing whitespace normalization collapses the padding, so no name gains a leading, trailing or doubled space.

  **Expect snapshot changes in both directions.** A name whose label is split across children with boxes of their own _gains_ the spaces assistive technology announces. A name with an inline nested widget _loses_ a space it should never have had: `<h2>Signed in as<a href="/u">Ada</a></h2>` was `"Signed in as Ada"` and is now `"Signed in asAda"`, which is what Chromium reads for markup with no space in it. The same goes for an inline name-barrier child. This PR's own website baselines show both: 164 lines gain a space, 13 lose one (`cell "Tree ( treeSnapshot )"` → `cell "Tree (treeSnapshot)"`). Re-record the affected baselines; a `toHaveAccessibleName` that breaks is showing you what a screen reader actually announces.

  `cli` and `mcp` only change in the tab sequence (`real-a11y tabs`, the `get_tab_order` tool), the one view built by the in-page walk. Native trees are untouched.

  Because the rule reads computed `display`, a name computed in jsdom can differ from the same markup in a browser where jsdom's CSS engine differs: jsdom does not blockify flex or grid items, floats or absolutely positioned children, and it gives `<select>` / `<textarea>` `display: inline` where Chromium gives `inline-block`. Those cases keep their old unspaced names under a jsdom-based matcher while a real browser spaces them.

  Four differences from Chromium remain, all pre-existing and none of them closed here:

  - An `<img alt="…">` and an `<iframe title="…">` inside a name-from-content element still contribute nothing, where Chromium reads the `alt` / `title` and spaces it: `<button>Save<img alt="icon">now</button>` is `"Savenow"` here and `"Save icon now"` there. A replaced element that contributes nothing (`<svg>`, an empty `alt`) already matches Chromium, spacing included.
  - `inert` and `content-visibility: hidden` hide a child from AT but still **render** it, so Chromium spaces across them where this does not. Telling the two kinds of hidden apart is a different question from how a child's box spaces its neighbours, and it predates this rule, so it is left as its own change.
  - A `<wbr>`, which Chromium treats as a word separator, does not separate.
  - `visibility: hidden` descendant text still reaches the name at all (`"Save x now"` where Chromium reads `"Save now"`) — a hidden-text question rather than a spacing one, and untouched here.

- a70ad18: Report `aria-busy="true"` as `busy: true` in a native tree. Chromium sends the `busy` state over CDP as a number under a boolean type, `{"type":"boolean","value":1}`, where every other boolean state arrives as `true` or `false`. The native producer turned that into the string `"1"`, so a native tree carried `a11y.states.busy: "1"` for the same element the DOM producer reports as `busy: true`.

  The native producer now decodes a state by its CDP value type. A boolean-typed value is a boolean whatever its JSON type, and `0` reads as `false`. The tristate strings `"true"` / `"false"` still read as booleans, and `"mixed"` or a token such as `invalid`'s `"grammar"` stays a string. `busy` is the only property that arrives as a number in Chromium 151 and 153, checked across every ARIA state and property.

  - **`cli` / `mcp` tree diffs:** after a step that sets `aria-busy`, `real-a11y interact` (and `click` / `type` / `focus`) and the `diff_tree` tool printed `~ region "Results": a11y.states.busy (unset) → "1"`. They now print `→ true`, the same line `a11yDiff` prints for a DOM tree. The `diff` string in `--format json` changes the same way.
  - **Queries:** unaffected. `findByRole` has no `busy` filter, and `list` / `list_elements` don't read states.
  - **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
  - **`testing`:** nothing it prints changes. `attach(page, { tree: "native" })` bundles the fixed producer, but its snapshots and assertions don't read `busy`.

- 5fc5848: Let an element's own semantics decide its `checked`, `expanded` and `pressed` states, as Chromium does, instead of an ARIA attribute on it. The DOM producer copied the attribute, so an unchecked `<input type="checkbox" aria-checked="true">` reported `a11y.states.checked: true`, a `<select aria-expanded="true">` reported `expanded: true`, and an indeterminate checkbox reported no `mixed` at all:

  ```html
  <input type="checkbox" aria-checked="true" aria-label="Terms" />
  <select aria-expanded="true" aria-label="Size">
    …
  </select>
  <details>
    <summary aria-expanded="true">Shipping</summary>
    …
  </details>
  ```

  Each rule matches Chromium 151's own tree:

  - **`<input type="checkbox">` and `<input type="radio">`:** `checked` is the control's checkedness, whatever its `aria-checked` says. An indeterminate checkbox (`.indeterminate = true`) is `"mixed"`, checked or not, even with `role="switch"`. A radio is never mixed. In its own role, or as a `switch`, `radio`, `menuitemcheckbox` or `menuitemradio`, the state is always set: an unchecked one reports `checked: false`, where it reported nothing. As an `option` or `treeitem` it has the state only while `aria-checked` is set. With `role="button"` and `aria-pressed` it is a toggle button, so the checkedness is `pressed` instead, and under any other role it has neither state. Any other `<input>` type with a checkable role, such as `<input type="text" role="checkbox">`, still reads `aria-checked`.
  - **`<select>`:** a drop-down, one whose display size is 1 (`<select multiple size="1">` included), ignores `aria-expanded`. Its `expanded` is whether its picker is open, so it reports `expanded: false`, where it reported nothing. A list box (`multiple`, `size` above 1, or `role="listbox"`) has no `expanded` state, unless the author gives it `role="combobox"`, which reads `aria-expanded` as before. Neither has `pressed`. A `<select>` with another author role, such as `role="button"`, reads `aria-expanded` and `aria-pressed` as before.
  - **`<summary>`:** any `<summary>` child of a `<details>` takes `expanded` from whether the details is open, whatever its `aria-expanded` says. It reported nothing, or the attribute's value. That holds in its own role and under a role with an expanded state, such as `button`, `link`, `tab` or `checkbox`. Under a role without one, such as `heading` or an explicit `generic`, it has no `expanded` state at all. It ignores `aria-pressed` too, unless `role="button"` makes it a toggle button.

  A live tree now also re-reads every checkbox, radio and `<select>` when it refreshes. A click on one radio unchecks its sibling, and a change handler can make a "select all" box indeterminate. Neither fires an event or changes an attribute on that other control, so its state went stale in a panel until something else re-extracted it. Opening a `<select>`'s picker fires nothing either, so it shows on the next refresh, whatever causes it. A change to a `<select>`'s `size` or `multiple` now refreshes it too, since they decide whether it is a drop-down.

  What this changes for you:

  - **Queries:** `findByRole` / `findAllByRole` with `{ checked: false }` now match an unchecked native checkbox or radio. They matched none, because the state was unset. The `checked` and `pressed` options now take `"mixed"`, too, so `{ checked: "mixed" }` finds an indeterminate checkbox. An indeterminate checkbox that is also checked no longer matches `{ checked: true }`, and a native checkbox no longer matches through its `aria-checked`. `{ expanded: false }` now matches a closed drop-down `<select>` and the summary of a closed `<details>`.
  - **Tree diffs:** `a11yDiff` prints a checkbox or radio as `a11y.states.checked false → true` when it is checked, where it printed `(unset) → true`. Toggling a `<details>` now prints a change on its summary.
  - **Panels:** the state badges in `inspector`, `react` and `storybook-addon` show `checked=mixed` on an indeterminate checkbox. A native checkbox no longer shows `checked` for `aria-checked="true"`, and a summary no longer shows `pressed`. A radio its sibling unchecked, or a box a handler made indeterminate, now updates on the next refresh.
  - **`toBeValidA11yTree`:** unaffected. It checks that required attributes are present, and a native checkbox or `<select>` never owed them.
  - **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
  - **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.

- 6b24b4c: Report a popover invoker's `expanded` state the way Chromium does: whether its popover is showing, whatever its `aria-expanded` says. The DOM producer copied the attribute, so a button whose popover was closed reported `a11y.states.expanded: true` if its `aria-expanded` said so, and one with no `aria-expanded` reported no state at all, open or closed:

  ```html
  <button popovertarget="menu" aria-expanded="true">Menu</button>
  <div id="menu" popover>…</div>
  ```

  The rule, as measured against Chromium 151 and 153:

  - **Which controls:** a `<button>`, or an `<input>` of type `button`, `submit`, `reset` or `image`, with a `popovertarget` that names a popover (any `popover` value), whatever its `popovertargetaction`. A `<button>` with a `commandfor` and a `command` of `toggle-popover`, `show-popover` or `hide-popover` (in any case) takes its state from the element `commandfor` names instead, which outranks `popovertarget`. That element decides even when it isn't a popover, which reports `expanded: false`.
  - **Which don't:** a disabled control, including one in a disabled `<fieldset>`, and a submit button with a form, which submits it instead. A `<button>` with no `type` or an invalid one is a submit button, unless it has a `commandfor`. An id resolves only in the invoker's own tree, so a button outside a shadow root can't name a popover inside it. Each of these reads `aria-expanded` as before.
  - **Inside its own popover:** a control inside the popover it invokes, like a close button, reads `aria-expanded` as before. A popover that invokes itself doesn't count as inside.
  - **Roles:** only a role Chromium gives an expanded state takes the popover's: `button`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `tab`, `checkbox`, `switch`, `combobox`, `treeitem`, `row`, `gridcell`, `columnheader`, `rowheader`, `listitem` and `application`. An invoker with another author role, such as `role="radio"`, reads `aria-expanded` as before.

  A live tree now also refreshes when a popover opens or closes. Neither changes an attribute, so nothing re-extracted, and a panel kept the invoker's old state and the popover's old content until something else changed. It now listens for the popover's `toggle` event, including for a popover outside the observed root, and re-reads every invoker on refresh. The event doesn't cross a shadow root, so a popover inside a component's shadow tree still updates only on the next refresh something else triggers. It also watches `popovertarget`, `commandfor`, `command`, `popover` and `form`.

  What this changes for you:

  - **Queries:** `findByRole` / `findAllByRole` with `{ expanded: false }` now match an invoker whose popover is closed, with or without `aria-expanded`, and `{ expanded: true }` one whose popover is showing. An invoker no longer matches through an `aria-expanded` that disagrees with its popover.
  - **Tree diffs:** `a11yDiff` prints `a11y.states.expanded false → true` on an invoker when its popover opens. It printed nothing, since the attribute never changed.
  - **Panels:** the `expanded` badge in `inspector`, `react` and `storybook-addon` follows the popover, and updates when it opens or closes.
  - **`toBeValidA11yTree`:** a `role="combobox"` button that invokes a popover no longer fails with `missing required aria-expanded`. The browser supplies the state, as it does for a `<select>`.
  - **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
  - **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.

- 4604812: Find the audit root on a page that names an image `querySelector`. The document lets a named `<img>`, `<form>`, `<embed>` or `<object>` shadow its own members, and the in-page lookup that finds the root called `document.querySelector`. So on a page with `<img name="querySelector">` it threw before the tree was built — even with no `rootSelector`, since the default is the selector `"body"`.

  - **`testing`:** every `attach(page)` call — `treeSnapshot()`, `outlineSnapshot()`, `tabSequenceSnapshot()` and every `assert*` — rejected with `TypeError: document.querySelector is not a function`. They now audit the page.
  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` reported the same failure as `Invalid rootSelector: "body"`, naming a selector nobody passed, and `tabs` exited 2. They now list the tab stops.

  Pages without such a name are unaffected, and a `rootSelector` that matches nothing still fails loudly. `attach(page, { tree: "native" })` and the other `cli` / `mcp` commands never ran this lookup.

- 6d3971a: Stop reading a decorative `clip-path: inset(...)` as the visually-hidden idiom.

  The DOM extractor flags an element `dom.isHidden` when it carries the sr-only signature, one half of which is a `clip-path` that clips the box away to nothing. It recognised that by the string the value starts with — `inset(5` or `inset(1` — so it matched `inset(50%)` and `inset(100%)`, but equally `inset(10px)`, `inset(1em)`, `inset(50px)`, `inset(15%)` and anything else whose first component begins with a 1 or a 5. Those crop an edge off an element that stays fully visible.

  So a `position: absolute` or `position: fixed` element with a decorative crop — a non-interactive one without a `tabindex`, which is all this signature ever looks at — read as content that is announced but not drawn.

  The insets are now parsed, and the element counts as hidden only when they provably clip the box away: an opposing pair meets (`top + bottom >= 100%`, `left + right >= 100%`), or one inset of `100%` crosses the box on its own — the latter only when the edge opposite it is not negative, since a negative inset grows the shape instead (`inset(100% 0 -50% 0)` clips to a strip below the box, where overflowing content still paints). A length can't prove a collapse without the box's size, so it never counts — while a zero counts in any unit. A `calc()` on an edge the answer depends on is left alone rather than guessed at, and a nested function keeps its own parentheses, so `inset(50% calc(50% + 1px))` is read as the two components it is rather than cut at the `calc`'s own `)`.

  What this changes for you, on a page with such a crop:

  - **`dom.isHidden` is now `false`** on those elements, and a tree diff reports the change against a tree recorded before this release.
  - **Snapshots and outlines:** such an element that is _not_ exposed to AT on its own — an unnamed `<div>` wrapper, say — was skipped by the tree walk on the strength of `isHidden` alone, and is now included. **A committed baseline from such a page changes, so re-record it.** An AT-exposed element was kept either way, so its presence is unchanged.
  - **Cross-link inference** (`controls` / `controlledBy`) considers those elements as candidates again.

  And in the other direction, because the rule now recognises collapses the prefix match missed — `inset(0 100%)`, `inset(60%)`, `inset(0px 40% 0px 60%)`, and in Chromium `rect(0 0 0 0)` / `xywh(0 0 0 0)`, which compute to `inset(0px 100% 100% 0px)`:

  - **`dom.isHidden` is now `true`** on those, all correct per CSS. An unnamed wrapper carrying one **drops out** of snapshots and outlines, the mirror image of the bullet above — so a re-recorded baseline can lose nodes as well as gain them.

  `cli` and `mcp` bundle `core`, so they are released with it and carry the fix in the one DOM-produced surface they have (`tabs` / `get_tab_order`). Nothing there changes in practice: this signature never looks at an interactive element or one with a `tabindex`, which is all a tab stop can be, and the tab sequence does not read `isHidden`.

  Unchanged: the genuine idiom still reads as hidden, both halves of it — `clip-path: inset(50%)` / `inset(100%)`, and the classic `clip: rect(0, 0, 0, 0)` on a 1px box. Bootstrap's `.visually-hidden` and Tailwind's `sr-only` use exactly those, so neither is affected.

- 82e3d40: Keep a `<textarea>`'s markup text out of the tree. That text is the field's default value, not something the page renders — the browser shows what the field holds now — and for a sensitive field (`autocomplete="one-time-code"`, `cc-number`, `cc-csc`…) it is the secret itself. Every text the tree builds read it as page text anyway. On this page

  ```html
  <input aria-labelledby="otp" />
  <textarea id="otp" autocomplete="one-time-code">902114</textarea>
  ```

  `treeSnapshot()` printed `textbox "902114"`, the one-time code as the name of the field it labels, with no option asking for values. It now prints `textbox`.

  Where else the text reached, and no longer does:

  - **Descriptions:** an element whose `aria-describedby` points at a textarea was described with its text.
  - **Names from content:** a textarea given a role that takes its name from text (`<textarea role="generic">`) was named after it, and so was a heading or button around it: `heading "Pay 737"` is now `heading "Pay"`.
  - **Panel labels:** the Tab Sequence view and the filtered lists in the `inspector`, `react` and `storybook-addon` panels label an unnamed node with its own text, so an unlabeled textarea was listed as its contents, the secret included. It is now listed by its tag: `<textarea>` in the Tab Sequence view, `(textarea)` in a list.
  - **The `dom` facet:** the textarea's own `dom.textContent` and `dom.descendantText`, and the `dom.descendantText` of every element around it, carried the text, as did each panel's text previews.

  What this changes for you:

  - **A textarea's value is unaffected.** `a11y.value` still reads what the field holds now, `[redacted]` for a sensitive one, and `treeSnapshot({ values: true })` prints it as before.
  - **An ordinary textarea's default text is gone from these places too.** It goes stale as soon as the user types, and Chromium's own accessibility tree never has it. A panel search for that text no longer finds the field; search for its label.
  - **Snapshots and tree diffs:** a baseline that recorded a textarea's text in a name or description changes. Re-record it, and if the text it held was real rather than a fixture's, treat it as exposed.
  - **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` walk the page themselves, so only they change. Every other command reads Chromium's tree, which never had the text.

## 0.1.0-beta.7

### Minor Changes

- b27960e: The DOM extractor now walks what the browser renders, **including open shadow roots**, so web components are no longer empty hosts.

  Before, it read only light-DOM children. Anything inside a custom element's shadow root was invisible: a Lit or Shoelace control, a design-system button, the SkipTo.js button on the W3C APG pages. That affected the panel, the inspector, the React and Storybook panels, and every `testing` matcher and assertion. An unlabeled button inside a component was never seen, so checks like the unlabeled-control assertion passed without looking at it. Chromium's native tree (used by the CLI and MCP) always had these nodes.

  Now:

  - **Shadow content** appears under its host, and **slotted children** appear at their `<slot>`. A slot with nothing assigned shows its fallback content. Light children that no slot takes aren't rendered, so they're left out.
  - **`aria-labelledby`, `aria-describedby` and `<label for>` resolve inside the component's own shadow root**, not against the document. A same-id element elsewhere on the page no longer supplies the wrong name.
  - **Name-from-content, text previews and `<header>`/`<footer>` landmark scoping** all follow the rendered tree too.
  - **Closed shadow roots stay unreadable**, by design; the host remains a leaf.

  **Expect snapshot changes on pages that use web components.** Trees gain the nodes that were missing, and assertions may now report real issues inside components.

  The inspector marks its own `container` with `data-real-a11y-panel`, and extraction skips any element carrying it. The panel mounts in an open shadow root, and in `mount: "light"` its UI was already in the page, so without the marker a panel inside the inspected root would list its own controls.

  Not yet covered: live views (the panel and the extension) don't re-extract when something changes inside a shadow root, because their mutation observer doesn't reach into shadow trees. Refresh picks the change up.

- 3bab2a7: Visually hidden content that screen readers still read (the "sr-only" pattern) now counts: it appears in snapshots, outlines, queries and audits, as it does in Chromium's own tree.

  The DOM extractor flags sr-only elements `dom.isHidden` because they aren't visible, while keeping them exposed to assistive technology. Every query built on the tree walk skipped anything flagged `isHidden`, so content a screen reader announces was silently dropped. For example, GitHub's visually hidden `h2 Navigation Menu` was missing from the DOM heading outline but present in the native one. Now only content that is hidden from sight **and** from AT is skipped.

  What changes on a page with sr-only content:

  - **Tree and outline snapshots** (`toMatchA11ySnapshot`, `treeSnapshot`, `outlineSnapshot`, the extension's export) include the sr-only nodes. **Expect snapshot changes.**
  - **`findByRole` / `findAllByRole`** return sr-only matches by default, the way Testing Library's `getByRole` does.
  - **Audit rules** see them too. The heading-order rule no longer reports "Missing <h1>" on a page whose only `h1` is visually hidden.

  Unchanged: `visibility: hidden` and `aria-hidden` content is still left out, and `includeHidden: true` still brings it back. Native form controls, links and anything with a `tabindex` were never flagged sr-only, so the tab sequence is effectively unaffected.

  In a DOM-less runtime (no computed styles), an inline `visibility: hidden` now counts as hidden from AT too, matching how it already counted as not visible. Without that, such an element would have looked like sr-only content and been kept.

  Two related fixes to what counts as hidden from AT when you query a DOM-view tree (`extractDomTree`), which keeps `aria-hidden` subtrees:

  - **Content inside an `aria-hidden` ancestor counts as hidden, too.** The tree walk now inherits `aria-hidden` down the subtree, because no descendant can override it. So an sr-only heading behind an `aria-hidden` wrapper stays out of outlines and snapshots. The a11y view (`extractA11yTree`) already pruned these subtrees.
  - **`findByRole` / `findAllByRole` now leave out nodes hidden from AT by default,** as `includeHidden`'s docs always said. On a DOM-view tree they used to return `aria-hidden` elements, and anything inside one. Pass `includeHidden: true` to get them back.
  - **The heading outline leaves out headings AT can't reach.** `getOutline`, `serializeOutline`, the heading-order audit and the extension's outline export no longer list an `aria-hidden` heading, or a heading inside an `aria-hidden` container, when given a DOM-view tree. The a11y view never contained them.

- 8348641: The DOM tree producer now decides modality the way Chromium's own accessibility tree does. Only a `<dialog>` opened with `showModal()` (the `:modal` pseudo-class) scopes the tree **exclusively** to itself. `aria-modal="true"` alone no longer does: the dialog joins the tree as an ordinary overlay, and the page behind it stays.

  `aria-modal` is a claim the author makes to assistive tech, not a state the browser enforces, and Chromium does not prune for it. Treating it as modal made the DOM producer disagree with the native one in two ways seen on a real site:

  - **A closed drawer blanked the whole page.** A mobile nav left mounted while closed, as `role="dialog" aria-modal="true" aria-hidden="true"` and translated off-screen, passed the CSS visibility check and won the modal scope. Everything inside it is `aria-hidden`, so the page extracted as an **empty tree**: the extension showed nothing, `tabs` printed `(nothing focusable)`, and `real-a11y tree` (native) showed the full page.
  - **A cookie bar took over an interactive page.** A bottom consent bar marked `role="alertdialog" aria-modal="true"`, with the page still fully usable, collapsed the tree and the tab order to the banner's four buttons.

  Relatedly, an overlay that assistive tech cannot reach (inside `aria-hidden="true"` or `inert`) no longer widens a component root to `document.body`. That closed drawer used to turn every component snapshot on the page into a whole-page snapshot, although nothing in it appears in the tree.

  Modal libraries still come out right, because they remove the background themselves: Radix and MUI set `aria-hidden` on the siblings, and Headless UI makes them `inert`. The walk already drops both, the same way Chromium does.

  ### Breaking change

  Tree, tab-order and snapshot output changes wherever an `aria-modal="true"` dialog is open **and** nothing hides the background. That is most common in jsdom tests that fake a modal with the attribute alone. jsdom has no `showModal()`, so it cannot open a native modal at all. Those trees now contain the page as well as the dialog.

  **Migration.** Make the fixture modal the way a real page is: set `inert` (or `aria-hidden="true"`) on the content behind the dialog when it opens. Then re-record your snapshots (`vitest -u`). If the component under test really does leave its background exposed, the new output is what a screen reader on Chrome gets, and that gap is in the component, not the baseline.

- ce0ab40: feat: the native tree shows what a field holds the way a screen reader announces it, withholding only what is sensitive — and a strict `redactInput` mode restores the old blanket rule (ADR-0001).

  - **Live reads show values.** The CLI's `tree`, `tabs`, `list`, `inspect` and the `interact` / `click` / `type` / `focus` diff (and their `--format json`), and the MCP server's `get_semantic_tree`, `inspect_page`, `list_elements`, `get_tab_order` and `diff_tree`, now print a field's value: `textbox "Email" = "jane@x.com"`, a `<select>`'s chosen option, a slider's `aria-valuetext` else its number, a file input's names, a rich-text editor's content. After `type`, the diff reads `~ textbox "Email": a11y.value (unset) → "hello"`. The text passed to `type` / `type_text` is still never echoed (`= ‹hidden›`).
  - **Sensitive fields stay withheld.** A `type="password"` field, or one whose `autocomplete` is `current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month` or `cc-exp-year`, reads `"[redacted]"` when filled — never Chromium's masking bullets, which give away the length — and so does anything inside one (a card-expiry input's month/year spinbuttons) or around one. This also fixes a leak that predates values: Chromium names a table cell, link or button from contents that include an embedded field, so `<td><input autocomplete="cc-number"></td>` printed the card number as the cell's name and a password cell printed its bullets. Such a container now reads `"[redacted]"`, a name or description pulled from one by `aria-labelledby` / `aria-describedby` is withheld, and a sensitive `<select>`'s options no longer say which one is `selected`.
  - **Persisted outputs are opt-in.** `real-a11y snapshot` artifacts leave values out unless `--values` (config `defaults.values`), which also records `meta.values: true`; `diff` warns when only one side carries values. MCP `checkpoint_findings` takes `values` (default `false`), and `export_checkpoint` refuses a checkpoint captured with values unless it is also passed `values: true`. Existing artifacts and baselines are unchanged. The opt-in covers each field's own value; a name Chromium builds from what a field or editor holds, such as a heading typed into an editor, stays unless `redactInput` is on.
  - **Strict mode: `redactInput`.** `--redact-input` (config `defaults.redactInput`) in the CLI, `REAL_A11Y_REDACT_INPUT=1` for the MCP server (any value other than `1`/`true`/`0`/`false` refuses to start), and `attach(page, { tree: "native", redactInput: true })` in testing withhold every field value and all rich-text editor content: inside a `contenteditable` or `designMode` region the structure is kept, a name Chromium computed from the typed text reads `"[redacted]"`, a text-only node reads unnamed, a name built from what any field or editor holds — from contents, a `<label>` or `aria-labelledby` — reads `"[redacted]"`, no `<select>` option says it is selected, and the `dom` facet drops `href` / `src` / `poster` / `id`, with locators anchored outside the editor. `tabs` (the in-page walk) prints no values under it but keeps a link's text inside an editor. `redactInput` on the DOM tree in testing throws rather than be ignored.
  - **A role-less editor is a node of its own.** `<div contenteditable>` is kept in the native tree as an unnamed `generic` — empty or not, so typing into it never adds a node — holding its text as its value, instead of being flattened away with its text unreachable; it prints as `generic = "…"` wherever values print. Its text never names it or its container.

  Heads-up for scripts and agents reading live output: field contents — ordinary fields and composer drafts — now reach stdout, CI logs and an MCP client's context by default. Use the strict mode where that is not acceptable, or mark secret fields up with `type="password"` / the right `autocomplete` token.

- daab90a: Implement ARIA's **Presentational Roles Conflict Resolution** in the DOM tree producer. `role="presentation"` / `role="none"` is now ignored — and the element exposed with its **implicit** role — when the element is focusable or carries a global ARIA state/property, and `<img alt="">` is presentational only when nothing else names it.

  Three elements that were wrong before:

  - `<a href="/about" role="presentation">` reported `role: "presentation"`. It was kept in the tree (a focusable carve-out already existed) but under the decorative role, so every consumer reading `role` saw a presentation node where a screen reader announces a link. It now reports `link` — likewise `<button role="none">`, and anything made focusable by `tabindex`.
  - `<h2 role="presentation" aria-label="Quarterly results">` dropped out of the tree entirely, taking the heading with it. A global ARIA property voids presentation, so it is a `heading` again — and visible to heading-order checks, which is where its absence actually hurt.
  - `<img alt="" title="Company logo">` dropped out. Per HTML-AAM an empty `alt` is presentational only absent other naming, so it is now an `img` named `"Company logo"`. The `title` fallback in accessible-name computation was being short-circuited by the empty `alt`, so the name had to be fixed alongside the role or the tree would have gained an exposed but nameless image. A bare `<img alt="">` is still decorative and still drops.

  Three deliberate limits, each one a way this could have gone wrong:

  - **`aria-hidden` does not void presentation.** It removes the element from the tree outright, so letting it restore a role would resurrect something nobody can reach.
  - **A global attribute counts only when it says something.** `aria-label=""` and `title="   "` state nothing and leave the decorative role alone — honouring them would expose a permanently nameless node.
  - **`<img alt="">` is gated on the _naming_ attributes** (`title`, `aria-label`, `aria-labelledby`) plus focusability, not on the full global set that voids an explicit `role="presentation"`. `<img alt="" aria-describedby="…">` stays decorative: exposing it would put a nameless `img` in the tree, and every "image has no accessible name" check would then flag markup that is correctly marked decorative.

  Focusability for this purpose is stricter than the `interaction.isFocusable` facet, which is tag-based and counts every `<a>` and `<input>`. An `<a>` without `href`, a `disabled` control and `<input type="hidden">` are not tab stops, so their decorative role stands and they flatten exactly as before. The facet itself is unchanged.

  ### Breaking change

  Tree output changes for pages containing any of the three shapes above, so committed snapshots and assertions that encode the old output will fail.

  **Migration.** Re-record your snapshots (`vitest -u`, or regenerate the CLI/MCP baseline you compare against) and read the diff: each changed line is a place where the tree now matches what assistive tech announces. Two patterns are worth fixing in the page rather than the baseline — a `role="presentation"` on a link or button does nothing and can be deleted, and an `<img alt="">` that turned out to have a `title` was never decorative. Assertions that relied on such a node being **absent** need inverting; assertions that matched `role: "presentation"` on a focusable element should match its implicit role instead.

- a695e13: Map a `<header>` / `<footer>` inside `main` or sectioning content (`article`, `aside`, `nav`, `section`) to the ARIA 1.3 `sectionheader` / `sectionfooter` roles, per HTML-AAM, instead of `generic`. Body-scoped ones are still `banner` / `contentinfo`.

  HTML-AAM lets user agents leave these roles unexposed when the element has no accessible name, isn't focusable and carries no other global ARIA attribute. Both producers now apply that rule the same way. These roles take their name from author attributes only (`aria-label`, `aria-labelledby`, `title`), as they do in Chromium, so a header is no longer named from its loose text (a byline such as `By Ada · <time>…</time>`).

  - **DOM producer** (`testing` matchers, `inspector`, `react`, `storybook-addon`): the a11y view still flattens a bare one, so **most a11y-view snapshots are unchanged**. A named, focusable or ARIA-annotated header/footer now appears as `sectionheader "…"` / `sectionfooter "…"` instead of `generic "…"`. The DOM view and DOM-mode serialization now show every such element as `sectionheader` / `sectionfooter`, where a bare one was previously hidden as `generic`.
  - **Native producer** (`cli`, `mcp`): Chromium exposes these roles even when bare. The normalizer now drops a bare one and re-parents its children, as the DOM producer does. Native trees and baselines lose a `sectionheader` / `sectionfooter` level on most real pages. `NATIVE_AX_VOCABULARY_VERSION` goes to 3.

### Patch Changes

- b3c3ff2: fix(browser): `BrowserSession.nativeAX()` now normalizes Chromium's accessibility tree with core's shared native vocabulary (`normalizeNativeAX` / `serializeNativeAX`), the same one `nativeTree()` uses, instead of a private copy of the tables that had drifted from it. Its return shape is unchanged (an indented `role "name"` tree plus flat role+name pairs), but its content now matches `nativeTree()` node for node:

  - a **named** `generic` container (e.g. `generic "YouTube Video Player"`) is kept instead of flattened; a bare one is still dropped
  - `Video` / `Audio` map to `video` / `audio`, and `ListMarker` / `Ignored` are dropped
  - sibling order follows Chromium's `childIds`, and a leaf with an empty name picks up its text from a dropped `StaticText` / `LabelText` descendant (`listitem "Alpha"` rather than a bare `listitem`)
  - that promoted name goes through the same redaction as `nativeTree()`, so an unlabeled field's typed value never becomes its name

  Future changes to the shared vocabulary now reach `nativeAX()` automatically.

- 37e82f8: Leave the body of a closed `<details>` out of the tree built from the page. Chromium renders a closed disclosure as its summary alone: the body sits in a slot the browser hides, so its accessibility tree omits it and Tab never reaches a control in it. The in-page walk read every child anyway, so it listed controls nobody can reach. On this page:

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

- d0cb634: A heading, button or link that contains a `<details>` now includes the disclosure's summary in its accessible name, the way Chromium does.

  The DOM extractor treated `<details>` like any other `group` and skipped everything inside it when naming an ancestor. So a GitHub comment header, `user commented • <details><summary>edited by bot</summary>…</details>`, was named "user commented •", while Chromium (and a screen reader) reads "user commented • edited by bot". Now:

  - **A closed `<details>`** contributes its summary (the first `<summary>`) and nothing else, because the rest is hidden until it opens.
  - **An open `<details>`** contributes all of its content.
  - **An explicit `role="group"`** on the `<details>` still blocks it, as it does in Chromium.
  - **A closed `<details role="none">`** no longer leaks its hidden body into the name. It used to, with the words glued together ("SBody").

  Live views (the inspector, the React and Storybook panels, the extension) keep that name current. Editing the summary, or opening and closing the `<details>`, now updates the enclosing heading or button without a full refresh.

  Descriptions built from `aria-describedby` are now whitespace-collapsed like names, so a description no longer carries a doubled space where the walk padded a link or summary.

  **Expect snapshot changes** where a named element contains a `<details>`: its name gains the summary text.

  One remaining difference: a `<details>` with no `<summary>` gets its name from Chromium's built-in, localized "Details" label. That label isn't reproduced here.

- a6d9e15: Stop naming a dialog, image, landmark or text field from its loose text. The DOM producer's last-resort name step took an element's direct text for every role, so `<div role="dialog">Delete this project? <button>Cancel</button></div>` came out as `dialog "Delete this project?"`. Chromium, and the screen reader reading it, give that dialog no name. Because it looked named, `assertDialogsLabeled` / `dialog-labeled`, `image-alt` and `assertNoUnlabeledInteractive` all passed markup that AT announces unnamed.

  Roles only an author can name now skip that step. They are still named by `aria-label`, `aria-labelledby`, `title`, or a host-language source such as a `<legend>` or `<summary>`, and their loose text no longer names them. The roles covered:

  - the dialogs (`dialog`, `alertdialog`) and `img`
  - the landmarks, including `form`, which a name would turn into one
  - `article`, `group`, `figure`, `tabpanel` and the other sectioning roles
  - the composite widgets (`listbox`, `menu`, `toolbar`, `grid`, …)
  - widgets whose text is a value, not a label: a `<textarea>`'s contents, a contenteditable `textbox`, a `combobox`'s selected text, `<progress>` / `<meter>` fallback text

  An authored role now also outranks a tag that is normally named by its content. The Radix Select trigger, `<button role="combobox">Apple</button>`, was `combobox "Apple"` and is now an unnamed `combobox`. So are `<a role="img">` and `<h2 role="tabpanel">`.

  Every one matches what Chromium 151 computes for the same markup.

  Unchanged: paragraphs, list items and the other prose roles, plain containers (so the a11y view keeps the same shape), and live regions (`alert`, `status`, `log`, `timer`, `marquee`), whose text is the announcement and whose name no audit reads.

  - **Snapshots:** a DOM-mode a11y snapshot can lose a name where loose text sat directly inside one of these roles. The common case is `<footer>© 2026 Example Inc.</footer>`, which now snapshots as `contentinfo` instead of `contentinfo "© 2026 Example Inc."`. Re-record those baselines. Text inside a child element, such as a `<p>` in the footer, still shows.
  - **Assertions:** `assertDialogsLabeled`, `assertNoUnlabeledInteractive` and the `image-alt` rule may now fail on pages they used to pass. Each new failure is an element with no accessible name. Fix it with `aria-labelledby` pointing at visible text, or with `aria-label`.
  - **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view built by the in-page walk. A tab stop such as an unlabeled `<textarea>` now prints as `textbox` instead of `textbox "<its contents>"`. Native trees are untouched.

- dca8553: Treat `role="image"` as the `img` role. ARIA 1.3 adds `image` as a synonym of `img`, and Chromium exposes both as the same image role, never named by its content. The DOM producer kept the raw token, so `<span role="image">🎉</span>` came out as `image "🎉"` while the native producer reported a bare `img`. Nothing downstream recognised `image`: the `image-alt` rule skipped the element, named or not; `listByRole(root, "image")` and a role query for `img` missed it; and `toBeValidA11yTree` reported `"image" is not a valid ARIA role`.

  An authored `role="image"` now extracts as `img`, and is named the way an `img` is: by `aria-label`, `aria-labelledby` or `title`, never by its text. That includes a tag normally named by its content — `<button role="image">🎊</button>` was `image "🎊"` and is now an unnamed `img`, as Chromium computes it.

  - **Snapshots:** a DOM-mode snapshot containing `role="image"` changes from `image "<text>"` to `img`, or `img "<label>"` when it has one. Re-record those baselines.
  - **Assertions:** the `image-alt` rule (`collectFindings`) may now report an unlabeled `role="image"` it used to skip, and `toBeValidA11yTree` reports it as `role "img" requires an accessible name` instead of an invalid role. A labeled one now passes both. Fix a new failure with `aria-label`, or with `aria-labelledby` pointing at visible text.
  - **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view built by the in-page walk. A focusable `role="image"` now prints as `img` instead of `image "<text>"`. Native trees already reported `img` and are untouched.

- 4ec846c: feat(core): a node now carries the value a screen reader announces for a field, as `a11y.value`, per ADR-0001 ("Field values: withhold what is sensitive, show what a screen reader reads").

  - **What it holds.** A text field's or rich-text editor's text; a `<select>`'s selected option **label** (`"Spain"`, where the DOM producer's `dom.attributes.value` keeps the raw `"es"`); a range widget's `aria-valuetext`, else `aria-valuenow`; a file input's file names. A checkbox, radio or button has none. Whitespace collapses and a value is capped at 240 characters. An empty field has no value.
  - **Sensitive fields.** A `type="password"` field, or one whose `autocomplete` names a credential or payment field (`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`), reads `"[redacted]"` when it holds anything. The token list is unchanged and is now exported for reuse, with `isSensitiveFieldAttributes` for callers that hold a field's markup but no live element.
  - **Printing it is opt-in.** The tree, tab-sequence, list and diff serializers gain a `values` option, default **off**, so every existing snapshot is byte-identical. With it on, a field prints as `textbox "Email" = "jane@x.com"`, and a diff reports `~ textbox "Search": a11y.value (unset) → "hello"`. In testing: `treeSnapshot(root, { values: true })`, `boxedTreeSnapshot`, the Playwright adapter's `sn.treeSnapshot({ values: true })`, and `a11yDiff(before, after, { values: true })`.
  - **`expectChanges({ exact: true })`** now sees field-value changes, since diffs model them, but never counts a change made only of `a11y.value` as unexpected: typing into a field changes that field, which is the step itself. Assert it explicitly with `changes: ["a11y.value"]`.

  - **A role-less editor is no longer named after what was typed into it.** `<div contenteditable>draft</div>` read `generic "draft"` and now reads an unnamed `generic` whose value is `"draft"`. It stays in the accessibility view as a field, and serializers print it as `generic = "draft"` with `values: true`. Chromium leaves it unnamed too.
  - **Diff views see value changes.** A panel diff (inspector, storybook-addon, extension) now marks a field you typed into as changed.

  A hostile page whose `.value` getter throws no longer costs the field its node; the value is simply absent.

  `cli` and `mcp` re-release the bundled engine; their output is unchanged by this release.

- 2aa2c5c: Report a control disabled by its `<fieldset>` as disabled. The DOM producer read a control's `disabled` state from the control's own `disabled` attribute only. In this form, `Save` has no attribute of its own:

  ```html
  <fieldset disabled>
    <legend><button>Unlock</button></legend>
    <button>Save</button>
  </fieldset>
  ```

  HTML and Chromium both treat `Save` as disabled. So a screen reader announces it as unavailable, and the tab sequence already skips it. But its node carried no `a11y.states.disabled`, and a `<button aria-disabled="false">` in the same place was reported as explicitly not disabled. Both now read `disabled: true`.

  The exemption stays as HTML defines it: a control in the fieldset's first `<legend>`, like `Unlock`, is not disabled. That covers every `<button>`, `<input>`, `<select>` and `<textarea>`, including one in a nested fieldset, and each case matches the `disabled` property of Chromium 151's own tree.

  - **Queries:** `findByRole` / `findAllByRole` with `{ disabled: true }` now match these controls.
  - **Tree diffs:** toggling a fieldset's `disabled` now changes the state of every control inside it. `a11yDiff` prints `~ button "Save": a11y.states.disabled (unset) → true` for each one, so a committed diff snapshot around such a toggle gains those lines. Re-record it. `flow().expectChanges` can now assert the change with `changes: ["a11y.states.disabled"]`. A spec that already passed still passes, because it matches changes as a subset.
  - **Panels:** the tree's `disabled` badge in `inspector`, `react` and `storybook-addon` now shows on these controls.
  - **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
  - **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but no output of theirs shows a DOM-produced state.

- 2aa2c5c: Report an option in a disabled `<select>` or `<optgroup>`, and a control inside an `aria-disabled` container, as disabled. The DOM producer read `disabled` from a form control's own state and from the node's own `aria-disabled`, so none of these had one:

  ```html
  <select disabled>
    <option>Red</option>
  </select>
  <select>
    <option disabled>Green</option>
  </select>
  <div role="group" aria-label="Shipping" aria-disabled="true">
    <button>Quote</button>
  </div>
  ```

  Chromium reports `Red`, `Green` and `Quote` as disabled, and a screen reader announces them as unavailable. Their nodes now carry `a11y.states.disabled: true`. Each case matches the `disabled` property of Chromium 151's own tree:

  - **Options** are disabled by their own `disabled`, by their `<optgroup disabled>`, or by their select, including a select disabled by its `<fieldset>`. The optgroup itself stays unmarked, as in Chromium.
  - **Inside a disabled container**, an element inherits the state from the nearest ancestor that is a disabled `button`, `input`, `select` or `textarea`, or that sets `aria-disabled`. An `aria-disabled="false"` on the way stops it. It can't re-enable a disabled control or what that control holds.
  - **Only focusable elements inherit the state**, as CORE-AAM says: a button, a link with an `href`, a field, a `tabindex` element, a native option, or an editing host such as `<div contenteditable>`. A paragraph, a heading or a `<div role="button">` with no `tabindex` inside an `aria-disabled` group stays as it was. So does a link inside an editor, which Chromium won't focus.
  - **A disabled `<fieldset>` passes the state to nothing but its form controls.** The fieldset itself, a `<div role="button" tabindex="0">` or an `<a href>` inside it, and a control in its first `<legend>` all stay enabled.
  - The walk follows the flat tree, so a control in a shadow root, or slotted into one, inherits the state too. An ancestor above the extracted root counts too.

  What this changes for you:

  - **Queries:** `findByRole` / `findAllByRole` with `{ disabled: true }` now match these nodes.
  - **Tree diffs:** toggling a container's `aria-disabled`, or a select's `disabled`, now changes the state of every focusable element or option inside it. `a11yDiff` prints `~ button "Quote": a11y.states.disabled (unset) → true` for each one, so a committed diff snapshot around such a toggle gains those lines. Re-record it. A spec using `flow().expectChanges` that already passed still passes, because it matches changes as a subset.
  - **Panels:** the tree's `disabled` badge in `inspector`, `react` and `storybook-addon` now shows on these nodes.
  - **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
  - **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but no output of theirs shows a DOM-produced state.

  The page walk also no longer hangs on a `<form>` whose control is named `parentElement` or `assignedSlot`. Such a control shadows the form's own property, so a walk up the tree read the form's parent as that control and looped forever. A `<header>` or `<footer>` inside such a form hung the extraction before this change, and every focusable element in one now walks up the same way.

- da7117e: In the native tree, an image, dialog, landmark or form field no longer takes its text as its name. An unlabeled `<span role="img">🎉</span>` is now reported by `image-alt`. It used to pass.

  Chromium names these roles from the author only: `alt`, `aria-label`, `aria-labelledby`, `<label>` or `title`. With none of those, Chromium leaves the name empty and puts the text on a child. The native normalizer then copied that text into the name whenever the element had no other children. So `<span role="img">🎉</span>` printed as `img "🎉"`, and `image-alt` skipped it because it had a name. The same happened to:

  - `<div role="dialog">Unsaved changes</div>`, which printed `dialog "Unsaved changes"` and passed `dialog-labeled`
  - `<div role="listbox"><label>Choose a plan</label></div>`, which printed `listbox "Choose a plan"` and passed `no-unlabeled-interactive`
  - `<svg role="img"><text>Chart</text></svg>`, which printed `img "Chart"`
  - a landmark whose only content is text, like `<footer>© 2026 Acme</footer>` or `<nav>Menu</nav>`

  Each now prints bare (`img`, `dialog`, `listbox`, `contentinfo`), as Chromium names it, and the audit rule reports it. An element whose author did name it keeps that name: `<span role="img" aria-label="Party">🎉</span>` is still `img "Party"`.

  The roles are images, dialogs and alert dialogs, the landmarks (`banner`, `complementary`, `contentinfo`, `form`, `main`, `navigation`, `region`, `search`), and the form fields that `no-unlabeled-interactive` checks and Chromium never names from content (`combobox`, `listbox`, `searchbox`, `slider`, `spinbutton`, `textbox`). A field's typed value no longer reaches its name at this step either; the CLI and MCP already removed it later.

  Other elements still read their text as before. That covers list items, code, paragraphs, alerts, status messages, groups and articles, and controls Chromium names from their content, like a checkbox with its label inside it.

  This affects the native tree only: `real-a11y tree`, `audit` and the other native CLI commands, the MCP tools, and `testing`'s native producer.

  **Expect new findings and snapshot changes.** `audit` reports images, dialogs and fields that were silently passing. Native snapshots of pages with text-only landmarks, dialogs or `role="img"` lose those names.

- ef464bd: In the native tree, a paragraph that mixes plain text with links, code or emphasis now keeps its own text. It used to show up as a bare `paragraph`.

  Chromium puts a paragraph's plain text on its own text children. The native normalizer only read that text when the paragraph had no other children in the tree. So `<p>Read the <a>guide</a> and run <code>seed</code> first.</p>` printed as a bare `paragraph` with its `link` and `code` beneath it. "Read the", "and run" and "first." were lost. Now it prints `paragraph "Read the and run first."`, which is the same line the DOM producer prints. The link's and the code's text stay on their own lines, as before.

  The same fix covers two ways a paragraph's name was cut short:

  - **Inline formatting Chromium flattens** (`<b>`, `<small>`, a plain `<span>`) no longer truncates the name at the first run. `<p>Pure <b>bold</b> text.</p>` read `paragraph "Pure"` and now reads `paragraph "Pure bold text."`.
  - **A `<br>`** reads as a space. `<p>Line one<br>Line two</p>` read `paragraph "Line one"` and now reads `paragraph "Line one Line two"`.

  Besides paragraphs, this applies to the other prose roles: list items, block quotes, description terms and definitions, captions, and inline `code`, `strong`, `em`, `mark`, `del`, `ins`, `sub`, `sup` and `time`. So `<li>Alpha <a>link</a> tail</li>` now reads `listitem "Alpha tail"`.

  Only the element's **own** text is used. Text inside a `<label>`, a `<div>` or a visually hidden `<span>` is never pulled up into the element around it.

  Elements named only by their author still take no name from their text. That covers dialogs, images, landmarks, forms and widgets. `<div role="dialog">Delete this project? <button>Cancel</button></div>` still has no accessible name, so the `dialog-labeled` audit still reports it. The same holds for `<nav>Menu: <a>Home</a></nav>` and a focusable `<header>` with a byline.

  This affects the native tree only: `real-a11y tree` and the other native CLI commands, the MCP tools, and `testing`'s native producer.

  **Expect snapshot changes** in native snapshots of pages with mixed-content paragraphs or list items: those lines gain a name.

- f9c5c41: In the native tree, an indeterminate progress bar and a static separator no longer take their text as their name. `<div role="progressbar">Loading files</div>` printed `progressbar "Loading files"`, and `<div role="separator">Or</div>` printed `separator "Or"`. Both now print bare (`progressbar`, `separator`), as Chromium names them. Text inside a nested element, like `<div role="progressbar"><span>Loading</span></div>`, is covered too.

  ARIA names a progress bar, meter, scrollbar or separator from its author only. The text inside one is fallback for its value, not its name. Chromium leaves them unnamed and reports a value for most of them, which already kept their text out. An indeterminate progress bar and a separator that can't be focused have no value, so their text still became a name. The native normalizer now lists all four roles among those it never names from text, as the DOM producer already did.

  A label the author gave is kept: `<div role="progressbar" aria-label="Upload">` is still `progressbar "Upload"`. No audit rule reads these names, so no finding appears or disappears.

  This affects the native tree only: `real-a11y tree` and the other native CLI commands, the MCP tools, and `testing`'s native producer. `NATIVE_AX_VOCABULARY_VERSION` goes to 7.

  **Expect snapshot changes** on pages with a text-only indeterminate progress bar or a static separator with text: those nodes lose that text as their name.

- 64cf782: In the native tree, what a user typed into a plain `<div contenteditable>` no longer shows up as the name of the item around it. `<li><div contenteditable>…</div></li>` printed `listitem "<everything typed>"`, and a `<div role="note">` around an editor printed `note "<everything typed>"`. Both now print bare, as Chromium names them. A list item with ordinary text, like `<li><div>Alpha</div></li>`, still reads `listitem "Alpha"`.

  Chromium reports an editor's text as its value and again as text inside it. The native normalizer already kept that text out of the name of a text field, and the CLI and MCP removed it from an editor such as `<div role="application" contenteditable>` after normalizing. But a plain `<div contenteditable>` is left out of the tree, and its text was copied into the name of the nearest item that kept it. The normalizer now never takes a name from text inside anything that carries a value, whichever node the name would land on. The step the CLI and MCP ran afterwards is gone, because the normalizer covers it. Their output for `application`, `document`, `log` and contenteditable `<p>` editors is unchanged.

  This affects the native tree only: `real-a11y tree`, `audit` and the other native CLI commands, the MCP tools, and `testing`'s native producer. `NATIVE_AX_VOCABULARY_VERSION` goes to 6.

  **Expect snapshot changes** on pages with a role-less rich-text editor inside a list item, note or similar container: that container loses the typed text as its name.

- 8346959: Count the `<summary>` that toggles a `<details>` as a tab stop. Chromium tabs to it, but the tab sequence never counted one, so every disclosure and FAQ accordion question was missing. On this page:

  ```html
  <details>
    <summary>How long does shipping take?</summary>
    <p>3 to 5 days.</p>
  </details>
  <details>
    <summary>Can I return an item?</summary>
    <p>Within 30 days.</p>
  </details>
  <a href="/contact">Contact us</a>
  ```

  `real-a11y tabs` printed

  ```
  01. link "Contact us"
  ```

  and now prints

  ```
  01. generic "How long does shipping take?"
  02. generic "Can I return an item?"
  03. link "Contact us"
  ```

  Only the first `<summary>` child of a `<details>` is a stop, as in Chromium 151, even with other content before it. A second summary, a summary nested deeper, or one outside any `<details>` stays plain text. A `<fieldset disabled>` does not disable a summary, since it is no form control.

  Where it shows:

  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
  - **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` gain a stop for each details' summary, and mark one `[focused]` when it has focus. Re-record those baselines.
  - **Panels:** the Tab Sequence view in `inspector`, `react` and `storybook-addon` lists the same stops, and the tree's "focusable" badge shows on the summary.
  - **The DOM a11y tree:** a details' summary used to be dropped from it, since its text names the `<details>`. It now stays as a `generic` child of the `<details>` group, with only its interactive descendants under it, as does any other name source Chromium can focus, such as a `<legend tabindex="0">`. `treeSnapshot` hides generics by default, so its default output is unchanged; with `includeGeneric: true` the summary line appears.
  - **`interaction` facet:** `isFocusable` is `true` for a details' summary.
  - **`role="none"` / `role="presentation"`:** it no longer applies to a details' summary, which is focusable. Chromium ignores it there too.

- f84f589: Fix the tab sequence around rich-text editors. The DOM producer left out every `contenteditable` editor, although each one is a Tab stop, and it listed every link inside an editor, which Chromium won't focus at all. On a message composer, `real-a11y tabs` printed the reset link someone had pasted into the draft, token and all, and never mentioned the composer:

  ```
  01. link "https://x.test/reset?token=abc123"
  02. link "Mention Alice"
  ```

  It now prints the stops Chromium actually tabs through:

  ```
  01. textbox "Message"
  02. link "Mention Alice"
  03. generic
  ```

  What counts as a stop, all checked against Chromium 151:

  - **Editor:** the root of each editable region, its _editing host_, is a stop with no `tabindex` needed. `contenteditable` reads the way HTML defines it: `""`, `true` and `plaintext-only` in any case; `false` opts out; any other value inherits. A `contenteditable` nested inside an editor is part of it, not a second stop.
  - **Link inside an editor:** not a stop, and not focusable at all, unless it has its own `tabindex` or sits in a `contenteditable="false"` island, like the mention chip above. Buttons, inputs and `tabindex` elements inside an editor stay stops.
  - **Name:** an editor is named only by its author (`aria-label`, `aria-labelledby`, `title`), never by what was typed into it. That applies whatever its role, as in Chromium: `<h3 contenteditable>Draft</h3>` is an unnamed `heading`. A role-less `<div contenteditable>` used to be `generic "<its text>"` and is now `generic`. Its text still names another element that points at it with `aria-labelledby`.
  - **Actions:** a role-less editor gets `focus` and `type` actions like a `textbox`. The panel can type into it, and the a11y view keeps it when it holds no text. A link inside an editor loses its `click` and `navigate` actions, because Chromium doesn't follow it, not even on a scripted `click()`. A `role="none"` link there now flattens away instead of staying as a bare `presentation` node.

  Where it shows:

  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
  - **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` gain each editor and lose links inside one. A DOM-mode a11y snapshot shows a role-less editor as `generic` instead of `generic "<its text>"`. Re-record those baselines.
  - **`interaction` facet:** `isFocusable` is now `true` for an editor and `false` for a link inside one. A `role="presentation"` on either follows the same rule.

- 8346959: Fix which elements the tab sequence counts as stops. It counted every `<a>`, with or without an `href`, every `tabindex` attribute whatever its value, and a control disabled by its `<fieldset>`, although Chromium focuses none of them. It also left out an `aria-disabled` control, which Chromium does tab to. On this page:

  ```html
  <a name="top">Back to top</a>
  <a role="button">Save draft</a>
  <a href="/docs">Docs</a>
  <button aria-disabled="true">Publish</button>
  <fieldset disabled><button>Save</button></fieldset>
  <div tabindex="">Card</div>
  ```

  `real-a11y tabs` printed

  ```
  01. generic "Back to top"
  02. button "Save draft"
  03. link "Docs"
  04. button "Save"
  05. generic "Card"
  ```

  and now prints the two stops Chromium tabs through:

  ```
  01. link "Docs"
  02. button "Publish"
  ```

  The `<a role="button">` is the one that matters. It is a button no keyboard can reach, which is what a tab order is for catching, and it was listed as a stop.

  What counts as a stop, all checked against Chromium 151:

  - **Link:** an `<a>` needs an `href` or a `tabindex`.
  - **Disabled:** a control disabled directly or by a `<fieldset disabled>` is not a stop, unless it sits in that fieldset's first `<legend>`. `aria-disabled` announces a state and leaves focus alone, so its control stays a stop.
  - **`tabindex`:** read the way HTML parses an integer. `""` and `"abc"` are ignored, `"1abc"` is 1 and `"0.5"` is 0. Any negative value takes an element out of the order, not just `-1`.

  Where it shows:

  - **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
  - **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` lose the stops above and gain `aria-disabled` controls. Re-record those baselines.
  - **Panels:** the Tab Sequence view in `inspector`, `react` and `storybook-addon` follows the same rules, and so does the tree's "focusable" badge.
  - **`interaction` facet:** `isFocusable` now says what Chromium says for every node, so it is `false` for an `<a>` without `href`, a disabled control and an element whose `tabindex` is not an integer.
  - **`role="none"` / `role="presentation"`:** it gives way on a focusable element, and focusable now means the same thing here. So the role now applies to a control in a disabled fieldset, and no longer applies to an element with `tabindex="1abc"`. A DOM-mode a11y snapshot can change for either.

## 0.1.0-beta.6

### Minor Changes

- 69a9f90: Reject input that isn't a tree, instead of reporting it as a clean page.

  Every entry point that accepts `Element | ExtractionResult` resolved the second
  branch with an unchecked cast, so anything that wasn't an `Element` — a number,
  a string, `{}`, a `Date` — became an empty tree. The rules then found nothing
  and the assertion **passed**:

  ```js
  assertNoUnlabeledInteractive(42); // passed silently
  collectFindings(42); // 2 findings, about the number
  assertLandmarkStructure(42); // threw "Missing <main>" — about the number
  auditSnapshot(42); // ""  ← committed, this is a permanently green test
  ```

  The matcher layer already guarded this (`expected a DOM Element, received
number`); the `assert*`, `collectFindings`, `listByRole` and `serialize*`
  layers did not. They now throw a `TypeError` naming the function called and the
  type received:

  ```
  assertNoUnlabeledInteractive: expected a DOM Element or an extracted a11y tree, received number
  ```

  It is a `TypeError`, never an `A11yAssertionError` — code catching the latter is
  handling "this page has issues", and a wrong argument is not that. The message
  names the received **type** and never its value, since what lands there by
  mistake is often page text or a token.

  Unknown rule ids are rejected the same way. `A11yRule` protects a TypeScript
  caller writing a literal, but a list built from a config file, a CLI flag or
  plain JavaScript reached the runtime unchecked, matched no rules, and passed
  having checked nothing — a typo silently deleted the check:

  ```js
  assertRules(page, ["landmark_structure"]); // passed; the real id is landmark-structure
  // now: unknown rule "landmark_structure". Known rules: no-unlabeled-interactive, …
  ```

  `formatFindings([])` now reads `No accessibility issues found.` rather than
  `Found 0 accessibility issues:` with nothing under it.

  **Breaking change.** A call that previously passed can now throw. In every case
  the call was already not testing anything — a suite that goes red here was
  green while asserting nothing — but it is a behaviour change and can surface as
  a newly failing test. Genuine inputs are unaffected: a DOM `Element` and a real
  `ExtractionResult` (including a native tree from CDP) behave exactly as before.
  The tree check is structural rather than `instanceof`, so a tree that crossed a
  realm — an iframe, a worker, a second bundled copy of the engine — still passes.

- 5b58757: Add `label-title-only`, an axe-aligned warning for form controls whose only label is `title` or `aria-describedby`.

  `no-unlabeled-interactive` still fails only on an empty accessible name — glyph buttons and `title=` on a `<button>` pass, matching axe `button-name`. Placeholder-only inputs are out of scope for the new rule, matching axe. The new id is selectable via `collectFindings` / `--rules` / `audit_page`; `assertNoUnlabeledInteractive` is unchanged.

- bd39293: feat(mcp): `checkpoint_tree` / `diff_tree` now read Chromium's native accessibility tree, the same producer the act tools target.

  They were the last two tools still on the in-page DOM walk, which meant an interaction diff was written in a different vocabulary from the action that caused it — you clicked `button "Attach"` and read a diff in which that node is `textbox "Attach"`. Now there is one producer end to end.

  The captured tree also moves out of the page and into the server. Previously a navigation destroyed the checkpoint and `diff_tree` could only report an error; now the checkpoint survives, and because native node ids belong to the document that issued them, `diff_tree` can tell you the page **navigated or reloaded** — naming where it started and where it ended up — instead of emitting a diff in which every node was removed and every node added.

  ## Breaking change

  Both tools lose their `rootSelector` parameter. Chromium's accessibility tree is whole-document, so there is nothing for a selector to scope; a parameter that silently did nothing would be worse than none at all. `get_tab_order` keeps `rootSelector` — it is the one tool still built on the in-page walk, because tab _sequence_ is layout work the AX tree does not expose.

  **Migration:** delete `rootSelector` from `checkpoint_tree` and `diff_tree` calls. If you were scoping a diff to a region, diff the whole document instead and read the region's part of it — the diff is per-node, so a narrower scope changed what was compared, not how the result was reported.

  The exported `SessionRecord` also changes shape: `treeCheckpointRoot: string | undefined` (the root the in-page checkpoint used) becomes `treeCheckpoint: NativeCheckpoint | undefined` (the captured tree itself). This is only visible to embedders driving the server with a custom `SessionManager`; the field is server-owned state, so the migration is to stop referencing the old name rather than to populate the new one.

### Patch Changes

- 56d5eb2: `--version` and browser commands now resolve Playwright the same way (`createRequire`, which sees `NODE_PATH` and a sibling global). `npm i -g playwright` unblocks a global CLI; `--version` no longer prints a version while `audit` cannot load the driver. The missing-Playwright hint names `npm i -g playwright` when the CLI is not in the current project's `node_modules`.
- e24f436: Never widen extraction away from a root that isn't in the document.

  Extraction widens to the whole document when a portal-mounted overlay sits
  outside the root — so a React-portalled menu joins the tree with its trigger.
  For an **attached** root that is loss-free: the document contains it, so
  widening only adds.

  For a root the document does **not** contain it is not. The document is then a
  disjoint tree, so the caller's own subtree disappeared and the audit described
  markup they never passed. That covers two shapes: a detached root, and a root
  inside a **shadow root** — `isConnected` is shadow-including while the walk
  reads light-DOM `children`, so a web component audited at its shadow subtree
  lost all of its content to any light-DOM toast.

  ```js
  document.body.innerHTML = '<p role="status">4 tickets</p>';
  const root = document.createElement("div");
  root.innerHTML = "<button>Save</button>";

  auditSnapshot(root); // → 'status "4 tickets"' — the button is absent
  collectFindings(root); // → []  ← reads as a clean component
  ```

  That last line is the damage: an audit that reports nothing because it ran
  against somebody else's DOM. Detached roots are ordinary — a jsdom fixture
  built with `createElement`, or a component inspected before mount.

  Both widening paths are fixed, not just the portal one: the modal path never
  looked at the root at all, so an open dialog anywhere in the document hijacked
  a detached or shadow-rooted root just as readily, and it runs first. A modal
  still scopes **exclusively** over a root the document contains, including a
  sibling one — content behind a modal is inert to AT, and that is deliberate.

  An **ancestor** live region is no longer treated as a portal either. "Outside
  the root" was accepting anything above it too, so the route announcer that
  Next.js, Remix and React Router wrap around the whole app matched on every
  extraction — pivoting every component root on the page permanently, not just
  while a toast was up.

  Three narrower corrections in the same check:

  - **`aria-live` is an allowlist.** It matched the attribute's _presence_, and
    component kits ship exactly that shell — a permanent body-level announcer
    with updates switched off until needed. `polite`/`assertive` pivot; `off`
    does not; anything absent, empty or invalid falls through to the role's
    implicit politeness, per ARIA. `!== "off"` was a denylist, so `none`,
    `false`, `0` and a typo'd `polit` — the hand-written spellings of "switched
    off" — all pivoted. An explicit value also beats a role's implicit
    politeness, so `<div role="status" aria-live="off">` is inert too.
  - **A `role` token list is read as a list**, and case is **not** folded. The
    selector matched `role` exactly, so `role="status announcer"` was invisible;
    it now decides on the first token, the same parse `getImplicitRole` uses, so
    the pivot and the extracted tree always agree about what an element is.
    Folding made `<div role="MENU" aria-live="off">` an overlay — it matched the
    container check before the `off` check — giving one element opposite scoping
    depending on an unrelated attribute.
  - **The rule lives in one place now.** The same selector existed as a
    hand-copied string in three files; the fix landing in one of them meant a
    `role="status announcer"` toast pivoted a one-shot `auditSnapshot` while
    never waking the inspector, the extension or a live MCP session — the same
    DOM producing two different trees depending on which path ran.

  Unchanged: an attached root still widens for a genuine portal, and still scopes
  exclusively to an open modal. The remaining sharp edge — an _ordinary_ in-page
  live region widening an attached root, since "outside the root" cannot tell it
  from a portal — is now documented under Troubleshooting rather than silent.

- 2c525d7: fix: name tables from `<caption>`, refuse dispatch on a disconnected node, and stop `expectTree` dumping both full trees.

  A `<table>` with a `<caption>` was extracted as unnamed, which is wrong per HTML-AAM and reported as an ARIA violation. The caption now supplies the name when it is visible and non-empty; a hidden or empty caption falls through (so `title` can still win); and when `aria-label` / `aria-labelledby` already names the table, the caption's words stay in the tree instead of being deleted. The live extractor learns the same owner→child edges for `fieldset`/`legend` and `details`/`summary`, so a caption edit no longer leaves a stale table name.

  `dispatch` now fails when the resolved element is disconnected — replacing `document.body.innerHTML` used to leave a detached node that still accepted events and returned `{ success: true }`.

  `flow.expectTree` (and the string form of `expectChanges`) keep the first-difference pointer and drop the two full-tree dumps that followed it.

- 0c85710: fix: redact secrets in a URL's **fragment**, and stop `open_page` printing its landing URL raw.

  Every URL these tools print goes through one redactor, which stripped userinfo and replaced secret-looking **query** parameters. It never looked past the `#`. That is precisely where OAuth's implicit flow puts its tokens — a redirect lands on `…/callback#access_token=ya29.…&token_type=bearer` — and because a fragment is never sent to the server, it is _only_ ever visible client-side, which is where this toolchain reads it. So a token in the query was redacted and the same token in the fragment was printed in full, into agent context, CLI output, saved artifacts, reports and CI logs.

  Ordinary fragments are left exactly as they were: `#installation` and `#/dashboard/users` are useful and are not secrets. Pairs are rewritten **in place**, so only a matched value changes and every other byte — separators, existing encoding, a bare trailing `#` — survives as it arrived.

  A fragment is opaque to the URL parser, so nothing decides authoritatively how it splits — the _app_ does. `#`, `?`, `&`, `/`, `;` and `,` are all treated as separators, and the assignment may be `=` or `%3D`. That covers the shape this is most likely to meet in the wild (a hash-routed SPA completing an implicit flow lands on `…/#/callback#access_token=…`, where the second `#` separates in every sense except the parser's) and Angular Router's matrix parameters, which use `;` inside the fragment.

  Anything that still cannot be read as pairs, yet plainly carries a secret-shaped key, is truncated from the last separator before it — **the route in front of it is kept**. That matters beyond readability: page identity is derived from the redacted URL, and for a hash-routed SPA every route lives at pathname `/`, so discarding the whole fragment collapsed distinct pages onto one id.

  Separately, the MCP `open_page` result printed `Opened <url>` unredacted, and the page-controlled `Title:` beside it unsanitized — a page could set `document.title` to inject a terminal escape sequence and forge extra result lines, including a second `Opened <url>` an agent cannot distinguish from the real one. Both now go through the boundary.

  The URL half matters more than it looks: what it prints is where the page **landed**, so it is the end of a redirect chain, and an OAuth redirect chain ends with the token. The matching failure path leaked it too — Playwright quotes the full target URL in a navigation error, and that message is relayed to the agent verbatim — so escaping errors now go through the same redactor the CLI already applied to its equivalent path.

  ## What this does not cover

  The **query** half is unchanged: it is still `URLSearchParams`-based, so it sees
  only `&` and a literal `=`, and it has no fail-closed backstop. `?access_token%3D…`
  and `?a=1;access_token=…` still print in full. Extending the fragment's tokenizer
  to the query is follow-up work — it is a wider behaviour change than this fix,
  and nothing here made the query half worse.

  ## One caveat worth knowing

  A page's identity is derived from its redacted URL, fragment included. A stored baseline or checkpoint whose fragment contains a deny-listed key — `#…code=…`, `#…token=…`, `#…key=…`, including as a _route_ segment like `#/orders/code=US` — therefore gets a new identity and will not join against a fresh capture. Re-baseline it. Note that `code` and `key` are ordinary route words, so this reaches some URLs that never carried a secret; a page that re-keys silently reports its whole committed baseline as new findings, which is the failure worth watching for.

  An ordinary `#anchor` is byte-identical to before and joins as it always did. And the flip side is the point: an artifact whose fragment held a real token was previously storing that token on disk, which is the worse half of this bug.

## 0.1.0-beta.5

### Minor Changes

- 1e64037: Stop publishing `@real-a11y-dev/core`; the extraction engine is internal now.

  It was the first package on npm and it is the last to go internal. Nobody installs an extraction engine on purpose — they install a matcher, a panel, a command, or a server, and the engine arrives inside it. Every published package already bundled it in practice; this makes that official. With it, the published set is **six packages**, down from thirteen.

  **Nothing changes for you unless you imported `@real-a11y-dev/core` directly.** It moves to `devDependencies` and is bundled into all six, so they install fewer packages, not more — and each carries the exact engine version it was tested against, which is what `noExternal` already gave you unofficially.

  If you did import it directly (last published `0.1.0-beta.13`), 19 of its 69 names keep a published home:

  - `@real-a11y-dev/testing` re-exports the query and diff vocabulary — `findByRole`, `findAllByRole`, `diffTrees`, `getOutline`, `getTabSequence`, `linearize`, `ROLE_FILTER_GROUPS` — with `SemanticNode`, `ExtractionResult`, `TreeDiff`, `NodeChange`, `OutlineEntry`, `RoleFilter`, `FindByRoleOptions`, `ActionType` and `ActionResult`.
  - `@real-a11y-dev/react` and `@real-a11y-dev/inspector` re-export the node, action and config types their own signatures name: `SemanticNode`, `ExtractionResult`, `TreeViewMode`, `ActionRequest`, `ActionResult`, plus `SemanticNavigatorConfig` on the inspector.

  **The other 50 have no drop-in, and two of them are a real capability leaving: `extractA11yTree` and `extractDomTree`.** Building your own published tooling directly on the engine was a documented path in the getting-started guide, and it is not one any more. The replacement is a surface that carries the engine rather than an import: `real-a11y` for the shell and CI (`--format json`, `-o`), the MCP tools for an agent, `attach(page)` from `@real-a11y-dev/testing/playwright` for a Playwright suite, or `createInspector` / `<SemanticNavigator />` for a UI. Also gone without replacement: the live machinery (`LiveTreeExtractor`, `DomObserver`, `FocusManager`, `ActionDispatcher`, `createPicker`) and the native-AX vocabulary.

  Two consumers changed shape rather than just moving a dependency line. `react` externalized `core` and now bundles it, and `storybook-addon`'s `index` entry listed it under `external` — correct while core was published, wrong the moment it wasn't, since npm cannot resolve a private package in the JS or in the types. Both entries genuinely need it: `react`'s `index.ts` re-exports core types and `useActiveModal` imports the _value_ `findByRole`, and `storybook-addon`'s `TreeMode` **is** core's `TreeViewMode`.

  `inspector` had a latent version of the same gap — `noExternal` without the matching `dts.resolve` — which was harmless only because core was still published. Both halves are now paired everywhere.

### Patch Changes

- e5ea95a: Share the node-id registry and the element reference map across every copy of the engine in a realm.

  Both were plain module-scope state — `const elementRefs = new ElementRefMap()` and a `let counter` beside a `WeakMap<Node, string>`. That is correct while exactly one copy of the engine is loaded, and only then.

  More than one copy is the normal case. `@real-a11y-dev/inspector` already bundles the engine rather than importing it, and the same is true of the extension; anything that bundles it gets a private registry. When a node crosses that boundary the ids stop meaning the same thing: `dispatch()` in `@real-a11y-dev/testing` turns a node id back into a live `Element` through the ref map, so an extraction recorded in one copy is invisible to an action performed by another. The lookup misses, `dispatch` returns without doing anything, and nothing reports an error — a Radix slider stepped with `dispatch(slider, "decrement")` simply stays at 50. The id counter has the matching failure: two copies both start at zero and both hand out `sn-0`, for different nodes.

  Both now live in a realm-wide registry keyed by `Symbol.for()`, so every copy in the realm resolves the same object. Realm rather than process is the right scope — an iframe or a worker gets its own, which matches the DOM it describes, since `Element` identity does not cross those either.

  > **Retargeted when `core` went private.** This entry named `core` itself while
  > the engine was still published, and dependents would have cascaded from its
  > bump. A private package has no version to cascade from, so the consumers are
  > named directly — all six, because every published package bundles the engine
  > and the fix has to reach every tarball. Left as it was, it would also have
  > mixed an ignored package with non-ignored ones and thrown at
  > `changeset version`, breaking the release cut.

  No API change: `getElementRefs()`, `getNodeId()` and `resetIdCounter()` keep their signatures and their behaviour, including `resetIdCounter()` resetting only the counter and deliberately keeping the node→id map.

## 0.1.0-beta.4

### Minor Changes

- 680efd2: Stop publishing `@real-a11y-dev/browser`; it is internal now.

  The Playwright-backed `BrowserSession` was on npm as a way to script audits without an MCP client. That job is the CLI's: `real-a11y audit --format json -o report.json`, `--session` for multi-step flows across commands, the `click` / `focus` / `type` / `interact` verbs, and `diff` for CI. The `browser` package was the seam that made those possible, not a thing anyone adopted on purpose.

  **Nothing changes for you unless you imported it directly.** It moves to `devDependencies` and is bundled into `cli`, `mcp` and `testing`, so those install fewer packages, not more.

  If you did import it directly (last published `0.1.0-beta.13`): `@real-a11y-dev/mcp` re-exports `BrowserSession` along with `A11ySession`, `BrowserSessionOptions`, `PageSnapshot` and `SnapshotOptions`, so the types behind the `SessionManager` contract stay reachable. What is gone is a package you can install to obtain a session — the CLI is the supported route for driving a browser, and `@real-a11y-dev/testing/playwright`'s `attach()` remains public if you bring your own Playwright `Page`.

  **The injected page-bundle is now inlined as source text rather than read from disk.** It used to be located by `new URL("./page-bundle.iife.global.js", import.meta.url)`, which is correct only while `browser` sits beside its own `dist/`. Bundled into a consumer, that resolves inside the consumer's dist where the file is not — so every `attach()` and page open would have failed at runtime, silently, because nothing type-checks a path and `verify` does not run the e2e suites. A lazy, cached `pageBundleSource()` replaces `PAGE_BUNDLE_PATH`; the bundle is embedded once per carrier by a build-time `define`, so a built artifact never touches the filesystem; running from source reads once and caches.

  `@real-a11y-dev/testing` also tightens its optional `playwright` peer from `*` to `>=1.49.0 <2`. That range was `browser`'s, inherited transitively while it was a real dependency; moving it to `devDependencies` dropped it out of testing's published graph, so it is restated directly. If you had `playwright` below 1.49 alongside `testing`, you will now see a peer warning that was always warranted.

  > **Release note.** In prerelease mode the nine retargeted changesets are already
  > consumed, so they surface at `changeset pre exit` rather than at the next beta.
  > This entry is the one that moves a version now.

## 0.1.0-beta.3

### Minor Changes

- f54f398: Stop publishing `@real-a11y-dev/audit`, `@real-a11y-dev/serialize` and `@real-a11y-dev/snapshot`; they are internal now.

  They were on npm because the workspace grew that way, not because anyone chose them as products. None had a documentation page, and nothing on the website recommended installing one. Together they were 95 of the 295 modelled exported symbols.

  **Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `browser`, `cli`, `mcp` and `testing` install fewer packages, not more.

  If you did import one directly:

  - `@real-a11y-dev/audit` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings` and the `assert*` primitives. That is the only published home for them — `mcp` names `Finding` in its own signatures but does not re-export it.
  - `@real-a11y-dev/serialize` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `extract`, `SerializeOptions`, and the `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` serializers.
  - `@real-a11y-dev/snapshot` (last published `0.1.0-beta.12`) → **there is no drop-in replacement.** The snapshot engine — fingerprints, the diffable `a11y-snapshot.json`, baselines — is now reachable only through the `real-a11y` CLI. `real-a11y snapshot` and `real-a11y diff` take `--format json` and write with `-o`, which is the supported way to drive it from a script or CI. `@real-a11y-dev/mcp` exposes the same engine as MCP tools.

  Every consumer pairs `noExternal` with `dts.resolve`, so no shipped `.d.ts` names a package npm cannot resolve — `surface:check` fails if that regresses, and the packed tarballs were checked directly.

### Patch Changes

- Updated dependencies [f54f398]
- Updated dependencies [80d2b02]
  - @real-a11y-dev/browser@0.1.0-beta.13
  - @real-a11y-dev/core@0.1.0-beta.13

## 0.1.0-beta.2

### Minor Changes

- 823d1cc: `real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

  ```sh
  real-a11y install                           # latest Stable
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # pin an exact build
  ```

  This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

  The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

  `@real-a11y-dev/browser` gains `executablePath` on `BrowserSessionOptions`, plus `resolveChromeExecutable`/`readChromeManifest`/`chromeCacheDir` for anyone building their own installer or launch wiring. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.

- 0aa04c5: One producer per surface — `--producer` and the MCP `producer` param are gone.

  The rule is **native for the a11y tree, DOM where the data only exists in the DOM**. Every read now comes from Chromium's own accessibility tree, which reaches structure no in-page walk can (a `<video controls>`'s user-agent-shadow media controls) and carries locators as of #251 — except tab order, which it cannot produce at all.

  **The flags are removed, not defaulted.** Each surface has exactly one correct producer, so there was nothing left to choose: `--producer` is gone from the CLI, `producer` from the MCP tools, and `compare_producers` with them (20 → 19 tools). `--root` survives on `tabs` alone; every other command reads the whole document, so a selector has nothing to scope, and they refuse the flag with that explanation rather than the parser's "Unknown option". A config `defaults.root` **warns on stderr and keeps running** — this loader is otherwise strict and fail-closed, and erroring would red every CI that set the key, mid-beta, over config that was correct when it was written.

  **`tabs` stays on the DOM producer, and that is not a fallback.** Native does know per-node focusability — `"focusable"` is in `STATE_PROPS`, which is what `focusedId` was built on. What it cannot produce is the _sequence_: `tabindex` is not in `DOM_ATTR_ALLOWLIST`, so it never reaches a native node, and ordering by it is DOM/layout work Chromium's AX tree doesn't expose. One DOM extraction still yields all four views from a single `page.evaluate`, so `tabs` is one read, not a second pass.

  ## The artifact had to change shape, and omission alone was not enough

  `projectNativeTree` returns `tabOrder: ""`, which `buildSnapshotPage` renamed to the artifact's `tabs`. So the **first diff across this migration** would compare a DOM artifact's N tab stops against a native one's none, and `views-summary` would report every stop as gone:

  ```
  Keyboard tab stop removed: button "Save"
  Keyboard tab stop removed: link "Home"
  … once per focusable element, on every page
  ```

  That is the tool's most safety-critical signal firing spuriously, at volume, on an upgrade where no page changed — plus the `NOTHING_FOCUSABLE` sentinel ("Nothing on this page is keyboard-focusable any more") reachable the same way.

  Simply omitting the view does not fix it. `parseSnapshotArtifact` coerced a missing `tabs` straight back to `""`, so a reader could not tell _absent_ from _empty_ and landed in the same place. The fix needs a presence signal that survives the round trip:

  - **`SnapshotPage.tabs` is now optional**, and a native page omits it.
  - **`meta.views`** records which views the run measured. Additive, so `schemaVersion` stays `1`; absent/null reads as a legacy artifact that measured all three, which is what its silence meant.
  - **The parser respects it** — an unmeasured view stays `undefined` (and a stray one is dropped, so the two can never disagree), while a _measured_-but-missing view still defaults to `""`, because "measured, nothing focusable" is a real state.
  - **`diff` compares an axis only when both sides measured it**, and reports the rest as `skippedViews` — surfaced in every format, so a silently skipped axis is never read as "tab order is fine".

  The same signal rides through the MCP server: `checkpoint_findings` is native too (both tools must read one producer, or a checkpoint captured by one and diffed by the other compares cross-producer findings), and `export_checkpoint` declares `views: ["tree", "outline"]`. A DOM-era artifact imported as a base still diffs cleanly — the tabs axis is skipped, not emptied.

  ## What this costs
  - **`inspect` no longer prints tab order**, and prints no empty section either — an empty block reads as _nothing here is focusable_, a very different claim from _not measured_. `real-a11y tabs` is the sequence. In exchange `inspect` and `audit` finally agree on findings, which they previously did not.
  - **`snapshot`/`diff` no longer detect tab-order regressions at all**, since the artifact carries no tabs view. The CI diff-bot guide says so plainly rather than leaving a stale promise. `real-a11y tabs` still reports the sequence, and still takes `--root`.
  - **A route's `urls[].rootSelector` no longer scopes `audit` or `snapshot`.** Both warn once, naming the routes, and keep running — findings from outside that subtree are now included. The entry still identifies a route.
  - **MCP checkpoints are whole-document too.** `checkpoint_findings`/`diff_findings` lost their `rootSelector`, so a base imported from a DOM-era artifact that was captured at a narrow root now diffs against a whole-page re-snapshot: the old findings still match by fingerprint, but everything outside that subtree arrives as NEW — the class that gates CI. The diff says so in its first line, naming both scopes, rather than widening silently.

  - **Every "narrow with `rootSelector`" hint had to be re-aimed.** The MCP output cap appended that line to _any_ truncated result, and `export_checkpoint` told you to re-save with a narrower one — advice four of the five read tools can no longer take, arriving at the exact moment the agent has lost information and most needs a way forward. Each read now names the lever it actually has (`rules`, a genuine `rootSelector` on `get_tab_order` and the tree checkpoints, or a smaller sibling read), and an oversized checkpoint export says what it can't do and points at `diff_findings` or the CLI's `snapshot --output` instead.

  Tab-order machinery stays in core / serialize / browser / extension / mcp; only the CLI's `inspect` and `snapshot` stopped consuming it. `@real-a11y-dev/testing` runs in-page by design and is unaffected.

- 135ccc3: Add **act tools** to the MCP server — `click_element`, `type_text`, and `focus_element` — closing the `checkpoint_tree` → interact → `diff_tree` loop an agent previously couldn't complete alone. Each dispatches a real action over CDP through `A11ySession.act()`, the write side the native producer shipped and nothing drove.

  Targeting is deliberately **role + accessible name** (plus a 1-based `nth` for duplicates), never a CSS selector or node id. `@real-a11y-dev/browser` gains `resolveTarget`, which resolves the query against a **fresh** native tree immediately before each dispatch — node ids stay internal (the serializer invariant holds), staleness shrinks to the instant between resolve and act, and a control that role + name can't reach is surfaced as what it is: an accessibility finding, not a targeting inconvenience. Ambiguity errors list the candidates as copy-paste `nth=` lines; disabled targets are refused with the cause rather than clicked into a void.

  The R1 redaction discipline extends to the new write path's results: `type_text` never echoes the typed value — in success or failure — and backend CDP errors stay content-free.

- abbfd6e: Named browser sessions for the MCP server.

  Every page tool gains an optional `session` parameter (1–32 chars, `A–Z a–z 0–9 _ -`, default `"default"`): separate names are independent live pages with their own findings checkpoints and tree checkpoint, calls within one session are serialized automatically, and different sessions run in parallel — the same registry semantics as the CLI's `--session` daemon, embedded in-process. Sessions launch lazily, are capped by `REAL_A11Y_MCP_MAX_SESSIONS` (default 4), and close on `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS` (default 15 min) or `close_browser`. Both variables must be non-negative integers — hex, fractions, and stray whitespace no longer parse into a limit nobody chose.

  Findings checkpoints outlive their browser: the idle timeout closes pages but keeps the store, because the cross-deploy workflow it exists for (checkpoint prod, review, diff a preview) routinely spans more than 15 minutes. `close_browser` remains the one thing that discards them, and the checkpoint-only tools (`list_checkpoints`, `diff_checkpoints`, `export_checkpoint`, `import_checkpoint`) read the store without launching a browser or spending a session slot.

  Tool surface: new `list_sessions` (name, redacted URL, busy state, timestamps); `close_browser` now takes `session` and `all`, which are not combinable. Auth is unchanged and deliberately session-agnostic: every named session inherits the operator's env-configured storage state / origin allowlist, and `session` never carries credentials.

  `buildServer` now accepts a `SessionManager` (exported, with `McpSessionManager`, `singleSessionManager`, `SessionInfo`, `SESSION_NAME_RE`, and the `SessionRegistryError` / `RegistryShutdownError` classes a custom manager signals refusals with). Passing an `A11ySession` keeps the existing single-page behavior for the default session; on that path a _named_ session is now refused with a remedy rather than silently resolving to the same page and the same checkpoint store.

- c10cfad: feat!: a page's identity is now separate from its display label

  `SnapshotPage.name` was documented as _"Diff join key + display label"_ — one
  field with two jobs. Because the join key **was** the label, changing the label
  changed what the tool believed the page was. Three failures came from that one
  conflation:

  - renaming a page for readability un-suppressed its baseline;
  - auditing a bare URL and later naming it in a config did the same;
  - the same page on localhost vs prod only paired if you kept the names
    character-identical by hand.

  No single field fixes all three — the URL breaks the third (which is why `name`
  was chosen over it), the label breaks the first two. So identity is its own
  field now, derived from the part of a URL that survives both:

  | field  | job                                      | default                 |
  | ------ | ---------------------------------------- | ----------------------- |
  | `id`   | join key — diff, baselines, fingerprints | the URL's path + search |
  | `name` | display label, free to change            | the redacted URL        |
  | `url`  | where it was captured                    | —                       |

  Config entries take an optional `id` to collapse routes the path separates, or
  to separate two sites that share one. Two pages with the same id is a **hard
  error** naming both URLs and the fix — silently blending two pages' findings is
  the worst outcome this model can produce.

  The rule is not new: `differentUrl` already compared path + search + hash and
  ignored the origin when deciding whether a checkpoint diff spanned two pages.
  This promotes it to the identity it was always implying, and both now read the
  same `pageIdOf` so a second definition can't drift into existence.

  **Breaking.** `ARTIFACT_SCHEMA_VERSION` and `BASELINE_SCHEMA_VERSION` are both
  `2`, because a finding's fingerprint now keys on the page's id rather than its
  label — the hashes in a pre-upgrade file were computed over a different tuple,
  and comparing the two schemes reports unchanged findings as fixed + new.

  The two formats are treated differently, and the asymmetry is the point:

  - **Artifacts are converted on read.** A v1 artifact holds the page `url` (→ the
    identity) and each finding's own components (rule, role, locator, …), so it
    can be re-keyed to produce exactly what a fresh capture of that page hashes.
    Nothing is guessed and nothing is lost — an old `a11y-snapshot.json` still
    diffs correctly against a new one, with no re-record.
  - **Baselines are refused by name.** A baseline stores no URL, only a label, so
    its identity cannot be derived from what it holds. Guessing was rejected
    outright: a wrong guess silently suppresses a real finding.

  **Upgrading a baseline.** Run `real-a11y snapshot --update-baseline`. It
  replaces an unreadable baseline rather than refusing it — refusing would be a
  dead end, since that is the command the refusal points you at — and says so, so
  the `+new/-stale` counts stay interpretable. **Any `note` you wrote on an entry
  does not survive**, and a note is the only part of a baseline nothing can
  regenerate, so recover those from version control before committing.

  The id is derived from the **redacted** url, so a `?token=…` never reaches the
  artifact, the fingerprints or the committed baseline through this new field.
  Schemes with no route — `data:`, `about:`, `blob:` — get no id at all and fall
  back to the display label, which is the pre-identity behaviour and the right
  answer for a content-addressed URL.

  **Two config entries that differ only by `rootSelector` are now an error.**
  Since the native-only migration both `audit` and `snapshot` read the whole
  document, so such a pair names one URL and measures the same thing twice — one
  page, one id. It used to warn and audit the page twice identically. Delete the
  redundant entry, or give one an explicit `id`.

  `import_checkpoint` no longer rewrites an imported page under the store label —
  it did that because a label was an identity, and the rewrite would now break the
  join it once repaired, so an artifact is stored as it arrived. Cross-tool diffs
  (MCP `export_checkpoint` → CLI `diff`) work as a result, which they never have.

  `diffLabeledCheckpoints` mostly stands down too: for a page with a real route
  both sides derive the same id and join on their own. It keeps its neutral
  re-fingerprint for one case — when **neither** side has a route (`data:`,
  `about:blank`), where the id falls back to the display label and two checkpoints
  of one unchanged page would otherwise report every finding as removed + re-added
  with no note explaining why. One routed side and one not stays a genuine
  mismatch and is not forced together.

  `A11Y_PAGES` entries take an optional `id`, matching config `urls` entries. Two
  pages resolving to one identity is a hard error, so the remedy has to be
  reachable from whichever page list you use — `A11Y_PAGES` is the documented
  drop-in for the CI guide, and "rewrite it as a config file" is not an answer.

- a4cfac8: Tab-order serialization is now number-free by default; numbering moves to a render-time step.

  `serializeTabSequence` used to render `01. link "Home"` / `02. button "Go"`. Inserting one focusable element near the top of the page renumbered every following line, so a committed snapshot's diff — and the reviewable unified-diff hunk of `real-a11y diff` — churned the whole view instead of showing the one inserted stop. Line order already conveys the sequence, so the serialized form is now just `link "Home"` / `button "Go"`: the canonical, diff-stable output you store and compare.

  For a human- or agent-read listing where an explicit "stop 7" helps, a new `numberTabStops(tabs)` export re-adds the `NN. ` prefix at **render time** (never stored):

  ```ts
  import {
    serializeTabSequence,
    numberTabStops,
  } from "@real-a11y-dev/serialize";
  numberTabStops(serializeTabSequence(root)); // 01. link "Home"  02. button "Go"
  ```

  Numbering is applied where output is read, not diffed: the CLI `tabs` terminal view, the MCP `get_tab_order` and `inspect_page` tools, and the extension's Markdown export (which stays numbered, matching its on-screen panel). It is absent where output is committed or diffed: `tabSequenceSnapshot()` in `@real-a11y-dev/testing`, the CLI `snapshot`/`inspect` artifacts and JSON, and the browser audit's `tabOrder`. (Also fixes an MCP snapshot summary that reported "0 tab stops" once lines were unnumbered.)

  **Breaking change.** Any committed snapshot of a tab sequence (vitest/jest `toMatchSnapshot`, an inline snapshot, or a golden file / CI artifact) will differ by the removed `NN. ` prefix on every line.

  **Migration.** Either re-generate the affected snapshots (`vitest -u`, `jest -u`, or re-capture the golden file), or wrap the value for display: `numberTabStops(tabSequenceSnapshot(root))`.

  Structural diffing tolerates the transition: `real-a11y diff` still strips leading `NN. ` numbers before comparing, so a base captured by an older numbered tool version diffs cleanly in findings, the multiset view, and the plain-language statements. The one exception is the tabs **hunk** view — a legacy numbered base shows a one-time full rewrite there until it is re-captured. That output is advisory and never gates.

### Patch Changes

- 38b81b1: Surface three behaviours in the tool descriptions, which is the only documentation an agent actually reads.

  Each of these was already decided deliberately and written down correctly — on the website, in the README, in a code comment — but none of it reaches an MCP client. The tool schema is the agent's entire view of the server, so a caveat that lives anywhere else may as well not exist. All three came out of dogfooding the server from an agent.

  - **`close_browser` discards saved checkpoints.** `checkpoint_findings` promised that checkpoints "survive navigation" with no further qualification, which reads as "survive everything". Both descriptions now state the loss and point at `export_checkpoint` as the way out.
  - **`open_page` reports the browser mode.** Headless is the default, so a human watching for a browser window concluded it never opened. The reply now names the mode, and mentions `REAL_A11Y_MCP_HEADFUL` when there's no window to see — except over `REAL_A11Y_MCP_CDP`, where the attached browser keeps its own window state and that variable does nothing; there it reports the attach instead of guessing at a launch that never happened. `buildServer` gained `headful` and `cdpAttached` options for this — the bin owns both decisions, so the server can only report what it's told.
  - **`open_page` states the session it actually has.** With no saved session, an agent hitting a logged-out page had no way to know the server _can_ authenticate; it now points at `REAL_A11Y_MCP_STORAGE_STATE` and `REAL_A11Y_MCP_CDP` and says plainly not to attempt a login through the tools — there is no credential parameter, deliberately, and env-only shouldn't mean invisible. A CDP attach is its own third case, not a flavour of "unauthenticated": it never carries a storage state (they're mutually exclusive) but reuses the attached browser's own context, so its pages inherit whatever that profile is signed into. It's told to verify what it got rather than assume either way, and that only the human at that window can sign in — telling it to "restart with `REAL_A11Y_MCP_CDP`" would have prescribed the setup already in force.

  No behaviour changes: same tools, same parameters, same results.

- 6785622: fix(mcp,audit): say which diff ran, and why a category came back empty

  Two agent-UX nits from the beta dogfooding pass.

  **Diff headers now name the operation.** `diff_findings` re-reads the live page;
  `diff_checkpoints` compares two stored snapshots and touches no browser. The old
  headers — `Checkpoint diff (vs. saved)` and `Checkpoint diff base → head` — did
  differ, but neither said which operation ran, and the first never said _which_
  checkpoint, so with several stored an output couldn't be traced back to its
  input. Now:

  ```
  Live page vs. saved checkpoint "prod": 1 new, 0 fixed, 0 changed, 12 unchanged.
  Saved checkpoints: "prod" → "preview" (no re-snapshot): 0 new, 2 fixed, …
  ```

  **An empty category explains itself.** `listByRole` returned a bare `(none)`,
  which answers three different questions identically — the page has none of
  these, nothing was extracted, or the category doesn't cover the role you meant.
  Each has a different fix, so the empty case now says which:

  ```
  (none — filter "image" matched 0 of 412 nodes; it looks for role img)
  (none — the tree is empty, so nothing could match filter "image"; the page may
   not have loaded, or extraction failed)
  ```

  The node count separates "this page has none" from "nothing was read". The role
  list is the other half, and carries more weight than it looks: `image` looks for
  exactly `img`, so a page whose graphics are `figure`s reports none — and
  `landmark` includes the `form` role while the `form` filter does not, because
  that one looks for the fields. Both read as a bug until the roles are visible.

  Reaches `real-a11y list` and the MCP's `list_elements`, which share the function.
  The signature is unchanged — still `(root, filter) => string` — so this is a
  change to the text, not to the type. It now never returns an empty string, so a
  caller needs no sentinel of its own.

- 43f085c: fix(mcp): a checkpoint diff across two different pages no longer dumps a structural summary

  Checkpoints deliberately survive navigation, which makes it easy to check one
  route and diff another — and the advisory structural summary then reports the
  whole page as rewritten. Hundreds of added and removed headings, landmarks and
  tab stops, none of which is a regression.

  `diff_findings` and `diff_checkpoints` now compare the two sides' addresses. When
  they are different pages, both name the two URLs and drop that section; findings
  still diff normally, since a `v1:` fingerprint keys on rule + role + locator, not
  on position.

  "Different page" means the path, query or fragment differs — **host, port and
  scheme are ignored on purpose**. Diffing prod against a preview is the headline
  workflow for these tools, and there the structural summary is the whole point.
  An unparseable address is never treated as a mismatch: dropping a section on a
  guess is worse than printing a noisy one.

  A checkpoint also now records where the page **is**, not where `open_page` landed.
  `click_element` can navigate, so those are different addresses — and recording
  the stale one left a diff across two genuinely different pages looking like one
  page twice. `A11ySession` gained `currentUrl()` (already on `BrowserSession`) so
  a consumer holding the interface can read it at extraction time.

- b1d7c33: Fix the published type declarations, which referenced a package that isn't on npm.

  `server.d.ts` shipped `import { SessionInfo } from "@real-a11y-dev/session-registry"` — but that package is private and deliberately never published; it is bundled into the server instead. The **JS** bundling always worked. The declarations are a separate emit, and tsup was not told to inline them, so the `.d.ts` kept pointing at a module npm cannot resolve.

  For a consumer that meant one of two things, and the second is the reason this went unnoticed:

  - with `skipLibCheck: false`, a hard `TS2307` — cannot find module;
  - with `skipLibCheck: true` (the common default), **no error at all** — `SessionInfo`, `SessionRegistryError`, and `RegistryShutdownError` silently degraded to `any`, so part of the public `SessionManager` contract stopped type-checking while everything looked fine.

  Those three names are part of the contract on purpose: a third-party session manager signals refusals by throwing `SessionRegistryError`, and an error class it cannot import is a contract it cannot implement. They are now inlined into the published declarations, so they arrive with real shapes and nothing points at the private package. `session-registry` stays private and unpublished.

  No API change — the same names are exported, from the same entry point.

- Updated dependencies [37f5859]
- Updated dependencies [37f5859]
- Updated dependencies [4e3c10a]
- Updated dependencies [b2ccee0]
- Updated dependencies [37f5859]
- Updated dependencies [bbbcb04]
- Updated dependencies [823d1cc]
- Updated dependencies [0aa04c5]
- Updated dependencies [135ccc3]
- Updated dependencies [6785622]
- Updated dependencies [43f085c]
- Updated dependencies [b304069]
- Updated dependencies [0a41085]
- Updated dependencies [c10cfad]
- Updated dependencies [a4cfac8]
  - @real-a11y-dev/browser@0.1.0-beta.12
  - @real-a11y-dev/snapshot@0.1.0-beta.12
  - @real-a11y-dev/audit@0.1.0-beta.12
  - @real-a11y-dev/serialize@0.1.0-beta.12

## 0.1.0-beta.1

### Minor Changes

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- d693a00: Surface the focused element to agents. `get_semantic_tree`, `get_tab_order`, and `inspect_page` now mark the element focused at capture time with a trailing `[focused]` (inherited from the serialize layer), so an agent can see that opening a dialog moved focus into it, or which control a keyboard user is on. Tool descriptions note the marker.

  `compare_trees` explicitly opts out (`markFocus: false`): Chromium's native tree carries no focus marker, so a `[focused]` suffix on the custom side would register as a spurious custom-vs-native divergence.

- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

- 91246b9: Make `producer: "native"` consistent across the MCP tools, and rename `compare_trees`.

  - **`producer: "native"` now works on every tree/findings/outline/list tool** — added to `get_semantic_tree`, `get_heading_outline`, and `list_elements` (it was already on `audit_page` / `inspect_page`). One rule: every tool that projects a tree/findings/outline/element-list takes `producer`; native is whole-document (`rootSelector` must be `"body"`).
  - **`get_tab_order` stays DOM-only** — a native tree carries no tab order, so the tool takes no `producer`.
  - **Removed `get_native_tree`** — it's now `get_semantic_tree` with `producer: "native"` (one canonical native tree, not two subtly-different serializations).
  - **Renamed `compare_trees` → `compare_producers`** — it diffs the DOM producer against the native producer (a _producer_ comparison at one instant), and the old name was easily confused with `diff_checkpoints` (a _temporal_ comparison of two checkpoints). It now compares against the same canonical native producer `get_semantic_tree { producer: "native" }` exposes, so a divergence it reports matches what you'd see there.

  Breaking for callers of `get_native_tree` (use `get_semantic_tree { producer: "native" }`) or `compare_trees` (use `compare_producers`).

- 484c49d: `audit_page` and `inspect_page` accept `producer: "native"` — audit Chromium's own accessibility tree.

  The default (`producer: "dom"`, unchanged) walks the page's light DOM. Passing `producer: "native"` runs the same audit over **Chromium's own accessibility tree** (read over CDP via `@real-a11y-dev/browser`'s `nativeTree`, serialized + audited in Node through `@real-a11y-dev/snapshot`'s `projectNativeTree`) — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. This is the difference between _viewing_ the native tree (`get_native_tree`, unchanged) and _auditing_ it.

  Native is whole-document and read-only: `rootSelector` must stay `"body"` (any other value is refused, since native can't scope), and a native tree carries no tab order — so `inspect_page`'s tab-order section reports N/A rather than an empty block. Chromium only.

- 0680dc9: Add **tree checkpoints** to the MCP server — the interaction diff. `checkpoint_tree` captures the current accessibility tree; after an interaction, `diff_tree` reports exactly which nodes were added, removed, or changed, plus where focus moved.

  Where the snapshot checkpoints answer _"what accessibility problems changed?"_, these answer _"what did that click change?"_ — making an interaction's effect legible: that opening a dialog added a `dialog` node **and** moved focus into it, or that a "Load more" button appended twelve links but left focus stranded.

  The captured tree lives **inside the page** — `@real-a11y-dev/browser`'s page-bundle gains `checkpointTree` / `diffSinceCheckpoint`, built on core's `diffTrees` and serialize's `serializeTreeDiff` — because node identities are realm-bound, so only the rendered diff ever crosses the boundary. That makes a tree checkpoint **page-instance-bound**: it is discarded on navigation, the deliberate asymmetry with snapshot checkpoints, which survive it. `diff_tree` re-extracts with the root the checkpoint was captured with unless you override it, so the comparison stays like-for-like.

### Patch Changes

- cd87cd2: Import the audit engine from its canonical home, `@real-a11y-dev/audit`, instead of through `@real-a11y-dev/testing`'s re-export — production packages no longer reach the findings engine through the test-helper package.

  - **`@real-a11y-dev/cli` no longer depends on `@real-a11y-dev/testing` at all.** `Finding` / `A11yRule` / `ALL_RULES` / `INTERACTIVE_ROLES` now come from `@real-a11y-dev/audit`, and `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core` (its real home). Installing the CLI no longer pulls in a test-runner-oriented package.
  - **`@real-a11y-dev/mcp`** imports `Finding` / `A11yRule` / `ALL_RULES` from `@real-a11y-dev/audit`. It still depends on `@real-a11y-dev/testing` for one thing only — the browser page-bundle (`page-bundle.iife.global.js`) it injects at runtime — and that remaining tie is removed when the browser layer is extracted to its own package.

  Pure re-point: the re-exported symbols are identical (audit is where they were always defined), so there is no public API or output change. Verified byte-for-byte against the CLI and MCP e2e suites.

- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [9d080eb]
- Updated dependencies [cf426d3]
- Updated dependencies [e2eca34]
- Updated dependencies [31deea2]
- Updated dependencies [84535a1]
- Updated dependencies [0680dc9]
- Updated dependencies [ba4ba95]
  - @real-a11y-dev/audit@0.1.0-beta.11
  - @real-a11y-dev/browser@0.1.0-beta.11
  - @real-a11y-dev/snapshot@0.1.0-beta.11

## 0.1.0-beta.0

### Minor Changes

- 9c3517c: The MCP server can now audit pages behind a login. Set `REAL_A11Y_MCP_STORAGE_STATE` to a saved Playwright storage-state file (create it out-of-band, e.g. with `real-a11y login`) and every page opens already authenticated — the session is operator-configured, never a tool parameter, so tokens never enter the agent's context. `REAL_A11Y_MCP_ALLOWED_ORIGINS` pins auditing to a comma-separated allowlist so a redirect can't route the session to an unintended site (the engine refuses extraction off-allowlist).

  The server validates the storage-state file at startup and refuses to boot if it's missing or malformed (a server that silently audits logged-out pages is worse than one that won't start), and rejects `STORAGE_STATE` combined with `REAL_A11Y_MCP_CDP`. When a session is loaded, `open_page` tells the agent so in its description and result — a boolean fact, never the path or contents — so it doesn't try to "fix" an already-authenticated page by logging in.

- 18dda52: New `@real-a11y-dev/mcp/browser` subpath export: `BrowserSession` (plus `OpenOptions`, `assertOpenableUrl`, and the session types) without loading the MCP SDK graph — the root export's module top-level imports the SDK and zod, which consumers that only want the browser session (like `@real-a11y-dev/cli`) shouldn't pay for. `BrowserSessionOptions` also gains an optional `proxy` pass-through to Chromium's launch options, since Chromium ignores `HTTP_PROXY`/`HTTPS_PROXY` env vars on its own. The playwright peer is now marked optional (`peerDependenciesMeta`) to match the lazy import — importing the server API (or the browser subpath's types) never requires a browser install, and downstream packages with a playwright-free surface no longer inherit an unmet-peer warning. The root export is unchanged.
- 32fc4e6: New package `@real-a11y-dev/mcp` — a Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents over stdio. Point any MCP client at it (`npx -y @real-a11y-dev/mcp`) and an agent can open a page and reason about what assistive tech actually perceives.

  Audit-first: `audit_page` runs the same rule engine as `@real-a11y-dev/testing` (`collectFindings`) and returns every violation — unlabeled controls, skipped heading levels, unlabeled dialogs, broken landmark structure — grouped and with per-instance CSS locators. `inspect_page` returns the findings plus the semantic tree, heading outline, and tab order from ONE extraction, so a multi-view report can't be internally inconsistent on a dynamic page. Perception primitives (`get_semantic_tree`, `get_heading_outline`, `get_tab_order`, `list_elements`) let it stand alone without a separate browser-automation MCP; `open_page` handles navigation, settle waits, and mobile/tablet device emulation.

  Two MCP-only tools cross-check the custom engine against the browser's own tree: `get_native_tree` reads Chromium's authoritative accessibility tree via CDP, and `compare_trees` diffs the two and reports where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs.

  Playwright is a peer dependency, lazily imported, so importing the server API (`buildServer`, types) never requires a browser to be installed. `file://` navigation is refused by default (an LLM-driven local-file exfiltration primitive) unless `REAL_A11Y_MCP_ALLOW_FILE=1`.

- 18dda52: `BrowserSession` can now load an authenticated session and pin the audited origin — the engine half of auditing pages behind a login. `BrowserSessionOptions` gains `storageState` (a Playwright storage-state file path, loaded into every launched context so pages open already authenticated; it survives device-emulation context rebuilds and is rejected together with `cdpEndpoint`) and `allowedOrigins` (when set, extraction is refused unless the page's final post-redirect origin is in the allowlist — the control that stops a redirect from an intended target to a recorded cookie domain from silently auditing an unintended authenticated page). A new `captureStorageState()` method returns the current context's cookies + origin storage for a "save the session" flow. Auth material is always caller-configured, never derived from tool input. The agent-facing MCP server surface (env vars, tool descriptions) is unchanged in this release.

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
  - @real-a11y-dev/testing@0.1.0-beta.10
