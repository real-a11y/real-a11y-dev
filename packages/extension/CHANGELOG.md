# @real-a11y-dev/semantic-navigator-extension

<!--
  Maintained by hand. The extension is `private` and is excluded from
  Changesets (see `ignore` in `.changeset/config.json`), so it gets no
  auto-generated changelog. When you bump the extension's version at
  release time, add the matching entry here. Entries reference the PR that
  landed the change; versions match `package.json`/`public/manifest.json`.

  This file records what reached USERS. Changes confined to the dev-only
  dogfood build (`pnpm build:dogfood`, everything behind the `__DOGFOOD__`
  constant) get NO entry: that code is dead-code-eliminated from the store
  bundle, so an entry here would describe a feature nobody on the listing
  can reach. Those changes are tracked by their PRs and `DOGFOOD.md` — while
  native mode is dogfood-only, a change to what NATIVE mode shows goes in its
  "Native-mode changes not yet in the store" list, even when core's shared
  code made it. Once native mode ships in the store build, its changes come
  back here.
  Anything that changes the shipped bundle does need an entry, even if it
  also touches dogfood code.
-->

## Unreleased

- In DOM mode, a heading, link, button or table cell that holds a `<form>`
  whose field is named `tagName` is no longer dropped from the tree with
  everything in it, and neither is a link in help text a field's
  `aria-describedby` points at when that help text also holds such a form.
  Such a field shadows the form's own `tagName`, and working out the name
  around the form read it and threw. A change in or around such a form also
  updates the tree in place again, instead of rebuilding all of it.
  ([#465](https://github.com/real-a11y/real-a11y-dev/pull/465))

- In DOM mode, focusing a field inside a `<form>` with a control named
  `nodeType`, such as `<input type="hidden" name="nodeType">`, now highlights
  the nearest node above it in the tree, and so does hovering or clicking
  inside one in pick mode. Both highlighted nothing. A form lets a control
  shadow its own properties, so the form's `nodeType` read as that control
  rather than an element's, and the walk up from the field stopped below the
  form. ([#464](https://github.com/real-a11y/real-a11y-dev/pull/464))

- In DOM mode, an `<input>` whose `list` names a `<datalist>` now shows as a
  `combobox` in the tree and the Tab Sequence view, as Chromium's own
  accessibility tree reports it. DOM mode showed a `textbox` (or a
  `searchbox` or `spinbutton`). Changing the input's `list`, or adding or
  removing the datalist it names, updates the tree.
  ([#454](https://github.com/real-a11y/real-a11y-dev/pull/454))

- In DOM mode, image map areas are back in the DOM tree, the Tab Sequence
  view, its copied export and the keyboard bar's Tab. Since Chrome 153 every
  `<area>` is `display: none` by default, and the walk skipped it, although
  Chrome still tabs to it. An area now shows where its `<map>` sits while the
  image using the map is rendered, and is a stop at that place in the page,
  which is where Chrome tabs to it. Hiding the image takes its areas out, and
  showing it again brings them back.
  ([#453](https://github.com/real-a11y/real-a11y-dev/pull/453))

- In DOM mode, a name split across children that render as their own boxes now
  reads with the spaces a screen reader announces instead of one glued word.
  `<button><div>Save</div><div>now</div></button>` shows as `Save now`, where it
  used to show as `Savenow` — in the tree, the Buttons and Forms lists, the Tab
  Sequence view and the copied export. Spacing follows how each child renders, so
  a label built from inline `<span>`s still reads as one word, while a `<br>`, an
  empty block, and a rendered child that lends no text of its own (a form
  control, an `aria-hidden` block) now keep the text around them apart. Spacing
  moves both ways: an inline link or other nested control no longer forces a
  space in where the markup has none, so a cell that read `Tree ( treeSnapshot )`
  now reads `Tree (treeSnapshot)`.
  ([#449](https://github.com/real-a11y/real-a11y-dev/pull/449))

- In DOM mode, a native checkbox, radio, `<select>` or `<summary>` now takes
  its state from what it is, as it does in NATIVE mode, not from an ARIA
  attribute on it. An unchecked `<input type="checkbox" aria-checked="true">`
  showed a `checked` badge, an indeterminate checkbox showed none where
  NATIVE mode shows `mixed`, and a `<select aria-expanded="true">` showed
  `expanded`. Now a checkbox or radio shows its checkedness, and `mixed` when
  indeterminate. A drop-down `<select>` shows `collapsed` until its picker
  opens, and a `<details>`' summary shows `collapsed` or `expanded` as the
  details is, never a `pressed` badge unless a role makes it a button. A radio
  its sibling unchecked, or a "select all" box a script made indeterminate,
  now updates in the tree instead of keeping its old badge. Activating a
  `mixed` checkbox from the panel announces "Click", not a guessed "Checked"
  or "Unchecked", since the click's outcome depends on checkedness that
  `mixed` hides.
  ([#443](https://github.com/real-a11y/real-a11y-dev/pull/443))

- A page with a `<form>` holding a control named `parentElement`, such as
  `<input type="hidden" name="parentElement">`, no longer freezes the tab when
  something inside the form changes. A form lets a control shadow its own
  properties, so the form's parent read as that control, whose parent is the
  form again, and every walk up the page that met such a form went round the
  two forever. DOM mode froze on the first change inside one, hovering inside
  one in pick mode froze, and so did focusing a field in one before the tree
  caught up with it. A form with a `parentNode` control, or an `<img>` named
  `parentNode` anywhere on the page, froze the tab on its next text change.
  Selecting a `<form contenteditable>` holding such a control now moves page
  focus to it, as for any other editor.
  ([#438](https://github.com/real-a11y/real-a11y-dev/pull/438))

- In DOM mode, a `<textarea>`'s markup text no longer shows anywhere but its
  value. That text is the field's default, not what it holds now, and for a
  sensitive field (`autocomplete="one-time-code"`, `cc-number`…) it is the
  secret itself. An unlabeled one was listed by it in the Tab Sequence view
  and the filtered lists; a field named by `aria-labelledby` pointing at one
  took it as its name, and one pointing `aria-describedby` at it as its
  description; and it ran into the text preview of whatever held the field.
  An unlabeled one now lists by its tag, and its value line still shows what
  it holds, `[redacted]` for a sensitive one.
  ([#466](https://github.com/real-a11y/real-a11y-dev/pull/466))

- In DOM mode, a page that names an image or a form control after a DOM
  method no longer costs the tree more than that form. An
  `<img name="getElementById">` anywhere on the page dropped every element
  named through `aria-labelledby` or described through `aria-describedby`, an
  `<img name="querySelector">` every form control with an `id`, and an
  `<img name="querySelectorAll">` stopped DOM mode from building a tree at all.
  A change in or around a `<form>` with a control named `getAttribute`,
  `tagName`, `contains` or another method the live update calls left the tree
  stale, since the update threw; it now rebuilds the tree in full instead.
  ([#437](https://github.com/real-a11y/real-a11y-dev/pull/437))

- In DOM mode, a `<form>` with a field named `getRootNode` is no longer
  dropped from the tree, with everything in it, when `aria-labelledby` names
  it or another field's `aria-describedby` points at it. Such a field shadows
  the form's own `getRootNode()`, so calling it to resolve the reference
  threw and the whole form was skipped.
  ([#439](https://github.com/real-a11y/real-a11y-dev/pull/439))

- In DOM mode, an element's `role` now resolves the way Chromium resolves it.
  An unknown or abstract token is skipped for the next one, or the element's
  own role — `role="foo"` was a `foo` row and is now whatever the element is
  (often a `generic` that folds away), and `role="foo button"` is a `button`
  named by its text. Tokens are read case-insensitively, so `role="BUTTON"`
  is a button. A `listitem`, `option` or `treeitem` outside the list, listbox
  or tree it needs loses its role the same way, and the `<li>`s of a
  `<ul role="none">` leave the tree with their list.
- In DOM mode, ARIA state values now read the way Chromium, and NATIVE mode,
  read them. `aria-disabled="TRUE"`, `aria-pressed="MIXED"` and
  `aria-checked="yes"` had no `disabled`, `mixed` or `checked` badge because
  only the exact lowercase `"true"` counted, and `aria-current="False"`
  showed a `current: False` badge. Now `false` in any case is off, an empty
  value or `undefined` leaves the state unset, `mixed` is mixed where the role
  has it, `aria-current` tokens like `PAGE` read as `page`, and any other
  value is on. Content under `aria-hidden="TRUE"` or `aria-hidden="yes"`
  leaves the tree and the names around it, as `aria-hidden="true"` content
  always did. An `<optgroup>` never shows as disabled, as in Chromium.
  ([#436](https://github.com/real-a11y/real-a11y-dev/pull/436))

- In DOM mode, the A11y view shows a rich-text editor's value the way
  Chromium reports it. `aria-hidden` text inside an editor, or inside any ARIA
  textbox or searchbox, is part of the value Chromium gives a screen reader,
  and so is a popup inside it, but the A11y view left both out: an editor
  holding `Hello <span aria-hidden="true">[x]</span>world` read
  `= "Hello world"`, and now reads `= "Hello [x]world"`. A combobox you can't
  type into still leaves them out, as Chromium does.
  ([#460](https://github.com/real-a11y/real-a11y-dev/pull/460))

- In DOM mode, a `<select>` that shows more than one row, such as
  `<select size="3">`, now shows as a `listbox` in the tree and the Tab
  Sequence view, as Chromium's own accessibility tree reports it. DOM mode
  called every `<select>` without `multiple` a `combobox`. A
  `<select multiple size="1">`, which Chromium renders as a drop-down, now
  shows as a `combobox`. Changing a select's `size` or `multiple` on the page
  updates the tree.
  ([#445](https://github.com/real-a11y/real-a11y-dev/pull/445))

## 0.1.14

### Patch Changes

- In DOM mode, the body of a closed `<details>` no longer shows in the tree,
  the Tab Sequence view, its copied export or the keyboard bar's Tab. Chromium
  renders a closed disclosure as its summary alone and never tabs into the
  rest, but DOM mode listed every link, button and heading in it, and a
  `<details>` nested in it, as NATIVE mode never did. The body appears when
  the `<details>` opens and goes when it closes.
  ([#433](https://github.com/real-a11y/real-a11y-dev/pull/433))

- In DOM mode, an option in a disabled `<select>` or `<optgroup>`, and a
  control inside an `aria-disabled="true"` container, now show as disabled in
  the tree and in the Buttons and Forms lists, as NATIVE mode already showed
  them. In `<div role="group" aria-disabled="true"><button>Quote</button></div>`,
  `Quote` had no `disabled` badge, although Chromium and a screen reader
  treat it as disabled. Only focusable elements take the state from a
  container, rich-text editors included, so a paragraph or heading inside
  one stays as it was, and a disabled `<fieldset>` still passes it to its
  form controls only. A page whose `<form>` has a field named
  `parentElement` or `assignedSlot` no longer hangs the DOM-mode tree when
  the form holds a `<header>` or `<footer>`.
  ([#429](https://github.com/real-a11y/real-a11y-dev/pull/429))

- In DOM mode, a control disabled by its `<fieldset>` now shows as disabled in
  the tree and in the Buttons and Forms lists, as NATIVE mode already
  showed it. In `<fieldset disabled><button>Save</button></fieldset>`, `Save`
  had no `disabled` badge, although Chromium and a screen reader treat it as
  disabled. A control in the fieldset's first `<legend>` stays enabled, as
  HTML defines it.
  ([#425](https://github.com/real-a11y/real-a11y-dev/pull/425))

- In DOM mode, the Tab Sequence view, its copied export and the keyboard bar's
  Tab now stop at the `<summary>` that toggles a `<details>`, as Chromium does,
  so a disclosure or an FAQ accordion question is no longer missing from the
  tab order. Only the first summary of a `<details>` counts. The DOM tree now
  keeps that summary as a node under its `<details>`, where it used to drop it.
  ([#428](https://github.com/real-a11y/real-a11y-dev/pull/428))

- In DOM mode, the Tab Sequence view, its copied export and the keyboard bar's
  Tab now stop where Chromium stops. They used to stop at an `<a>` with no
  `href`, even an `<a role="button">` no keyboard can reach, at a control
  disabled by its `<fieldset>` and at an element with an empty or non-numeric
  `tabindex`, and to skip an `aria-disabled` control, which Chromium does tab
  to.
  ([#423](https://github.com/real-a11y/real-a11y-dev/pull/423))

- The A11y view now shows a field's value the way a screen reader announces
  it, and the DOM view shows the raw DOM value. A `<select>` set to "Spain"
  (`value="es"`) showed no value at all and now reads
  `combobox "Country" = "Spain"` in the A11y view and `<select> value="es"` in
  the DOM view. Values now show on every field that has one, not only text
  fields: a slider shows its `aria-valuetext`, and a progress bar or a
  rich-text editor shows its value. A password, one-time-code or card field
  reads `[redacted]` in both views; the A11y view used to show it as a row of
  bullets. A `<textarea>` no longer shows the text it was loaded with beside
  its value; for a one-time-code field, that text was the code itself. The
  copied Markdown report still leaves values out.
  (ADR-0001) ([#431](https://github.com/real-a11y/real-a11y-dev/pull/431))

- In DOM mode, the Tab Sequence view, its copied export and the keyboard bar's
  Tab now stop at a rich-text editor and skip the links inside it. They used to
  do the reverse: a `contenteditable` message box was left out, and a link typed
  into it was listed under its own text, often a full URL, although Chromium
  can't focus it at all. A mention chip marked `contenteditable="false"` is
  still a stop. A role-less editor shows as `generic` instead of taking what
  was typed into it as its name, and gets a Type action like a text box.
  Selecting any editor moves page focus to it, including one written as
  `contenteditable=""` or `plaintext-only`. A link inside an editor no
  longer offers Click, since Chromium doesn't follow it.
  ([#421](https://github.com/real-a11y/real-a11y-dev/pull/421))

- An element with `role="image"` now shows as an `img` in DOM mode, as NATIVE
  mode already showed it. ARIA 1.3 makes `image` another spelling of `img`, but
  the DOM tree kept the raw role and named the element by its text, so
  `<span role="image">🎉</span>` read `image "🎉"` instead of a bare `img`, and
  the Images filter left it out.
  ([#419](https://github.com/real-a11y/real-a11y-dev/pull/419))

- In DOM mode, a contenteditable editor with no role (a ProseMirror-style
  composer) no longer shows what was typed into it as its name. It read
  `generic "draft text"` and now reads a bare `generic` that stays in the tree
  as a field, as Chromium leaves it unnamed. With a diff baseline captured, a
  field you type into is now marked **changed**, because the tree now records
  each field's value (ADR-0001).
  ([#417](https://github.com/real-a11y/real-a11y-dev/pull/417))

- A dialog, image, landmark or text field no longer shows its loose text as
  its name in DOM mode. `<div role="dialog">Delete this project?
  <button>Cancel</button></div>` has no accessible name, as NATIVE mode and a
  screen reader already reported, and appeared in the tree as
  `dialog "Delete this project?"`. So did a `<nav>`'s "Menu:" label, a
  `<textarea>`'s typed contents and a `<footer>`'s copyright line. Paragraphs,
  list items and live regions (`alert`, `status`) keep their text.
  ([#416](https://github.com/real-a11y/real-a11y-dev/pull/416))

- The copied heading outline and DOM tree now include visually hidden
  ("sr-only") content that screen readers read, the way NATIVE mode already
  did. On a GitHub PR page, the DOM outline was missing GitHub's visually
  hidden `h2 Navigation Menu`. `visibility: hidden` and `aria-hidden` content
  is still left out.
  ([#410](https://github.com/real-a11y/real-a11y-dev/pull/410))

- A heading or button that contains a `<details>` now includes the
  disclosure's summary in its name in DOM mode, matching NATIVE mode. A
  GitHub comment header read "user commented •" instead of "user commented •
  edited by …". Opening or closing the disclosure, or editing its summary,
  updates the name without a refresh.
  ([#409](https://github.com/real-a11y/real-a11y-dev/pull/409))

- Stop telling the extension which page you are on when you are not using it.
  The content script runs in every frame of every page and announces itself at
  load whether or not the side panel is ever opened there; that announce
  carried the frame's URL, which nothing read. It no longer carries anything —
  the background identifies the frame from the sender. Tree extraction was
  already deferred until the panel connects, so a frame you never inspect now
  reports nothing about itself at all.
  ([#407](https://github.com/real-a11y/real-a11y-dev/pull/407))

- Split the role-filtered list (Headings, Links, Buttons, …) into a
  producer-agnostic view, so the dev-only native tree can show the same list.
  The list itself is unchanged, except that a row with no accessible name now
  shows its trimmed text content.
  ([#406](https://github.com/real-a11y/real-a11y-dev/pull/406))

- Make tree keyboard navigation cost the same on a large tree as on a small
  one. Resolving the selected row to a list position was a linear scan of the
  whole visible list, and it happened on every arrow keypress — once inside the
  keyboard hook, again for `aria-activedescendant`, and again in the
  scroll-into-view and reveal effects. ArrowRight was worse still, scanning the
  list once per child to find the first visible one. All of them now read an
  index map built once per list. Navigation behaviour is unchanged.
  ([#402](https://github.com/real-a11y/real-a11y-dev/pull/402))

- Fix an empty tree on pages that keep a closed `aria-modal` drawer mounted.
  The DOM tree treated any visible `aria-modal="true"` element as the open
  modal and scoped to it alone, so a closed mobile nav, hidden with
  `aria-hidden` and moved off-screen, left the panel showing nothing (seen on
  events.tinder.com). Modality now follows Chromium's own tree: only a
  `<dialog>` opened with `showModal()` hides the page behind it. A cookie bar
  marked `aria-modal` no longer takes over an interactive page either. It
  appears alongside the page instead. ([#398])

- The DOM view now shows what's inside web components. Content in an open
  shadow root appears under its custom element, and slotted children appear
  where the component places them. Before, a Lit or Shoelace control, or the
  Skip To button on the W3C APG pages, showed up as an empty element.
  Closed shadow roots still can't be read. The panel doesn't yet refresh by
  itself when something changes inside a component; press refresh to pick it
  up. ([#389])

- Stop a tree action from silently cancelling pick mode and selecting the
  wrong node. While the picker is armed it holds the page's pointer events:
  its capture-phase listeners swallowed the dispatcher's whole synthetic
  `pointerdown`→`click` sequence, so the action never reached the page — and
  then that click landed on the picker's own handler, which resolved the
  actioned element, reported it as a pick the user never made, and dropped out
  of pick mode. The panel jumped its selection to that node and the ⦿ button
  snapped off, while the page was left untouched and the status bar still read
  "Click: …". Such an action is now refused outright, and the panel says why.

  Only what actually collides with the picker is refused — `click` and
  `navigate`, the two that go through the pointer sequence. Typing, selecting,
  focusing, submitting, scrolling, `toggle` on a `<details>` and the ▼/▲
  steppers never touch a pointer event and keep working while pick mode is on,
  as they always did. So does the key bar: Escape is the one key the picker
  reacts to, and leaving pick mode is a fair reading of Escape. The Screen
  Curtain gates none of it — driving the page from the panel while it is
  hidden is what the curtain is for. ([#399])

- Leave pick mode in every frame once any frame leaves it, not just the one
  that did. A picker exits in its own document — on a pick, on a click that
  hit nothing tracked, and on Escape — so leaving pick mode inside an iframe
  left the top frame armed and swallowing clicks while the panel's ⦿ button,
  which is per-tab, already read off, with no enabled control to switch back
  off. ([#399])

- Stop one action's feedback from wiping another's. Every message in the
  panel's status bar armed its own timer to clear the bar, and none of them
  cancelled the others, so whichever timer came due first blanked whatever
  the bar was showing by then — a "Click: Save" from two seconds ago erasing
  a failure raised one second ago. The bar now keeps a single pending clear,
  belonging to the message actually on screen. ([#399])

- Collect `.tsx` test suites. The vitest `include` was `src/**/*.test.ts`, so a
  suite written as `.tsx` was never picked up — and silently: vitest ran the
  files it matched, reported them green, and said nothing about the one it
  walked past. The panel is Preact and its components are `.tsx`, so every UI
  test here had been written with `h()` calls to stay inside a `.ts` file.
  The pattern now matches `ui`, `inspector`, `react` and `storybook-addon`,
  with the automatic JSX runtime configured alongside it. No shipped code
  changes — the extension builds from `vite.config.ts`, which never read this.
  ([#380])

- Internal, no behaviour change: the background message router now leaves
  `NATIVE_*` messages to the dev-only native listener instead of letting them
  reach its catch-all fallback. The store build never sends such a message, so
  nothing user-facing changes — recorded here only because the guard is real
  code in the shipped bundle rather than dogfood-only
  ([#229](https://github.com/real-a11y/real-a11y-dev/pull/229)).

## 0.1.13

### Patch Changes

- Name a `<table>` from its `<caption>` when the caption is visible and
  non-empty, matching HTML-AAM. Hidden captions no longer silence the
  unnamed-table violation, and a caption that did not supply the name (because
  `aria-label` already did) stays in the tree. A click on a node whose element
  has been detached now fails instead of reporting success. ([#357])

- Give the page header's close-tab button back its keyboard focus ring. Its
  `:focus-visible` rule painted `outline: 2px solid var(--sn-focus-ring)`, and
  no stylesheet declares `--sn-focus-ring` — every other focus rule uses
  `--sn-border-focus`. An undefined custom property is invalid at
  computed-value time, so the `outline` declaration was discarded and fell back
  to `none`, suppressing the browser's own ring as well. Keyboard users had no
  indication the ✕ was focused. ([#356])

- Fix the row highlight that plays after a cross-link jump. The shared
  `tree.css` declared `@keyframes sn-flash` twice — once as the accent-background
  flash for `.sn-node--flash`, and again further down as the slide-up used by the
  action-feedback bar and the live-announcement log. The last declaration of a
  name wins in CSS, so the jumped-to row translated a full row height up from
  below over 700ms instead of tinting and fading in place. The node flash is now
  `@keyframes sn-node-flash`, leaving the slide-up to its two intended callers.
  ([#354])

- Announce the panel's own live regions. The search match count, the action
  feedback bar and the relayed live-announcement log were each mounted
  together with the text they were meant to announce, and a live region has to
  already be in the accessibility tree when its contents change — one that
  enters the DOM with its text inside it is not announced by most screen
  reader / browser pairs. So the panel whose whole job is surfacing a page's
  live regions was silently dropping all three of its own. All three
  containers now stay mounted and only their contents swap. The action bar's
  paint and its flash move to an inner element that mounts with the text, so
  the flash still replays per message rather than firing once at start-up, and
  the containers collapse to nothing while empty — including cancelling the
  toolbar gap the empty match count would otherwise still earn. ([#350])

- Make the inline input panel usable from the keyboard and from a screen
  reader. Its text field had no accessible name of its own — the visible label
  was never associated with it, so the only name was whatever placeholder the
  page happened to supply, and fields without one announced as a bare "edit
  text". Neither the text nor the select variant claimed `aria-modal`, and Tab
  really did walk out of the dialog into the toolbar rendered behind it. And
  because submit and cancel unmount the panel while it still holds focus, DOM
  focus fell to `<body>`, leaving a keyboard user to Tab back from the top of
  the panel. The label is associated with the field, both variants are modal
  and hold Tab inside — including when focus has fallen out onto the panel's
  own non-focusable padding — and closing the panel returns focus to whatever
  opened it. ([#343])

- Stop the DOM/A11Y/TAB toggle wiping the panel. Switching view mode ran the
  teardown written for tab switches, so every toggle dropped the tree, the
  selection and the scope and showed "Connecting to page…" until the
  re-extraction arrived — and it arrived without any of them, because the
  state-preserving merge reads the previous tree and that had just been
  emptied. Only a tab change tears the panel down now; a mode switch tells the
  content script to re-extract and the new tree replaces the old one in place,
  keeping expand/collapse, selection and scope wherever the two views agree on
  a node. Where they don't — a generic wrapper selected in DOM view is not in
  the a11y tree — the selection is dropped rather than left pointing at
  nothing, which is what used to leave the tree ignoring every arrow key.
  ([#334])

## 0.1.12

### Patch Changes

- Stop the panel sitting on "Connecting to page…" forever on pages where
  Chrome does not allow a content script — `chrome://` pages (the default
  new-tab page among them), the Chrome Web Store, and the built-in PDF
  viewer. The background answered every `REQUEST_TREE` with `success: true`
  before Chrome had run the send callback, so a broadcast that reached no
  frame at all was reported as delivered; the panel's only other signal is a
  tree arriving, which on those pages never happens, and the wait read as a
  bug rather than a platform restriction. The background now answers from
  inside the callback and reports `restricted-page` when the send found no
  receiver, and the panel renders that as "This page can't be inspected"
  with a **Try again** button — kept live because the same reply comes back
  for a content script that has not finished loading. Only a "receiving end
  does not exist" error is reported that way: a `lastError` for a tab that no
  longer exists stays a plain failure, so a re-extract queued just before the
  user closed the tab cannot claim the page was restricted. ([#322])

- Stop the panel showing the previous page's tree after you navigate. A tree
  only ever reached the panel because some frame announced one, so
  navigating to a page that can run no content script — the Web Store, a
  PDF, a `chrome://` page — left the tree you were last looking at on screen
  indefinitely. That is worse than an empty panel: node ids are a per-frame
  counter, so its rows resolve to unrelated elements on the new page and stay
  clickable. Every top-frame navigation now tells the panel to drop what it
  holds; an ordinary page repopulates it within moments, and one that cannot
  offers **Load tree**, which says so. ([#322])
- Stop the panel waiting on "Connecting to page…" forever after Chrome has
  restarted the extension's service worker. The merge that publishes a tree
  refused to run without a connected side-panel port — which a worker revived
  by the panel's own request does not yet have — so the tree the content
  script sent back was recorded and never delivered, and nothing retried,
  because a content script re-announces only when its own DOM next mutates. A
  request the panel itself sent is now proof enough of a panel to answer it. ([#322])
- Give each `<iframe>` on a page its own subtree when several embed the same
  document. Matching a frame to its `<iframe>` compared urls with the query
  string stripped and never recorded which iframes were already spoken for, so
  the usual shape of a repeated embed — ad units, consent frames and social
  widgets differing only by `?id=1` / `?id=2`, or by nothing at all — had every
  frame match the FIRST such iframe and pile in under it, while the second
  iframe rendered empty. Matching now tries the url with its query string
  before falling back to the query-stripped comparison, and an `<iframe>` a
  frame has attached under is no longer offered to any other frame, in the
  fallback pass as well as the url ones. Frames Chrome still reports pick
  their `<iframe>` first, so a page that swaps an embed for an equal-address
  one — an ad refresh, a widget re-mount — shows the live document rather than
  the tree left behind by the one it replaced. ([#324])

## 0.1.11

### Patch Changes

- Stop the panel opening an unrelated subtree when focus moves inside an
  iframe. Focus and picker events reached the panel twice — once straight
  from the frame, once relayed by the background with the node id prefixed by
  its frame — and only the relayed id is addressable in the merged tree. The
  direct copy's frame-local `sn-<n>` resolved to a different top-frame node,
  which the panel selected and force-expanded before the relayed copy put the
  selection right; the expansions stayed behind. The panel now ignores the
  direct copy. ([#317])
- Stop iframe content from vanishing from the panel after Chrome restarts the
  extension's service worker. The worker keeps each tab's per-frame trees in
  memory, so a restart loses them — and the page's content scripts, still
  loaded and still observing, re-announce only when their own DOM next
  mutates. The first frame to do so was merged on its own, replacing the
  panel's complete tree with one missing every iframe subtree until each
  other frame happened to change. Once per tab, the background now compares
  the frames Chrome reports against the trees it holds and asks any frame it
  is missing — and could actually be running a content script — to
  re-announce, so the panel is whole again a moment later instead of after an
  arbitrary edit. ([#315])

## 0.1.10

### Patch Changes

- Halve the work the panel's search box does per keystroke. Filtering ran the
  match predicate over the whole tree twice — once to decide what stays
  visible, once to count the matches — and re-climbed to the root for every
  match when marking ancestor paths. Both are now a single pass. The results
  are identical; there is just less to do between the keypress and the
  redraw. ([#308])

## 0.1.9

### Patch Changes

- Let keyboard users lower a slider or spinbutton from the panel. The ▼/▲
  stepper buttons are mouse-only, and Enter always took the widget's primary
  action — which prefers `increment` — so a keyboard-only user could raise a
  value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter`
  decrement, in both the tree and the role-filtered lists. ([#248])
- Stop the "ResizeObserver loop completed with undelivered notifications"
  warning appearing in the extension's Errors panel. The virtualized tree's
  re-measure now defers to a single animation frame, breaking the synchronous
  observe → setState → relayout loop Chromium reports. Benign before, but it
  buried real errors. No change to how virtualization behaves. ([#244])
- Fix the element picker activating the widget you were trying to inspect.
  Pick mode cancelled only the `click`, so everything leading up to it still
  reached the page — dropdown triggers open on `pointerdown`, focus moves on
  `mousedown` — and picking a menu button opened its menu. The whole pointer
  sequence is now suppressed while the picker is on, the way Chrome's own
  inspect mode behaves. ([#287])

## 0.1.8

### Patch Changes

- Add **type-ahead** to the tree and the role-filtered lists: start typing a
  role or accessible name and the selection jumps to the next matching row,
  the way a screen reader's list navigation lets you skip ahead. Typing is
  buffered briefly so multi-character prefixes match, and it never steals the
  inline text-entry box open for a focused field. ([#213])
- Virtualize the tree panel's rendering so only the rows in view mount to the
  DOM. Large pages (thousands of nodes) now scroll and update smoothly instead
  of janking as the whole tree re-rendered on every change. ([#195])
- Fix nested iframes disappearing from the tree when a nested frame's
  content script announced before its parent's. Child frames are now
  merged parent-first, so a grandchild frame's subtree is always attached
  under its parent iframe regardless of announce order. ([#151])
- Refresh the side panel when a page is restored from the back/forward
  cache. Previously, pressing Back left the panel showing the page you
  navigated away from — and because node ids are reused across pages,
  clicking a row could fire an action on the wrong element on the restored
  page. The panel now re-syncs to the restored page. ([#161])
- Clean up the panel's on-page state on **every** tab when the side panel
  closes, not just the active one. Previously a background tab kept its
  screen curtain (with no UI to dismiss it) and kept drawing focus overlays
  after the panel was gone. ([#168])
- Open the panel's inline text-entry box for **custom contenteditable text
  widgets** — an ARIA `textbox`/`combobox`/`searchbox` built as a
  `contenteditable` `<div>` (Slack's message box and search, Notion, Google
  Docs, and other Quill/ProseMirror/Lexical editors). Double-clicking one
  previously did nothing because the field-state read only understood native
  `<input>`/`<textarea>`/`<select>`; it now also reads contenteditable hosts
  (current text via `textContent`, never revealing a secret). Note the
  actual text insertion into model-driven editors remains best-effort — see
  `ActionDispatcher`. ([#178])
- Keep the panel's tree in sync incrementally instead of re-walking the whole
  page on every DOM change. Typing into a field or a small widget update now
  re-extracts only the affected subtree, which keeps the panel responsive on
  large pages. Changes that can move what the tree is scoped to — a modal
  opening or closing, a portal mounting — still fall back to a full
  re-extraction, so the panel keeps matching what a screen reader sees.
  ([#182])

- Add a **Load tree** button to the "Connecting to page…" screen. Switching
  tabs clears the tree and drops the panel into that disconnected state, but
  the toolbar's refresh button only renders in the connected UI — so the
  documented recovery path was unreachable and the panel healed only if the
  new page happened to mutate its DOM (or you reloaded it). ([#192])
- Stop hovering panel rows from scrolling the page and moving real focus.
  Hover and selection shared one `HIGHLIGHT_NODE` message, so sweeping the
  pointer down the tree scroll-jumped the host page and fired its own
  focus/blur handlers — flyout menus, validation — once per row crossed.
  Hover is now a preview: overlay only, no scroll, no focus change. Click and
  arrow-key selection still scroll to and focus the element. ([#192])

- Make the panel's four keyboard-navigable lists announce their active row
  to screen readers. The tree, the filtered-role list, the tab-sequence view,
  and the select picker all keep DOM focus on the `role="tree"`/`"listbox"`
  container while arrow keys move an `aria-selected` highlight between
  non-focusable rows — but without `aria-activedescendant` a screen reader
  never learns which row is active, so arrowing announced nothing. Each row
  now has a stable id and its container points `aria-activedescendant` at it.
  ([#194])

## 0.1.7

### Patch Changes

- Validate the sender of every runtime message so the content-script
  handlers only act on messages from this extension's own contexts. ([#127])
- Extract and observe the page only while the side panel is connected,
  so a tab whose panel was never opened does no extraction work. ([#120])

## 0.1.6

### Patch Changes

- Maintenance release: picks up updated `@real-a11y-dev/core` and
  `@real-a11y-dev/semantic-navigator-ui` engines. No extension-specific
  changes.

## 0.1.5

### Minor Changes

- Copy the accessibility tree to the clipboard as Markdown from the side
  panel. ([#102])

### Patch Changes

- Redact sensitive form-field values (e.g. password and other secret-
  bearing inputs) at the extraction source, so they never reach the panel
  or any export. ([#103])

## 0.1.4

### Minor Changes

- Add a DevTools-style element picker: the toolbar `⦿` button (or
  `Ctrl`/`Cmd`+`Shift`+`C`) turns on a crosshair; clicking an element on the
  page selects and scrolls to its row in the tree. ([#81])

## 0.1.3

Earlier releases predate this changelog.

[#81]: https://github.com/real-a11y/real-a11y-dev/pull/81
[#102]: https://github.com/real-a11y/real-a11y-dev/pull/102
[#103]: https://github.com/real-a11y/real-a11y-dev/pull/103
[#120]: https://github.com/real-a11y/real-a11y-dev/pull/120
[#127]: https://github.com/real-a11y/real-a11y-dev/pull/127
[#151]: https://github.com/real-a11y/real-a11y-dev/pull/151
[#161]: https://github.com/real-a11y/real-a11y-dev/pull/161
[#168]: https://github.com/real-a11y/real-a11y-dev/pull/168
[#178]: https://github.com/real-a11y/real-a11y-dev/pull/178
[#182]: https://github.com/real-a11y/real-a11y-dev/pull/182
[#192]: https://github.com/real-a11y/real-a11y-dev/pull/192
[#194]: https://github.com/real-a11y/real-a11y-dev/pull/194
[#195]: https://github.com/real-a11y/real-a11y-dev/pull/195
[#213]: https://github.com/real-a11y/real-a11y-dev/pull/213
[#244]: https://github.com/real-a11y/real-a11y-dev/pull/244
[#248]: https://github.com/real-a11y/real-a11y-dev/pull/248
[#287]: https://github.com/real-a11y/real-a11y-dev/pull/287
[#308]: https://github.com/real-a11y/real-a11y-dev/pull/308
[#315]: https://github.com/real-a11y/real-a11y-dev/pull/315
[#317]: https://github.com/real-a11y/real-a11y-dev/pull/317
[#322]: https://github.com/real-a11y/real-a11y-dev/pull/322
[#324]: https://github.com/real-a11y/real-a11y-dev/pull/324
[#334]: https://github.com/real-a11y/real-a11y-dev/pull/334
[#343]: https://github.com/real-a11y/real-a11y-dev/pull/343
[#350]: https://github.com/real-a11y/real-a11y-dev/pull/350
[#354]: https://github.com/real-a11y/real-a11y-dev/pull/354
[#356]: https://github.com/real-a11y/real-a11y-dev/pull/356
[#380]: https://github.com/real-a11y/real-a11y-dev/pull/380
[#389]: https://github.com/real-a11y/real-a11y-dev/pull/389
[#398]: https://github.com/real-a11y/real-a11y-dev/pull/398
[#399]: https://github.com/real-a11y/real-a11y-dev/pull/399
