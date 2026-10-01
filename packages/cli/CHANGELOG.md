# @real-a11y-dev/cli

## 0.1.0-beta.7

### Minor Changes

- 14e07af: **Breaking: the CLI now requires Node.js 22.12 or newer** (`engines` was `>=20`).

  The CLI advertised Node 20, but `real-a11y install` downloads Chrome through `@puppeteer/browsers`, whose current major needs Node 22.12. So installing the CLI on Node 20 always printed `EBADENGINE Unsupported engine: @puppeteer/browsers@3.x`, which read like a broken install while everything actually worked.

  Pinning `@puppeteer/browsers` back to 2.x would have silenced it, but 2.x depends on `extract-zip ≤ 2.0.1`, which has two high-severity path-traversal advisories and no fixed release. Every project installing the CLI would then see three high-severity findings in `npm audit`. The 3.x line dropped that dependency. Node 20 reached end-of-life in April 2026, so the floor now says what the CLI actually needs.

  On Node 20, npm now warns about `@real-a11y-dev/cli` itself rather than one of its dependencies. Upgrade to Node 22.12+ (or 24) to clear it.

  A new test fails the build whenever any package the CLI installs requires a newer Node than the CLI's own `engines` floor, so this mismatch can't come back quietly with a future dependency bump.

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

- 17ddb23: Name the failure when a page can't be opened, instead of always suggesting timeout flags.

  Every failed navigation used to end with the same hint — `is the server running? Try --wait-until domcontentloaded or --timeout 60000.` That's advice for a page that loads too slowly, and it's wrong for the failures people actually hit: a hostname that doesn't resolve, or a port Chrome refuses outright. The exit code was right; the hint sent you to tune timeouts rather than fix the URL.

  Chromium's `net::ERR_*` errors now get hints that say what happened: DNS failure, unsafe port, connection refused, an unreachable network or proxy, a rejected TLS certificate, a redirect loop, and a connection closed without a response. A genuine timeout — and anything unrecognised — still gets the `--wait-until` / `--timeout` advice.

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

### Patch Changes

- 3099876: Stop claiming the `latest` dist-tag is unpublished.

  The README and website Prerequisites said an unpinned `@real-a11y-dev/cli`
  resolves `latest` and fails with "No matching version found." Both `latest` and
  `beta` have pointed at the current prerelease since D1's pre-mode rule — measured
  on 0.1.0-beta.5. Pinning `@beta` is still the right advice; saying the tag does
  not exist is not.

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

- 87a7244: `audit` now honors each URL entry's `rootSelector`, and `audit` and `snapshot` derive a page's `name` identically — so the same configured route fingerprints the same way whichever command produced the artifact.

  **`rootSelector` scopes the audit.** `resolveAuditTargets` collapsed every config page down to `{ url, name, fileApproved }`, discarding both `rootSelector` and `name`. A route configured with `"rootSelector": "main"` was audited at `body` anyway and reported findings from outside the region it was scoped to — a site-wide header link, say. An explicit `--root` still wins, since it's a deliberate override for that run; omit it and each route uses its own selector. `--producer native` combined with a config `rootSelector` is now a hard error with the same wording as `--producer native --root`, rather than silently auditing the whole document.

  **One page name, settled once.** The name is the `v1` fingerprint's page component and `diff`'s join key, but the two commands derived it differently: `audit` re-derived it with `redactUrl`, while `snapshot` used the config value raw. A bare entry like `"http://localhost:3000"` therefore became `http://localhost:3000/` under `audit` and `http://localhost:3000` under `snapshot` — divergent fingerprints for one route. `resolvePageList` now settles the name once, at the single point both commands read their pages from.

  One divergence remains and is unchanged by this release: `snapshot` honors neither `--root` nor `defaults.root`, so a route with no `rootSelector` is snapshotted at `body` while `audit` scopes it to `defaults.root` if you set one. Give a route its own `rootSelector` when you need the two commands to agree on it.

  **Breaking:** for `urls` entries written as bare URL strings, the page `name` in a snapshot artifact is now the canonical URL (`http://localhost:3000/`, trailing slash) instead of the string as written. Since `name` feeds every finding fingerprint and `diff` joins on it, a baseline or committed artifact produced by an older version won't match one produced by this release for those routes — re-record it with `--update-baseline`. Entries with an explicit `name` are unaffected.

  **Security:** a name that defaulted to the URL is now redacted the same way the `url` field always was. Previously a positional or bare-string target carrying userinfo or a `?token=` wrote those credentials into the artifact's `name` field and the baseline, beside a carefully redacted `url`.

- 823d1cc: `real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

  ```sh
  real-a11y install                           # latest Stable
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # pin an exact build
  ```

  This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

  The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

  `@real-a11y-dev/browser` gains `executablePath` on `BrowserSessionOptions`, plus `resolveChromeExecutable`/`readChromeManifest`/`chromeCacheDir` for anyone building their own installer or launch wiring. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.

- 4e3c10a: `real-a11y interact` — drive a page, then see what it changed for a screen reader. Plus one-step sugar verbs `click`, `type`, and `focus`.

  A page audited as it loads never shows the dialog, the expanded menu, or the validation error. `interact` runs steps against a live page and prints the accessibility-tree diff they produced:

  ```sh
  real-a11y interact http://localhost:3000 --step 'click button "Open menu"'
  # + link "Alpha"
  # + navigation "Main"
  # ~ button "Open menu": a11y.states.expanded false → true
  # ~ main: childIds 1 child → 2 children
  ```

  Steps are written in the vocabulary the tree already prints — `<verb> <role> ["<name>"] [nth=<n>] [= <text>]`, verbs `click | type | focus` — so a line of `real-a11y tree` output is nearly a step already. `--step` is repeatable and ordered, stopping at the first failure. Omit the name to match any; pass `""` to target the unlabeled control an audit just flagged. The one-step cases have sugar: `real-a11y click <url> --role button --name "Save" --nth 2`, and likewise `type` (with `--text`) and `focus`.

  Targeting is **role + accessible name only**, resolved against Chromium's own accessibility tree immediately before each dispatch — never a CSS selector, and no node id ever reaches the command line. If a control can't be reached that way, assistive technology can't reach it either, and that is surfaced as the accessibility finding it is. Ambiguous matches list their copy-paste `nth=` candidates; a disabled target is refused with the cause, because a swallowed click plus an empty diff reads as "that button does nothing" rather than "you can't click it".

  Targeting, acting, and the diff all read the same tree — Chromium's own, over CDP — so a node you aim at by one name can't come back in the report under another. That tree is whole-document, so these commands take neither `--producer` nor `--root`, rather than accepting flags they'd ignore. A step that loads a new document (a navigation, or a reload) leaves the captured tree describing a page that no longer exists; the run reports that, says where it landed, and still exits `0`.

  A typed value is never echoed — not in progress output, not in `--format json`, where the step renders as `= ‹hidden›`. There is deliberately no credential workflow here: a password on the command line is visible to other processes and lands in shell history, so `real-a11y login` remains the way to authenticate.

  The JSON envelope gains three additive optional fields on a page: `steps` (rendered, redacted), `diff`, and `navigated` — the last so a consumer can tell that a step loaded a new document (so there is no diff) without string-matching the diff prose. `url` is re-read after the steps run, so it reports where the page LANDED rather than where the run opened it. Chromium only.

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

- 7e85937: Session daemon core: a long-lived `real-a11y` process that keeps a browser page warm across CLI invocations.

  The daemon (`packages/cli/src/daemon/entry.ts` → `dist/daemon/entry.js`) listens on a Unix domain socket and speaks NDJSON RPC. It holds a `SessionRegistry` of named `BrowserSession` instances, serialises commands per session, supports an idle timeout, and writes a pidfile on startup.

  Initial daemon-side command runners are wired for the view and interaction commands: `tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, and `focus`. Each runner compares the session's current URL and skips navigation when already on the target page, so successive requests against the same session reuse the live page. `audit` and `snapshot` daemon runners follow in a later PR.

- 37f5859: Session daemon lifecycle and hardening.

  - Adds `real-a11y session list|stop|stop-all` to inspect and terminate daemon sessions.
  - `--session-idle-timeout <ms>` caps how long a daemon stays warm (default 15 min, max 1 hour) and resets after each run.
  - Session names are sanitized and stored per-user under `~/.real-a11y/sessions/`, with `0o600` Unix sockets or Windows named pipes with a random per-session name (`\\.\pipe\real-a11y-<id>`; the id is independent of the auth token, which is still required on every RPC).
  - Orphan cleanup: stale pidfiles/sockets are detected and removed by `list`/`stop`/`stop-all`; a CLI version/protocol handshake auto-restarts incompatible daemons.
  - Daemon log is written to `~/.real-a11y/sessions/<name>/daemon.log`.
  - `snapshot` and `audit` are now routed through the daemon and reuse the live page when the current URL already matches the target.
  - `--storage-state` now origin-pins `snapshot` the same way it already pinned `audit` and `inspect`; use `--audit-origin` if you need to allow additional origins.

- aa32b98: Add `--session` routing so browser-driving CLI commands reuse the session daemon.

  Any browser-driving command (`tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, `focus`, `inspect`, `audit`) accepts `--session <name>`. The first such run spawns a detached daemon listening on a Unix domain socket under `~/.real-a11y/sessions/<name>/daemon.sock`; later runs with the same name connect to it and act on the same live page. Without `--session` the one-shot default is unchanged.

  The session name resolves as explicit `--session` → `a11y.config.json` `defaults.session` → a stable hash of the current working directory. `snapshot` declares `--session` but is not yet routed to the daemon in this release.

- f834cfa: `--step-settle` — give a step's effect time to land before reading the page.

  A dispatch returning is not the same as its effect having landed. A React state update flushes on a later tick, a dialog mounts on the next frame, and an immediate read reports "no changes" for a click that plainly did something:

  ```
  setTimeout(() => location.href = "/b", 300)   # a deferred navigation
  act() returned after 8ms
  read done at 17ms  ->  diff: (no changes)     # the page was about to navigate
  ```

  `--step-settle <ms>` (default `200`, the same debounce `@real-a11y-dev/testing`'s `flow()` already settled on) waits after **each** step, so it gates the next step's targeting as much as the final diff — a step that opens a menu has to have opened it before the step that clicks an item can resolve that item against a fresh tree. `0` opts out and reads immediately; `stepSettleMs` sets it project-wide, beside `settleMs`.

  Deliberately separate from `--settle`, which waits once after the initial page load — conflating them would make one number serve two unrelated jobs, and `--settle`'s default of `0` is right for its job and wrong for this one.

  It is a **heuristic wait, not a synchronisation point**. Nothing can tell you a page is _about_ to navigate, so a reaction landing later than the settle still won't appear, and "no changes" is never proof that nothing happened. A synchronous navigation was never affected either way: the dispatch already blocks until it commits.

- 759c1a1: feat(cli): --verbose says where the config came from

  Config auto-discovery stats `./a11y.config.json` in the directory you run from and
  nowhere else — no upward walk, which is deliberate for v1. The consequence is a
  quiet one: run from a subdirectory and you get no config, every default reverts to
  its built-in, and nothing says so. The config is right there on disk, so the
  natural conclusion is that config defaults don't work.

  `--verbose` now prints one line before anything depends on it:

  ```
  config: /work/app/a11y.config.json (auto-discovered)
  config: /work/app/custom.json (from --config)
  config: skipped (--no-config); built-in defaults only
  config: none found — looked for /work/app/nested/a11y.config.json
    auto-discovery checks the directory you run from and does not walk upward, so a
    config in a parent directory is not picked up. Pass --config <file> to name one.
  ```

  Paths are absolute deliberately. The failure this exists for is a config that is
  real but not where the command ran from, and `a11y.config.json` is what the user
  already believes they have — a relative path would add nothing.

  The `none found` line carries three things because each answers a different
  question: which path was checked, why checking elsewhere won't help, and what to
  do instead. Knowing the path alone doesn't tell you that no other path ever will
  be searched.

  Behaviour is unchanged without `--verbose`, and discovery itself is untouched — an
  upward walk to the git root would change documented behaviour and is a separate
  call.

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

- 0cf3860: Internal restructure: the daemon's `SessionRegistry` moved into the private workspace package `@real-a11y-dev/session-registry` (bundled into the CLI dist), so the upcoming MCP session support can embed the identical scheduling, identity-pinning, and idle-timeout semantics. No behavior change — the registry code, its tests, and the daemon E2E suite are unchanged apart from the package boundary and consumer-neutral error types.
- 8cc6078: fix: `FlagValues` admits the array values `parseArgs` actually produces

  `FlagValues` was `Record<string, string | boolean | undefined>`, but three flags
  are declared `multiple: true` — `--audit-origin`, `--step` and
  `--ignore-view-line` — so `node:util.parseArgs` hands back a `string[]` for them
  and always has.

  Nothing misbehaved at runtime, because the commands already guard with
  `Array.isArray(...)`. The cost was to the type: those guards read as dead code
  to both a reader and the compiler while being the branch that actually fires,
  and one call site had already been patched by hand to accept `string[]` locally.
  `FlagValue` is now a named alias carrying the array arm, used by every parser
  helper.

  The type was wrong for as long as it existed because the files that pass real
  array values — the tests — were excluded from typechecking.

- fea46b0: Declare each command's producer support once, on the command table.

  Which commands accept `--producer native` was recorded in three places that could disagree: a `supportsNative` boolean passed in at each of five `producerOf` call sites, a hand-written `"native works with: audit, tree, outline"` list inside the refusal hint, and the Producer column in the docs. The hint's list is the one that had already drifted — it is offered to someone who just hit a refusal, so a stale entry sends them at a command that will refuse them too.

  `CommandSpec` now carries `producers` (and `group`, the command reference's section). `producerOf` reads support from the table instead of taking it as an argument, and builds the hint's alternatives from the same place — filtered to commands that both support native and actually expose `--producer`, so the act commands (native-only, no such flag) are never suggested as somewhere to pass it.

  No behavior change: the same commands accept native, and the hint reads the same today. It just can't fall out of step tomorrow.

  **Superseded in this same release.** `--producer` was removed entirely — each surface now has exactly one correct producer, so there is nothing to choose and no refusal hint to keep current. `producers` and `group` outlive the flag: `producers` became a description of which producer a command _reads_ (still the fact that decides whether `--root` applies, and still what `docs/surface.json` publishes), and deriving it from the table rather than a hand-written list is what kept that removal honest.

- adeffcf: `snapshot` now rejects a typed `--root` instead of silently ignoring it.

  `snapshot` scopes each page by that page's `urls[].rootSelector` — that's what
  makes its artifact a faithful record of the config, and what keeps two snapshots
  of the same route comparable. It never read `--root`, but it accepted the flag
  and dropped it, exiting 0 with an artifact whose `v1:` fingerprints looked like
  they came from a scope that was never applied. It now errors (exit 2) and points
  at `urls[].rootSelector`, or `audit --root` for a one-off scoped run.

  A project-wide `defaults.root` is unaffected: it's config aimed at `audit`, not
  an instruction for this run, so `snapshot` still ignores it silently rather than
  failing every run. `snapshot --help` no longer lists `--root`.

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

- a7191a1: Adopt the accessibility gate on a codebase that already has findings. `real-a11y snapshot --update-baseline` records today's findings in a committed `.a11y-baseline.json`; `--baseline <file>` then suppresses exactly those, and the new `--fail-on` on `snapshot` (default `never`) counts only what's left — so the build fails on genuinely **new** findings while known debt is tracked, visible, and non-blocking.

  Report truth, gate policy: suppressed findings stay in every artifact and report, marked `"suppressed": true` — the baseline changes what fails the build, never what you can see. Matching reuses the same two-tier identity matcher as `diff`, so a renumbered `:nth-of-type` locator or a re-indented subtree doesn't silently un-suppress an accepted finding. A baselined finding that gets fixed produces a stale-entry warning (never a failure); `--update-baseline` prunes stale entries deterministically and carries forward the `note` field of every entry that still matches — annotate accepted debt with ticket links and they survive the rewrite. Malformed or version-mismatched baselines are hard errors (fail-closed), because a silently-ignored baseline would un-gate everything it was supposed to accept.

  Also exported from the programmatic API: `loadBaseline`, `applyBaseline`, `buildBaseline`, `serializeBaseline`, and the `Baseline`/`BaselineEntry`/`BaselinePage` types.

- cfa60ad: `a11y.config.json` becomes a **project config** in the Jest/ESLint sense: a new `defaults` block seeds any flag you don't pass, on **every** command (today only `snapshot` read a config).

  ```json
  {
    "defaults": {
      "device": "iPhone 13",
      "waitUntil": "networkidle",
      "failOn": "error"
    },
    "urls": ["http://localhost:3000/", "http://localhost:3000/about"]
  }
  ```

  ```sh
  real-a11y audit http://localhost:3000   # iPhone 13, networkidle, fail-on error — no flags
  real-a11y audit                         # audits every URL in the config — no URL to re-type
  ```

  - **`urls` names your routes once.** Entries are bare URL strings (name defaults to the URL) or `{ url, name?, rootSelector?, sourcePath? }` objects. A bare `real-a11y audit` (or `snapshot`) with no positional audits the whole list; single-view commands (`tree`/`outline`/`tabs`/`list`) still take one URL. `urls` is **optional** — a `defaults`-only config is valid — and `pages` is kept as the former name.
  - **Precedence:** `flag > env var > config defaults > built-in`. An explicit flag always wins; `--no-config` (now accepted by every command) opts a run out. Defaults are **scoped to each command** — a default only seeds a flag that command declares, and never one an explicit flag mutually excludes (so `defaults.device` can't reach the emulation-free `login`, nor defeat an explicit `--cdp`).
  - **Validated by the same parsers as flags** — a config default becomes a "virtual flag," so `defaults.failOn: "sometimes"` errors exactly like `--fail-on sometimes`, and the config loader stays strict/fail-closed (an unknown or mistyped `defaults` key is a hard error). `format` is validated per command — `format: "sarif"` works for `snapshot`, errors on `audit`.
  - **Config-settable:** `root`, `device`, `viewport`, `waitUntil`/`settleMs`/`timeoutMs`, `headful`, `storageState`, `auditOrigins`, `format`, `rules`, `failOn`, `annotate`, `includeGeneric`, `baseline`, `ignoreViewLine`, `maxLines`, `maxPages`, `explain`. Path defaults (`storageState`, `baseline`) resolve relative to the config file, so a committed config is portable.
  - **Not settable** (deliberately): the per-run/destination flags (`output`, `quiet`, `verbose`) and the security-sensitive `allow-file`/`cdp`.
  - Discovery is the cwd `a11y.config.json` (or `--config <file>`); it's loaded once and shared, so `snapshot` doesn't parse it twice. This also finally wires `config.failOn`, which was validated-but-ignored before.
  - Top-level `rules`/`failOn`/`device` are kept as back-compat shorthand for `defaults.*` (`defaults` wins if both are set).

- 3a0e81b: `diff` and `snapshot` gain `--only <findings | views>` — report a single axis: `--only findings` (the accessibility problems) or `--only views` (the tree/outline/tab-order structure). On `diff` it trims the report for focused CI comments; on `snapshot` it shapes the `--format md` report (`--md --only views` exports a page set's views; `--md --only findings` a findings report).

  It's strictly an **output** filter: the exit gate is computed from the full findings either way, so `--only views` in a CI job can't silently disable enforcement — the run can exit non-zero while showing only structure. What explains a gating exit: on `diff`, the always-present one-line findings summary; on `snapshot`, a stderr note (`real-a11y: gate: N unsuppressed finding(s) …`) — the views-only report itself is a pure structure export with no findings content. In `diff --format json`, the filtered axis's arrays are omitted (`views`/`structural` under `--only findings`; `new`/`changed`/`removed` under `--only views`); the summary and per-page `structuralDiff` boolean always ship.

  `snapshot --only … --format json` writes a **partial artifact**: the filtered axis is stripped from the pages and the new `meta.only` field records the capture mode (additive — full artifacts carry `meta.only: null`, schemaVersion stays 1). Partial artifacts are machine exports, not diff inputs: `diff` rejects them with exit `2` and a re-generate hint, because an empty-because-filtered axis is indistinguishable from empty-because-clean and would read as everything-new or all-removed. (Caveat: CLI versions before this release don't know `meta.only` and would diff a partial artifact without complaint — regenerate with matching versions, as with any artifact.) `sarif`/`junit`/`jsonl` are findings-shaped by construction and reject `--only`.

  Designed as one enum flag rather than a `--findings-only`/`--views-only` pair: contradictory states are unrepresentable, and a config default (`"defaults": { "only": "findings" }`) is overridable from the command line by passing the other value. Under `--only findings`, view-axis modifiers (`--explain`, `--max-lines`, `--ignore-view-line`) are uniformly inert rather than errors, so an `a11y.config.json` `defaults: { "explain": true }` can coexist with an explicit filter.

- 31deea2: `--producer native` — audit Chromium's own accessibility tree from the CLI.

  The default (`--producer dom`, unchanged) injects the page-bundle and walks the light DOM in the page. `--producer native` instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and serializes + audits it in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root:

  ```sh
  real-a11y tree https://example.com/player --producer native   # media controls appear
  real-a11y audit https://example.com/player --producer native  # and get audited
  real-a11y outline https://example.com --producer native
  ```

  Native is whole-document and read-only, so the flag is accepted only where that fits: `audit`, `tree`, and `outline`. Commands that carry a tab sequence (`tabs`, `inspect`, `snapshot`) or run the in-page `listByRole` (`list`) reject `--producer native` with guidance, and `--producer native` can't be combined with `--root` (it audits the whole document).

  `@real-a11y-dev/snapshot` gains `projectNativeTree(tree, options?)` — the shared projection that turns a native `ExtractionResult` into the same `CleanSnapshot` the DOM producer yields (serialize + audit in Node, empty tab order). It's what the CLI's native path builds on, and it's reusable by any consumer opting into the native producer.

- 1b862d1: CI interop reporters and diff-side baselines. `snapshot --format` now speaks `sarif`, `junit`, and `jsonl` alongside `json` (still the default) and `md` (`--md` stays as shorthand):

  - **`sarif`** — SARIF 2.1.0 for GitHub code scanning (upload with `codeql-action/upload-sarif@v4` and findings land in the Security tab), Azure DevOps, and the VS Code SARIF viewer. Built to survive the known interop traps: results anchor to repo **file paths** (the page's `sourcePath` from the config, else the config file — never a bare page URL, which GitHub silently won't display), so `sarif` requires `--config`; alert identity is supplied via `partialFingerprints.primaryLocationLineHash` = the stable `v1:` fingerprint, so alerts neither collapse nor churn on unrelated edits; `automationDetails.id` is scoped per config, not per page; and baseline-suppressed findings are excluded entirely, because GitHub ignores SARIF `suppressions[]`.
  - **`junit`** — one suite per page, one failing case per finding, baselined findings as `skipped`, a passing placeholder for clean pages (empty suites read as "no tests ran" in some ingesters), XML-escaped throughout.
  - **`jsonl`** — one finding per line for `jq`/grep pipelines; no framing records; suppressed findings flagged.

  `diff` now takes `--baseline <file>` too: a NEW finding the baseline accepts renders as `new (baselined)` — reported, never gating — closing the loop with `snapshot --update-baseline`. The `a11y.config.json` page entries gain a `sourcePath` field (carried into the snapshot artifact) for SARIF anchoring. Reporters are exported from the programmatic API as `renderSarif`, `renderJUnit`, and `renderJsonl`.

  The structural (tab-order) view diff no longer explodes on an insertion: the serialized tab list is numbered, so adding one focus stop used to renumber every stop after it and report ~40 "changed" lines. The tab view now compares by stop content (the `NN.` counter is dropped before diffing), so one inserted stop is one added line — the tree and outline views are unchanged, keeping indentation depth and heading `(level N)`.

- 7e612e4: `snapshot` now takes a **URL positional**, like every other command — the config is optional, for multi-page/policy:

  ```sh
  real-a11y snapshot https://example.com -o base.json    # single page, no config
  real-a11y snapshot                                     # pages from a11y.config.json
  ```

  Pages resolve in precedence order: **positional URLs → `A11Y_PAGES` → `a11y.config.json`**. A positional URL's page name defaults to the URL (matching `audit`/`tree`). This removes the inconsistency where `snapshot` was the only command that couldn't audit a URL you just type — making the snapshot → diff flow usable without writing a config first.

- 7a9b870: `diff` now shows structural drift as a **real unified diff** — context lines, order, and indentation, like a PR file diff — so a reviewer can see _where_ in the tree a change happened, not just a bare list of added/removed lines. Shown in full by default:

  ````text
  #### home
  ```diff
  @@ -3,7 +3,8 @@
       link "About"
  -    button "Toggle theme"
  +    button "Switch to dark mode"
     main
  +    complementary "Semantic Navigator"
  ```
  ````

  Add **`--explain`** for an opt-in plain-language summary on top — statements a non-expert can act on. The default stays **neutral** (findings + the unified diff, both facts); `--explain` is the interpretive layer (pairing heuristics, cross-view inference), so the default never makes a claim the diff can't back up:

  ```text
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 2 of 14)
  ```

  The taxonomy covers what assistive-tech users feel: landmarks added/removed/renamed (removing `main` calls out broken skip-links), heading level changes and renames, keyboard tab stops added/removed with their position — including the dangerous variant where the element is **still on the page but no longer keyboard-focusable** — interactive elements outside the tab order, and **pure reorders** of the tab order or heading outline. Anything unrecognized degrades to one honest `Other content changed` rollup — never silence. Rename/level pairings are count-aware and strictly 1:1; ambiguity degrades to add/remove, so the summary never guesses.

  New flags for CI comments (default: full):

  - **`--max-lines <n>`** — cap each page's structural diff to _n_ lines, then `… N more`.
  - **`--max-pages <n>`** — detail the first _n_ changed routes; list the rest.
  - **`--ignore-view-line <regex>`** (repeatable) — drop volatile lines (a "last updated" timestamp, a build hash) before diffing.

  Where it lands:

  - **pretty** — a colored unified diff per changed page; `--explain` adds the `· <statement>` lines; a one-line `--explain` hint otherwise.
  - **md** — a route index (`Pages with a11y changes (N): …`), findings, then (under `--explain`) statements, then the color-coded ` ```diff ` hunks — inline, not in `<details>`, so PR-notification emails keep the green/red. The header names the drift (`… · structure changed on N page(s)`) so a findings-clean-but-structure-moved diff doesn't read as an all-zero "nothing changed".
  - **json** — additive `pages[].structural: [{ kind, view, message, … }]` and `pages[].structuralDiff` (a boolean: does the unified diff have any hunk — the honest "structure changed" signal, since `structural` misses a pure tree reorder), always present regardless of the flags (machine surface); `schemaVersion` stays 1, `pages[].views` untouched.

  The a11y-diff workflow prints the **full uncapped diff to the job log** and posts a capped comment (`--max-pages 5 --max-lines 20`) that links back to it, so the complete diff is always one click away.

  Structural output is advisory by construction: the exit gate never reads it.

  `@real-a11y-dev/testing` newly exports the `INTERACTIVE_ROLES` set and re-exports `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core`, so the CLI's structural summary shares one source of truth for role classification.

- d693a00: Make `diff` focus-aware. Now that serialized snapshots mark the focused element with `[focused]` (see `@real-a11y-dev/serialize`), the `diff` command:

  - **Excludes the marker from the structural diff.** Focus isn't structure, so a pure focus move (same elements, only the focused one differs) no longer shows as phantom add/remove churn in the multiset views or the `--explain` statements.
  - **Reports the transition under `--explain`** as a `Focused element changed: <from> → <to>` statement (or "focus now starts on…" / "focus no longer starts anywhere…" when it appears or vanishes). On a page where only focus moved, that one statement is the entire structural summary.

  The literal unified diff still shows the `[focused]` line change, so the raw view stays faithful.

  Note: when comparing a base snapshot captured with an older CLI (no marker) against a PR snapshot from this version, an autofocused page shows a one-line focus change. Regenerate both sides after upgrading, as with any baseline.

- ba4ba95: New package `@real-a11y-dev/snapshot` — the snapshot engine, extracted from `@real-a11y-dev/cli`. It owns the deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines, depending on nothing but `@real-a11y-dev/audit` and `@real-a11y-dev/core`. It's Node-only (`node:crypto`) and never enters the page bundle, which makes it the single place a snapshot is captured and compared — so a snapshot taken by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical. The `CliError` the artifact and baseline readers used to throw is now a domain `SnapshotFormatError`.

  **Breaking for `@real-a11y-dev/cli`: it no longer exposes a programmatic `.` library entry — the CLI is a command, not a library.** Everything the old `api` surface re-exported (fingerprints, the artifact, the findings/views/unified diff, baselines, sanitization) now lives in `@real-a11y-dev/snapshot`; import it from there instead. The `real-a11y` binary — its commands, flags, output, and exit codes — is byte-for-byte unchanged (verified against the CLI e2e suite). The CLI also drops its direct `@real-a11y-dev/core` dependency (it followed the engine into `snapshot`) and gains `@real-a11y-dev/snapshot`.

### Patch Changes

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- 642634e: `real-a11y diff` output now reports **two clearly labeled axes** so the counts can't be misread. The markdown header was a single `0 new · 0 changed · 0 fixed · structure changed on 1 page` line — which made an all-clean findings count sitting next to a structure change read as a contradiction. It's now:

  ```
  ### Accessibility diff

  **Findings** (gate CI): 0 new · 0 changed · 0 fixed — none changed
  **Structure** (advisory): changed on 1 page — new or reordered headings, landmarks, or tab stops
  ```

  _Findings_ are the accessibility problems that gate CI; _structure_ is the shape of the semantic tree (advisory, never gates) — so adding a valid new section moves the structure without introducing a single new finding. The terminal (`pretty`) summary is likewise labeled `findings:`.

- 6a1e5b8: `real-a11y diff` now warns on stderr when the two snapshots share no page `name` at all. Pages join by name, never URL, so two snapshots taken with positional URLs (whose names then default to URLs differing by host/port) matched nothing: every page read as added/removed, no structure was ever compared, and `--explain` silently had nothing to add — a diff that looked like it worked but compared nothing. The report and exit code are unchanged; only the warning is new.
- 84535a1: Add **a11y snapshot checkpoints** to the MCP server — six tools that give an AI agent the CLI's snapshot + diff power mid-session: capture a page, change something (deploy, feature toggle, DOM edit), then ask what accessibility findings are new / changed / fixed, with the _same_ `v1:` fingerprint identity the CI a11y-diff bot uses.

  - `checkpoint_findings` / `diff_findings` — snapshot the current page under a name, then re-snapshot and diff against it.
  - `diff_checkpoints` — diff two already-stored checkpoints.
  - `list_checkpoints` / `export_checkpoint` / `import_checkpoint` — inspect the store, and bridge to/from CLI-generated `a11y-snapshot.json` artifacts.

  Checkpoints are in-memory, LRU-capped (20), and **survive navigation by design** — so you can `checkpoint_findings("prod")`, open a preview URL, and `diff_findings("prod")` for a cross-deploy accessibility diff in one session. `close_browser` clears them.

  `@real-a11y-dev/snapshot` gains **`buildSnapshotPage()`** — the single capture→fingerprint assembler the CLI's `snapshot` command and the MCP server both call, so their fingerprints are identical (guarded by a cross-tool golden test). `@real-a11y-dev/cli`'s snapshot command re-points to it with byte-for-byte identical output.

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

- 18dda52: New package `@real-a11y-dev/cli` — the Real A11y engine as a shell command (`real-a11y`), for one-shot audits, scripts, and CI gates. `real-a11y audit <url>` prints every violation grouped by rule with per-instance CSS locators and exits `1` on errors by default (`--fail-on error|warning|never`), so a passing pipeline means the page really has no findings; exit codes `0/1/2` are a frozen contract. `tree`, `outline`, `tabs`, `list`, and `inspect` print the perception views — what a screen reader actually hears — straight from one extraction.

  Built for automation: `--format json` emits a stable envelope (`schemaVersion: 1`) in which every finding carries a stable `v1:` fingerprint (the identity that phase-2 `diff` and baselines will match on); under GitHub Actions the CLI additionally emits grouped `::error`/`::warning` annotations and a job-summary report automatically. Local builds audit directly (`real-a11y audit ./dist/index.html`); `--device`, `--viewport`, `--root`, `--wait-until/--settle/--timeout`, `--headful`, and `--cdp` (attach to a logged-in Chrome) cover dynamic and authenticated pages.

  Hardened by default: everything returned from the audited page is sanitized at the browser boundary (terminal escape/bidi injection, hostile page realms, secret-bearing URLs are redacted in every sink), reports are deterministic (no timestamps, stable ordering), and human output never conveys severity by color alone. Playwright is an optional peer dependency, lazily imported, with actionable errors when it (or Chromium) is missing. Zero new runtime dependencies.

- e736c75: Track accessibility regressions across a PR. `real-a11y snapshot` audits a whole page set (from `a11y.config.json` or the `A11Y_PAGES` env) and writes one diffable JSON artifact — findings with stable `v1:` fingerprints plus the tree/outline/tabs views per page (or `--md` for a human report). `real-a11y diff base.json pr.json` then classifies the two as **new / changed / fixed** and exits 1 only on NEW findings at/above `--fail-on`, so pre-existing debt never blocks a PR and fixes never gate.

  The diff is finding-identity-aware, not a line diff: a two-tier matcher (exact fingerprint, then greedy best-match per rule on locator/context/tag similarity) means a renumbered `:nth-of-type` locator, a re-indented subtree, or an inserted sibling reads as unchanged — only a real violation change is reported. `diff` is pure (no browser). Adds the strict, fail-closed `a11y.config.json` loader (a typo'd key is an error, so a mistake can't silently un-gate CI), `pretty` / `json` / `md` diff output, and the `diffFindings` / `diffArtifacts` / `parseSnapshotArtifact` programmatic API.

- 18dda52: Audit pages behind a login, without ever handing the tool a password. `real-a11y login <url> --save auth.json` opens a visible browser, you log in by hand (MFA/SSO/passkeys all work), press Enter, and the session is saved; `--storage-state auth.json` on `audit`/`inspect`/`tree`/`outline`/`tabs`/`list` then audits as that logged-in user. The saved file is written `0o600` and the command warns if it lands un-gitignored inside a repo.

  Under a loaded session, auditing is **origin-pinned**: extraction is refused if a page redirects off the target's origin (exit 2), so a stray or hostile redirect can't pull an unintended authenticated page into a report — `--audit-origin <origin>` allows a known SSO bounce. Storage-state files are validated up front with catalog-style errors that never echo their contents, `--storage-state` conflicts with `--cdp`, and an expired session surfaces an advisory "may have expired — re-run login" note. `login` is interactive-only (exits 2 with a clear hint in CI). Session storage isn't captured by storage state — `--cdp` remains the interactive fallback for apps that keep auth there.

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
- Updated dependencies [9c3517c]
- Updated dependencies [18dda52]
- Updated dependencies [32fc4e6]
- Updated dependencies [18dda52]
  - @real-a11y-dev/testing@0.1.0-beta.10
  - @real-a11y-dev/mcp@0.1.0-beta.0
