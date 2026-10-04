# @real-a11y-dev/inspector

## 0.1.0-beta.18

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

## 0.1.0-beta.17

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

- 4ec846c: feat(core): a node now carries the value a screen reader announces for a field, as `a11y.value`, per ADR-0001 ("Field values: withhold what is sensitive, show what a screen reader reads").

  - **What it holds.** A text field's or rich-text editor's text; a `<select>`'s selected option **label** (`"Spain"`, where the DOM producer's `dom.attributes.value` keeps the raw `"es"`); a range widget's `aria-valuetext`, else `aria-valuenow`; a file input's file names. A checkbox, radio or button has none. Whitespace collapses and a value is capped at 240 characters. An empty field has no value.
  - **Sensitive fields.** A `type="password"` field, or one whose `autocomplete` names a credential or payment field (`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`), reads `"[redacted]"` when it holds anything. The token list is unchanged and is now exported for reuse, with `isSensitiveFieldAttributes` for callers that hold a field's markup but no live element.
  - **Printing it is opt-in.** The tree, tab-sequence, list and diff serializers gain a `values` option, default **off**, so every existing snapshot is byte-identical. With it on, a field prints as `textbox "Email" = "jane@x.com"`, and a diff reports `~ textbox "Search": a11y.value (unset) → "hello"`. In testing: `treeSnapshot(root, { values: true })`, `boxedTreeSnapshot`, the Playwright adapter's `sn.treeSnapshot({ values: true })`, and `a11yDiff(before, after, { values: true })`.
  - **`expectChanges({ exact: true })`** now sees field-value changes, since diffs model them, but never counts a change made only of `a11y.value` as unexpected: typing into a field changes that field, which is the step itself. Assert it explicitly with `changes: ["a11y.value"]`.

  - **A role-less editor is no longer named after what was typed into it.** `<div contenteditable>draft</div>` read `generic "draft"` and now reads an unnamed `generic` whose value is `"draft"`. It stays in the accessibility view as a field, and serializers print it as `generic = "draft"` with `values: true`. Chromium leaves it unnamed too.
  - **Diff views see value changes.** A panel diff (inspector, storybook-addon, extension) now marks a field you typed into as changed.

  A hostile page whose `.value` getter throws no longer costs the field its node; the value is simply absent.

  `cli` and `mcp` re-release the bundled engine; their output is unchanged by this release.

- 38b9859: `onAction` now reports the dispatcher's real `ActionResult` instead of a fabricated `{ success: true }`.

  `createInspector({ onAction })` and `<SemanticNavigator onAction>` have always been typed `(request, result) => void`, but the result was manufactured at the call site: the panel discarded what `ActionDispatcher.dispatch()` returned and reported success unconditionally. A click on a row whose element had left the DOM, a `type` on an element that accepts no text input, or a page handler that threw mid-dispatch — all of them were announced to the consumer as successes. The dispatcher's own result (`{ success: false, error: "Element is disconnected from the document" }` and friends) now reaches the callback, so the values match the signature the docs already describe.

  **Breaking change:** a handler that assumed `result.success` was always `true` will start seeing `false` with an `error` string on actions that genuinely fail. Migration: branch on `result.success` and read `result.error` — the failure was already happening, it just wasn't reported.

  One pre-existing gap this makes visible, worth knowing before you wire the failure branch to a toast: the panel's row button dispatches `{ nodeId, action }` with no payload, so on a text field or a `<select>` the `Type` / `Select` button reports `{ success: false, error: "No value provided for type action" }` **every time**. That action has never actually changed the page from this panel — the panel has no prompt to collect a value — and now it says so instead of claiming success. Treat those two as "not supported from the panel yet" rather than as intermittent failures.

  Unchanged: `onAction` still fires once per dispatched action, and the gated paths (`interactive: false`, and `focus`/`increment`/`decrement` under `focusHostOnActivate: false`) still return before dispatch without invoking it.

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

- 99f4e8c: Stop rebuilding the whole tab sequence on every search keystroke in the tab-sequence view. The tree walk behind `getTabSequence` now sits in its own memo keyed on the nodes, so a keystroke re-runs only this view's filter over the already-computed sequence instead of re-walking the tree. No change to what the view renders.
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

- eccb0b8: Stop the tree panel redoing per-row work on every keystroke.

  Keyboard navigation looked the selected row up with a linear `indexOf` over the whole visible list on each keypress, and ArrowRight scanned that list once per child to find the first visible one — so arrow-key cost grew with the size of the expanded tree. Both now read an id→index map built once per visible list.

  The `aria-controls` jump chips were also rebuilt inside the render loop: every rendered row re-resolved each link's target node and reformatted its label on every render, including renders that only moved the selection. They are now resolved once per tree, so an unchanged row is handed the same chip data across re-renders.

  Rendering is unchanged — same rows, same chips, same navigation.

- e41d5cd: Add a `.sn-native-capability-banner` class (with a dark-mode variant) to the shared tree stylesheet (`@real-a11y-dev/semantic-navigator-ui`'s `tree.css`), replacing an inline-styled banner that ignored the theme. Every consumer of that package bundles `tree.css` as a side effect regardless of which classes it actually renders, so this ships as a changeset even though the banner itself is only ever rendered by the extension's dev-only native-tree view — not by anything `inspector` or `storybook-addon` render today. No visible change for either package; recorded because real bytes ship into both bundles.

## 0.1.0-beta.16

### Minor Changes

- 5b58757: Add `label-title-only`, an axe-aligned warning for form controls whose only label is `title` or `aria-describedby`.

  `no-unlabeled-interactive` still fails only on an empty accessible name — glyph buttons and `title=` on a `<button>` pass, matching axe `button-name`. Placeholder-only inputs are out of scope for the new rule, matching axe. The new id is selectable via `collectFindings` / `--rules` / `audit_page`; `assertNoUnlabeledInteractive` is unchanged.

### Patch Changes

- 2f811cb: Point the close-tab button's focus ring at a custom property that exists. The
  shared `tree.css` these packages bundle styled `.sn-close-tab-btn:focus-visible`
  with `outline: 2px solid var(--sn-focus-ring)`, but no stylesheet in the repo
  ever declared `--sn-focus-ring` — every other `:focus-visible` rule uses
  `--sn-border-focus`. An undefined custom property is invalid at computed-value
  time, so the whole `outline` declaration was discarded and the property fell
  back to `none`, suppressing the browser's own focus ring along with the intended
  one. The control the rule applies to is rendered by the extension's page header,
  so the visible fix lands there, but the broken declaration shipped in every
  bundle of the stylesheet. `tree.css.test.ts` now fails if any `var(--…)` in the
  stylesheet names a property that is declared nowhere and has no fallback.
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

- 43364f5: Internal stylesheet change, no behaviour change for these packages. The shared
  `tree.css` they bundle gains collapse rules for live-region containers that are
  mounted while still empty (`.sn-search-count:empty`, `.sn-live-log:empty`) and
  splits the action-feedback bar's paint onto an inner `.sn-action-feedback-text`
  so its flash still replays. Only the Chrome extension renders those containers
  today, so nothing these packages render changes; the inspector's size budget
  moves 33.5 kB → 33.8 kB to cover the added rules.
- c26c0a1: Fix the row highlight that plays after a cross-link jump. The shared `tree.css`
  these packages bundle declared `@keyframes sn-flash` twice — once as the
  accent-background flash for `.sn-node--flash`, and again further down as the
  slide-up used by the action-feedback bar and the live-announcement log. The last
  declaration of a name wins in CSS, so the row that a cross-link chip jumped to
  translated a full row height up from below over 700ms instead of tinting and
  fading in place. The node flash is now `@keyframes sn-node-flash`, leaving the
  slide-up to its two intended callers.
- 19e0fe8: Stop reporting native HTML as broken ARIA — and let authored ARIA actually be
  satisfied.

  `toBeValidA11yTree()` judged every node by the rules for an authored role.
  `aria-query` genuinely marks `aria-checked` required on checkbox,
  `aria-expanded` + `aria-controls` on combobox and `aria-selected` on option —
  correct when someone wrote `role="combobox"` on a `<div>`, because nothing else
  supplies them. Applied to a `<select>` it produced six violations on markup
  that is not merely valid but preferable, including `option` nested inside
  `combobox`, which is exactly how a `<select>` is built.

  The discriminator is **"does the user agent supply this state?"**, not "did
  somebody type a `role=` attribute". Those diverge on ordinary markup:

  - `<select role="combobox">` is redundant, changes nothing about the browser,
    and design systems produce it by spreading `role` through props.
  - `<input type="checkbox" role="switch">` is the ARIA-APG canonical switch,
    where the role is neither redundant nor deletable — and checkedness is still
    UA-supplied.

  `ValidatedNode` gains `uaSuppliedAttrs` (per-attribute, since an element can
  supply one state and still owe another) governing required attributes, and
  `implicitRole` governing structure. Both are optional and absent fails
  **closed**, so an adapter that cannot inspect the element keeps reporting rather
  than silently disabling the rule.

  Three fixes make authored ARIA satisfiable at all — previously it could not go
  green no matter what the author wrote:

  - Required attributes are now read from the element's recorded attributes when
    the extracted state map doesn't carry them. `aria-controls` and
    `aria-valuenow` live in neither `A11yInfo.states` (a fixed 10-entry set) nor
    `properties` (`{level, captions}`), so a correct authored combobox or slider
    reported a violation with no remedy available.
  - `aria-valuenow` / `aria-valuemin` / `aria-valuemax` are now recorded, for the
    same reason — nothing else carried them.
  - A **`false`** value counts as present, not missing. `aria-expanded="false"` is
    a collapsed combobox and `aria-checked="false"` an unchecked box: the ordinary
    states, and previously unsatisfiable.

  Two more from the same class:

  - **Engine vocabulary is no longer reported as an invalid ARIA role.** A
    `<video controls>` extracts as `video`, which is not in the ARIA role set, and
    the check returned early — so no other rule ran on the node either and a page
    containing a `<video>` could not use the matcher at all. Only an _authored_
    role can be invalid ARIA.
  - **An exempt native pair no longer ends the ancestor walk.** In
    `<div role="button"><select><option>`, the option is legitimately inside its
    select and illegitimately inside the button, which was never tested.

  Real problems are still caught: an unnamed `<select>`, an unnamed `<table>`, a
  link nested inside a button, an authored bogus role, and any hand-built role
  that omits a state no user agent supplies.

  The patch bumps are the three packages that bundle `core`'s **DOM** producer,
  which is what `KEY_ATTRIBUTES` feeds. `cli` and `mcp` build their trees with the
  native producer, which keeps its own attribute allowlist, so they are untouched.

## 0.1.0-beta.15

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

- c8cf5a3: fix(ui): cancel the virtualized tree's pending re-measure frame on teardown. The ResizeObserver defers its re-measure by one `requestAnimationFrame`, and `disconnect()` does not cancel a frame already queued — so in a real browser the callback could still run after the component went away. The frame is now cancelled with the observer. (Test-only companion: every jsdom suite that renders Preact now shares one raf/cancelAnimationFrame setup file, so Preact's own scheduler can't throw after environment teardown.)

## 0.1.0-beta.13

### Patch Changes

- 80d2b02: Halve the tree-search work done per keystroke. `applySearchFilter` ran the match predicate over the whole tree twice — once inside `searchTree` to build the visible set, then again to count the direct matches — so every character typed into the panel's search box paid for the string matching and `Object.entries` allocation of both passes. The two are now collected in one pass, and the loop that writes `ui.matchesFilter` folds the counting in rather than iterating the tree a second time.

  `searchTree`'s ancestor-marking walk also climbed all the way to the root for every match, re-adding ids it had already marked: O(matches × depth) on a deep tree where the matches share a path. It now stops at the first ancestor already in the set, which is one climb per distinct path segment instead of one per match (and terminates rather than spinning if a malformed tree's `parentId` links form a cycle).

  Behaviour is unchanged — same visible set, same direct-match count. This is the extraction/counting cost only; the panel still filters synchronously on each keystroke, with no input debounce.

## 0.1.0-beta.12

### Patch Changes

- 489cd82: Wire `TreeView` to `LiveTreeExtractor` so inspector / `<SemanticNavigator>` live updates re-extract only dirty subtrees. Previously `TreeView` ignored the `DomObserver` `TreeChange` payload and called `extractA11yTree` / `extractDomTree` on every flush — the residual of audit finding #50 after #182 landed the incremental path for the extension, `useSemanticTree`, and the Storybook preview. Each flush now snapshots the result Map so a diff checkpoint baseline cannot be mutated by a later incremental splice. Inspector is re-released because it bundles the UI package (size budget 31 → 32.5 KB gzipped — TreeView now pulls LiveTreeExtractor into the inspector bundle).
- 96aee1f: Preserve the user's tree expand/collapse across live DomObserver updates. `TreeView` (inspector / `<SemanticNavigator>`) and the Storybook manager panel now run `preserveExpandedState` before adopting a new extraction — without it, a11y-mode rebuilds reset every node to the depth heuristic, so a collapse-all (or any deep expand) snapped back on the next host-page mutation. New export: `preserveExpandedState(prev, next)`. Inspector and storybook-addon are re-released because they bundle the UI package (inspector size budget 32.5 → 32.6 KB gzipped).
- 0aa67f4: Let keyboard users decrement sliders/spinbuttons. The ▼/▲ stepper buttons are mouse-only (`tabIndex={-1}`), and Enter always hit `getPrimaryAction` which prefers `increment` — so a keyboard-only panel user could raise a value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter` decrement (tree + form filtered list).
- a67fd38: fix(ui): silence the benign "ResizeObserver loop completed with undelivered notifications" warning from the virtualized tree. The observer's re-measure now defers to a single `requestAnimationFrame`, breaking the synchronous observe→setState→relayout loop that Chromium reports (and which showed up in the extension's Errors panel). No behavior change to virtualization.

## 0.1.0-beta.11

### Patch Changes

- 35e99e6: Fix three ways the embeddable inspector stopped reacting after mount: a floating `<SemanticNavigator>` rendered an **empty panel** when its root ref was already set (the common `{open && <SemanticNavigator floating />}` toggle), `InspectorInstance.setViewMode()` and the `mode` prop left the rendered tree on the old view while `getTree()` already reported the new one, and `useSemanticTree`/`useActiveModal` never attached to a root that mounted after the first commit and kept observing a **replaced** root. `useSemanticTree` and `useActiveModal` now also accept the element itself (new `SemanticTreeTarget` type) — pass an element from a callback ref when the root mounts late or can be swapped; existing ref-object callers are unchanged.
- c9c5076: Stop shipping the stylesheet twice. `__SN_STYLES__` is an esbuild `define`, so **every** occurrence of the identifier was replaced with the entire stylesheet literal at build time — and the inspector read it at two injection sites (shadow root and light DOM). The bundle therefore carried two complete copies of the CSS, which gzip could not fold together because they sit further apart than its window.

  The define is now bound to a module-level constant that both paths read. Behavior is unchanged; the bundle drops by roughly 32 kB raw / 5 kB gzipped.

## 0.1.0-beta.9

### Patch Changes

- Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.

## 0.1.0-beta.8

### Patch Changes

- Re-release to pick up this cycle's `@real-a11y-dev/core` and `@real-a11y-dev/semantic-navigator-ui` fixes, which the inspector bundles at build time (`noExternal`): aria-labelledby-before-aria-label precedence, the accname self-reference cycle guard, name-from-content for named widgets, sensitive-value redaction, accessible-name normalization, and the element-picker button fix. No inspector API changes — the previously published build shipped the older bundled engine.

## 0.1.0-beta.6

### Minor Changes

- 488ca27: Add the DevTools-style element picker to the React inline panel.
  Same UX as the Chrome extension's picker (toolbar `⦿` button +
  `Ctrl/Cmd+Shift+C` shortcut + crosshair cursor + capture-phase
  clicks that `preventDefault` the page handler); when the user
  clicks an element on the host page, the matching tree row is
  selected and scrolled into view.

  Public surface changes:
  - `@real-a11y-dev/core` exports `createPicker(options)` returning
    `{ isEnabled, setEnabled, teardown }`. Moved from
    `@real-a11y-dev/semantic-navigator-extension` (which was private,
    so this is a pure additive export). `SemanticNavigatorConfig`
    gains `enablePicker?: boolean` (default `false`).
  - `@real-a11y-dev/semantic-navigator-ui` — `TreeView`, `TreePanel`,
    and `TreeToolbar` accept `enablePicker` / `pickModeOn` /
    `onTogglePickMode` / `pickedNodeId` / `onPickedNodeHandled`.
    `.sn-pick-btn` styles (shipped earlier with the extension fix in
    PR #81) now have a consumer here too.
  - `@real-a11y-dev/inspector` — `createInspector` reads the new
    `enablePicker` flag from the config and passes it to TreeView.
  - `@real-a11y-dev/react` — `<SemanticNavigator>` gains the matching
    `enablePicker` prop.

  The Chrome extension was already a consumer of `createPicker` and
  now imports it from `@real-a11y-dev/core` instead of its own local
  copy. No behavior change there — same module, same tests, same
  coverage.

  `examples/react-app` flips `enablePicker={true}` so the demo
  surfaces the button. Click `⦿`, hover the page, click any element
  — the panel jumps to the row.
