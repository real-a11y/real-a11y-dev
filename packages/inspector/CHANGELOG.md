# @real-a11y-dev/inspector

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
