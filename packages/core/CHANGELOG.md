# @real-a11y-dev/core

## 0.1.0-beta.13

### Patch Changes

- 80d2b02: Halve the tree-search work done per keystroke. `applySearchFilter` ran the match predicate over the whole tree twice — once inside `searchTree` to build the visible set, then again to count the direct matches — so every character typed into the panel's search box paid for the string matching and `Object.entries` allocation of both passes. The two are now collected in one pass, and the loop that writes `ui.matchesFilter` folds the counting in rather than iterating the tree a second time.

  `searchTree`'s ancestor-marking walk also climbed all the way to the root for every match, re-adding ids it had already marked: O(matches × depth) on a deep tree where the matches share a path. It now stops at the first ancestor already in the set, which is one climb per distinct path segment instead of one per match (and terminates rather than spinning if a malformed tree's `parentId` links form a cycle).

  Behaviour is unchanged — same visible set, same direct-match count. This is the extraction/counting cost only; the panel still filters synchronously on each keystroke, with no input debounce.

## 0.1.0-beta.12

### Minor Changes

- e4e9c89: Keep an `aria-describedby` target in the tree when its subtree contains interactive content. Targets are suppressed because their text is already shown inline as the referencing element's description — but the suppression dropped the target's whole subtree with it, so a control living inside help text disappeared. The everyday case is a link:

  ```html
  <input aria-describedby="pw-help" />
  <p id="pw-help">Must be 8+ characters. <a href="/rules">Full rules</a></p>
  ```

  "Full rules" is visible, focusable content an AT user can tab to and activate, yet it was absent from both the DOM and a11y views — and from everything derived from them (the panel, search, serialization, audits). A description target is now suppressed only when it holds no control a user can actually reach, using the same `getActions` predicate that sets `interaction.isInteractive`, with two narrowings so the exception stays tight:

  - Only a control that actually reaches the tree counts. One the walk never emits (hidden, inside a skipped element, or among a media element's fallback children) or that AT can't see (`aria-hidden`, `visibility:hidden`) does not keep the target alive — otherwise the target returns as a redundant node while the control it was kept for never appears.
  - A bare `tabindex="-1"` does not count. It is programmatic-focus plumbing (the standard way to move focus to a `role="alert"` error container), not something a user can tab to, so text-only help and error text stays suppressed as before.

  `LiveTreeExtractor` keeps up with this: the verdict now depends on the target's whole subtree, so a mutation anywhere inside one re-evaluates the target itself. A watched page that loses (or hides) the last control in its help text drops the target node, instead of leaving a stale duplicate in the panel and audits.

  **Breaking change:** extraction output grows for pages using this pattern. A description target that holds a control — and that control, plus any nodes between them — now appears in the tree where it previously did not.

  Migration: re-record tree snapshots that cover an `aria-describedby` target with interactive content. Audits now see those newly-visible nodes, so a suite that was green may surface findings for controls inside help text (for example an unlabeled icon link); these are real defects the tree was previously hiding, and should be fixed on the page rather than re-suppressed. Nothing changes for text-only description targets, which are the common case.

- c15960d: Keep interactive descendants of `<legend>` and `<summary>` in the a11y tree. Both tags were suppressed with their **entire** subtree, on the reasoning that their text is already consumed as the `<fieldset>` / `<details>` accessible name. That holds for text, but not for controls: in

  ```html
  <legend>Payment <a href="/help">(help)</a></legend>
  <summary>Details <button>Copy</button></summary>
  ```

  the link and the button are focusable and operable on the real page, yet were invisible in the inspector panel, uncounted by audits, and undispatchable by `testing`/`cli`/`mcp` — a keyboard-reachable control the tooling swore did not exist.

  `<legend>` and `<summary>` now go through the same promotion the `<label>` branch already used: the element itself is still dropped, child subtrees that lead to an interactive descendant are promoted to the parent, and text-only children are still discarded so the name isn't duplicated as a stray `generic` row.

  **Breaking change.** Pages with a link or button nested inside a `<legend>` or `<summary>` gain nodes they didn't have before, so stored snapshots and node counts for those pages will change. Migration: re-record the affected baselines — re-run `real-a11y snapshot` for stored CLI artifacts, and update `expect(a11ySnapshot(root)).toMatchSnapshot()` files with your runner's update flag (`vitest -u` / `jest -u`). The new nodes are the ones assistive technology exposes — if an audit now reports a finding on one of them, that finding was always there, just hidden. Trees with no interactive content inside a `<legend>`/`<summary>` are byte-identical to before.

- 4aa1036: Compute the accessible name from content for every role ARIA says supports it. The role whitelist behind step 8 of the name computation held eight roles — `button`, `link`, `heading`, `option`, `treeitem`, `tab`, `menuitem`, `cell` — while ARIA 1.2's `nameFromContent` list also contains `checkbox`, `radio`, `switch`, `menuitemcheckbox`, `menuitemradio`, `gridcell`, `columnheader`, `rowheader`, `row`, and `tooltip`. So

  ```html
  <div role="checkbox"><span>Accept terms</span></div>
  ```

  came out **nameless** where Chrome announces "Accept terms" — a custom control that reads fine in a screen reader, reported by the inspector, the audits, and `@real-a11y-dev/testing` as unlabeled. The gap only showed when the label sat inside a child element; markup with direct text children was caught by the fallback below the whitelist, which is how ten missing roles went unnoticed.

  Naming from content is the opposite direction to the name **barrier** set, and most of these roles sit in both: a `gridcell` now names itself from its content and still contributes nothing to the name of the row containing it, exactly as `cell` and `treeitem` already did.

  **Breaking change.** Elements with those ten roles gain accessible names they didn't have before, so stored snapshots, contract assertions, and unlabeled-control findings change for pages that use them.

  _Migration:_ re-record affected baselines — re-run `real-a11y snapshot` for stored CLI artifacts, and update `toMatchSnapshot()` files with your runner's update flag (`vitest -u` / `jest -u`). An audit finding that disappears was a false positive: the control had a name all along and only this library couldn't see it. Trees with none of these roles, and ones whose labels are direct text children, are byte-identical to before.

- b304069: Findings from the native producer now say **where**.

  `audit` is rule · severity · locator, but `--producer native` (and MCP `producer: "native"`) reported every finding with no locator at all — a real defect with no address. The DOM producer derives the locator from a live `Element` it holds in an in-page map; the native producer runs in Node over a CDP snapshot and has no such element, so nothing was left to derive from.

  The path is now computed during the `DOM.getDocument` walk the native producer already makes — the only place it ever sees parent and sibling links, and free, since that walk was happening anyway. Both producers share one builder (`buildCssPath`, exported from `@real-a11y-dev/core` with `CssPathAdapter` and `DOM_ELEMENT_ADAPTER`), each supplying accessors for its own node shape, so `#panel > div > img:nth-of-type(2)` means the same thing whichever producer found the problem. `SemanticNode["dom"]` gains an optional `locator` to carry it. `list_elements` / `listByRole` gain native locators for the same reason, and the docs that said native had none are corrected.

  ```
  # before                          # after
  image-alt   locator: (none)       image-alt   locator: body > main > img
  image-alt   locator: (none)       image-alt   locator: #panel > div > img
  ```

  One case has no honest answer and is treated as one: the native walk pierces shadow roots and the in-page walk doesn't, so native alone reaches elements with no whole-document selector. Those paths stop at the boundary — `button:nth-of-type(2)`, not a `#document-fragment > button` that would look queryable and match nothing.

  **Native snapshots taken before this will not diff cleanly against ones taken after.** A finding's fingerprint includes its locator, so native findings that previously fingerprinted with an empty anchor now fingerprint with a real one: `real-a11y diff` will read a re-run of an unchanged page as every finding fixed and re-introduced. Re-baseline native artifacts once. DOM-producer artifacts are unaffected — their locators never changed.

- 2f2ab7b: feat(core): the native AX normalizer now preserves _named_ `generic` containers instead of always dropping them. A bare `generic` wrapper is still flattened, but a generic that carries an accessible name (e.g. Chromium's `generic "YouTube Video Player"`, which groups the media controls) is kept as a labelled group. This restores meaningful grouping in native-producer output and closes a native↔DOM structural divergence where the DOM producer kept the container and the native producer flattened it. `none`/`presentation` remain unconditionally dropped (the author explicitly removed semantics). Bumps `NATIVE_AX_VOCABULARY_VERSION` to 2 — native snapshots/baselines that contain named generic wrappers will pick up the new grouping.
- 3ab20f2: Resolve `<th>` to `columnheader` / `rowheader` the way HTML-AAM's auto
  algorithm does, instead of treating every cell without `scope="col"` as a
  `rowheader`.

  The old rule was a single ternary — `scope === "col" ? "columnheader" :
"rowheader"` — so the overwhelmingly common markup

  ```html
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Born</th>
      </tr>
    </thead>
    …
  </table>
  ```

  came out as two `rowheader`s. Chrome, Firefox, and HTML-AAM all expose those
  as `columnheader`, so a plain `<thead>` table read back from the tree
  described its own structure wrongly, and `scope="colgroup"` / `scope="rowgroup"`
  were ignored outright.

  The resolution is now:

  - `scope="col"` or `scope="colgroup"` → `columnheader`
  - `scope="row"` or `scope="rowgroup"` → `rowheader`
  - no `scope` → the cell's position decides: a `<th>` inside `<thead>`, or in
    the table's first row when the table has no `<thead>`, is a `columnheader`;
    anything else (the leading `<th>` of a body row) stays a `rowheader`

  Position is read with an ancestor walk and two `querySelector` calls — no
  layout reads, so extraction cost is unchanged.

  **Breaking change.** Trees extracted from tables whose header cells omit
  `scope` now report `columnheader` where they previously reported `rowheader`.
  If you have accessibility snapshots or `toMatchA11yTree`-style assertions
  covering such a table, they will fail until re-baselined — the new role is the
  one assistive technology actually announces. Re-record the snapshot
  (`--update-snapshots`, or your suite's equivalent) to adopt it; if you assert
  on roles directly, change the expected `rowheader` to `columnheader` for cells
  in the header row. Tables that already spell out `scope="col"` / `scope="row"`
  are unaffected.

### Patch Changes

- cd20458: `DomObserver` no longer drops its built-in sentinel ids when a caller passes a custom `internalIds` set.

  The 4th constructor parameter defaulted to the built-in set, so supplying your own ids **replaced** it rather than adding to it — silently un-filtering `__sn-highlight` and `__sn-curtain`. Mutations from our own focus-highlight overlay and screen curtain would then be observed as user mutations, re-arming the re-extract → re-render → re-highlight feedback loop the filter exists to prevent. The provided set is now unioned with the built-ins, so the built-in sentinels are always filtered.

- 229c5ac: Stop `ElementRefMap` from retaining an entry per element it has ever seen. The `WeakRef` always let the element itself be collected, but the surrounding `Map` entry was only cleared by a `get` for that exact id — and the ids of removed elements are the ones nobody looks up again, so on a long-lived SPA tab the map grew for the life of the page. `set` now sweeps collected entries once the map outgrows twice its live size, which keeps the cost amortized constant. Lookups are unaffected: `get` already reported a collected element as `undefined`.
- 1ef740a: Fix live state going stale when an app flips an ARIA state attribute in place.

  `DomObserver`'s `attributeFilter` restated its own list of attributes instead of tracking the ones the extraction pipeline reads, and had drifted from it. `aria-current`, `aria-busy`, `aria-readonly`, `aria-required`, `aria-controls`, `aria-haspopup`, `name`, `placeholder`, `action`, `method`, and the media attributes (`autoplay`, `muted`, `loop`, `poster`) were recorded on every node but never observed — so an SPA moving `aria-current="page"` between nav links on a route change, or a form toggling `aria-required` / `aria-busy`, produced no re-extraction and the tree kept showing the previous state, with nothing to indicate it was stale. These flip in place on an element that is already in the tree, so there was no childList mutation to fall back on; the change only surfaced if some unrelated observed attribute happened to change too.

  Four more attributes are consumed further along the pipeline without being recorded on a node, and were missing for the same reason: `aria-description` and `aria-level` (description and heading level), `scope` (selects a `<th>`'s columnheader/rowheader role), and `autocomplete` — which decides whether a field's value is redacted, so a field turned into a credential field mid-session kept showing its value until something else forced a re-extraction.

  The filter is now the union of the extractor's own attribute lists and the ones only the observer needs, so the recorded-attribute half can't drift again.

- 3b4967b: Stop the element picker from activating the widget you were trying to inspect. `createPicker` intercepted only `click`, so while pick mode was on the rest of the pointer sequence still reached the page: Radix and Headless UI dropdowns open on `pointerdown`, focus moves on `mousedown`, Material ripples start on `pointerdown`. Clicking a menu button to inspect it opened the menu — the click was cancelled, but everything leading up to it had already fired.

  Pick mode now suppresses `pointerdown`, `mousedown`, `pointerup`, `mouseup`, and `auxclick` at the capture phase (`preventDefault` + `stopPropagation`) for as long as it is enabled, the way Chrome's own inspect mode swallows the whole sequence. `click` is unchanged — it is still what resolves the pick and exits the mode — and all the added listeners come off with the rest on disable or `teardown()`.

- 4d982ce: Stop an empty live-region announcer from permanently pivoting the extraction scope to `document.body`. `findPortalOverlay` pivoted for **any** matching overlay outside the configured root that passed a visibility check — and visibility is display/visibility only, so the permanent, empty announcer or toast viewport that every toast library (Sonner, react-hot-toast, Radix Toast, MUI Snackbar) mounts at body level on first render counted as a showing overlay. Because those shells are never removed, the pivot was never released either: with `createInspector({ root: '#app' })` the `root` option was dead for the rest of the session, not just while a toast was up.

  The pivot now also requires the overlay to actually have something in it — collapsed text, a natively focusable control, or a graphic. A bare `tabindex` deliberately does not count: an empty toast viewport is routinely given `tabindex="-1"` for focus management (Radix Toast and Sonner both render `<ol tabindex="-1">` while holding zero toasts), so counting it would let the very shells this guards against back through. An overlay that is genuinely showing still pivots exactly as before, including an icon-only menu with no text at all; only the empty shells are ignored.

## 0.1.0-beta.11

### Minor Changes

- 7f93f92: **Breaking (beta):** reshape `SemanticNode` to be accessibility-first — `dom`, `interaction`, and `ui` are now **optional** facets; `a11y` stays required. `ExtractionResult` gains a required `source: { producer: "dom" | "native"; chrome? }` provenance stamp.

  This is the model break from the native-tree RFC (#197, v2 §2 / v3 R5): one canonical model, two producers. The DOM producer (this package's extractors) still populates every facet, so **runtime behaviour is unchanged** — the change is the type contract. A future native (CDP) producer in `@real-a11y-dev/browser` yields nodes whose `dom`/`interaction` may be absent (UA-internal nodes with no backing light-DOM element), and `ui` is panel-only.

  - New exports: `TreeProducerKind`, `TreeSource`, and `DomSemanticNode` — a `SemanticNode` with all facets guaranteed present, for surfaces that only ever render DOM-produced trees (the in-page tree panel, the extension) so they can narrow once at their boundary instead of guarding every read.
  - Generic tree helpers (`linearize`, `diffTrees`, `getTabSequence`, `searchTree`, `buildControlsIndex`) now tolerate absent facets and degrade rather than assume presence, so they stay correct on native trees.
  - `@real-a11y-dev/audit` findings degrade gracefully when `dom` is absent: an unlabeled-interactive / image-alt finding drops the `<tag>` from its message (and omits `tagName`) instead of printing `<undefined>`.

  Migration: if you read `node.dom.*`, `node.interaction.*`, or `node.ui.*`, either narrow to `DomSemanticNode` (when you know the tree came from the DOM producer) or guard with optional chaining. Every `ExtractionResult` you construct by hand now needs a `source` (use `{ producer: "dom" }` for a DOM-produced tree).

- f2532e5: New native-AX vocabulary module: the single shared normalization of Chromium's native accessibility tree (CDP `Accessibility.getFullAXTree`) into engine vocabulary.

  Exports `normalizeNativeAX` / `serializeNativeAX` (plus the tables: `NATIVE_AX_DROP_ROLES`, `NATIVE_AX_ROLE_MAP`, `NATIVE_AX_NAME_SOURCE_ROLES`, `mapNativeAXRole`, and `NATIVE_AX_VOCABULARY_VERSION`). Pure functions — no CDP, no DOM globals — so the same module serves every native-tree consumer: the browser package's upcoming `nativeTree()` producer, the extension's `chrome.debugger` mode, desktop/panel surfaces, and parity harnesses. Consolidates the four private copies that grew during the native-tree RFC spikes (#197) and had already drifted.

  Normalization: drops Blink noise (`StaticText`/`InlineTextBox`/`generic`/`none`/`RootWebArea`/…) re-parenting kept descendants to the nearest kept ancestor; maps internal roles (`Video`→`video`, `Audio`→`audio`, `image`→`img`); promotes names off dropped text children without overriding authored names; and — fixing a latent bug in the spike copies — orders siblings by each parent's `childIds` (Chromium's document order), not the interleaved flat-list order of the raw payload. Tested against a recorded Chromium payload, offline.

- d693a00: Track the focused element at extraction time. `ExtractionResult` gains an optional `focusedId` — the node id of the element that held focus when the tree was extracted, if that element is inside the extracted subtree.

  Both `extractA11yTree` and `extractDomTree` now resolve `document.activeElement` (piercing shadow roots to the real target) and record it. Focus resting on `<body>`/`<html>` — the absence of focus — is treated as none, so a freshly-rendered page reports no `focusedId` and downstream snapshots don't change. A focused node that's flattened out of the a11y view (e.g. a decorative generic wrapper) is not inherited into that view.

  This is the capture point for the `[focused]` marker rendered by the `@real-a11y-dev/serialize` / `@real-a11y-dev/testing` serializers.

- 907c68e: Add `LiveTreeExtractor` for incremental DOM and accessibility tree updates.

  `@real-a11y-dev/core` now exposes a `LiveTreeExtractor` class that keeps the
  previous extraction in memory and re-extracts only the dirty subtrees reported
  by `DomObserver`. It falls back to a full extraction when a mutation can affect
  non-local accessibility state (modal/portal scope, `id`, `aria-labelledby`,
  `aria-describedby`, `for`, etc.). The result is the same `ExtractionResult`
  shape as `extractA11yTree` / `extractDomTree`.

  `DomObserver` callbacks now receive an optional `TreeChange` payload containing
  the accumulated `MutationRecord`s and synthetic dirty roots from `input`/`change`
  events, which `LiveTreeExtractor.refresh(change)` consumes.

  The Chrome extension, React `useSemanticTree` hook, and Storybook addon preview
  have been wired to use `LiveTreeExtractor` so live updates avoid a full page
  re-extraction when only a small region changed.

- 19e9fc2: Expose `<video>` / `<audio>` with real `video` / `audio` roles, mirroring Chromium's native accessibility tree.

  ARIA defines no media roles and HTML-AAM says "no corresponding role", but that framing hid media elements behind `generic` — in the panel a named, captioned player was indistinguishable from a `<div>`, while Chrome DevTools shows a `Video "Product tour"` node. The extractor now sides with the browser's ground truth:

  - `<video>` → role `video`, `<audio>` → role `audio` (explicit `role="…"` still wins).
  - Media nodes are leaves: unrendered fallback content ("Sorry, your browser doesn't support…") and `<track>` / `<source>` metadata never become tree nodes, never leak into the accessible name, and never pollute the media node's own `textContent` / `descendantText`. (Ancestor nodes' `descendantText` previews still reflect raw DOM `textContent` — the same pre-existing behavior hidden subtrees have.) `<source>` inside `<picture>` is skipped too.
  - The one a11y-critical signal that lived in the skipped children — does this media ship a captions or subtitles track? (WCAG 1.2.2) — is hoisted onto the media node as `properties.captions` (`"true"` / `"false"`).
  - `<video controls>` / `<audio controls>` are reported focusable with a `focus` action, matching Chromium (the actual play/seek/volume controls live in a closed user-agent shadow root no in-page extractor can reach). `controls` / `autoplay` / `muted` / `loop` / `poster` now surface in the node's key attributes, and `DomObserver` watches the `controls` attribute so toggling native controls re-extracts.

  Note: Playwright's `ariaSnapshot` omits media elements entirely (they have no ARIA role), so aria-snapshot output is unchanged; this aligns the DevTools-style full tree that the panel, extension, and serializers render.

### Patch Changes

- 6a658fe: ActionDispatcher: fix an uncaught `TypeError` when the `type` action targets a custom ARIA textbox/searchbox/spinbutton. The extractor assigns `type` to those roles, which in real apps are usually contenteditable `<div>`/`<span>`s (ProseMirror, Lexical, the Slack composer, custom date steppers) — but `handleType` unconditionally called the native `HTMLInputElement` value setter, whose brand check throws `"Illegal invocation"` on a non-input, and `dispatch()` had no try/catch so it escaped the caller (in the extension it blew out of the content-script message handler and hung the panel's action).

  Now `handleType` guards the native-setter path with `instanceof`, drives contenteditable custom textboxes via the platform insertion sequence (a cancelable `beforeinput` so model-driven editors like ProseMirror/Lexical insert into their own document model, falling back to writing `textContent` + `input` only when nothing handles it), returns a failed result for elements that accept no text input, and `dispatch()` wraps every handler so any synchronous throw becomes `{ success: false, error }` instead of propagating.

- 725fcc0: Bound `getDescendantText` to a capped walk instead of materializing each element's full `textContent` subtree. Previews stop after 240 collapsed characters, avoiding O(total text × depth) string work on text-heavy pages during extraction.
- 96cb0ee: Cache `getComputedStyle` once per element during extraction and share it across the subtree-hidden / visually-hidden / sr-only / AT-hidden checks. Previously a kept non-interactive node could call `getComputedStyle` up to five times, and name computation repeated `isSubtreeHidden` (another style resolve) for every descendant. Also fold the overlapping hidden-attr / CSS checks so `isHiddenFromAT` builds on `isSubtreeHidden` instead of re-implementing them — a drift hazard when a future condition was added to only one of the two.
- ad8edc1: Harden the extraction walk against two more DOM-clobbering surfaces. A `<form>` with `<input name="hidden">` (or `id="hidden"`) made `element.hidden` return that input — a truthy value — so `isSubtreeHidden` and `isHiddenFromAT` silently dropped the whole form subtree (quiet data loss, not a crash); both now read the real state through the captured `HTMLElement.prototype` `hidden` getter, which no named control can shadow. And the walk now processes each element inside a per-element `try/catch`, so a single pathological node — e.g. a clobbered `tagName` on a `<form>` making `.toLowerCase()` throw, or any future unknown clobbering — degrades to "skip this node and its subtree" instead of aborting the entire extraction and hanging the panel on "Connecting to page…". A caught element commits nothing, so it never leaves a half-built node behind. The clobber-safe reads are consolidated in a new internal `clobber-safe` module shared by the extractor and the role map.
- d657f66: Fix a `TypeError: ...startsWith is not a function` crash that aborted the **entire** extraction on pages that trip DOM clobbering. `<form>` is the one HTML element with `[LegacyOverrideBuiltIns]`: a listed control whose `name`/`id` matches a DOM property shadows that property, so reading it returns the child **element** instead of the real value. The walk read `element.id` to skip Semantic Navigator's own overlay nodes, so a `<form>` with `<input name="id">` (ubiquitous hidden record-id fields) made `.id` an element and `.startsWith("__sn-")` threw — the panel then hung on "Connecting to page…" forever, because the walk has no per-element error boundary. The id is now read via `getAttribute("id")`, and the structural reads in the walk (`children`, `childNodes`, `textContent` — e.g. a `<input name="children">` "number of children" field) go through the native prototype accessors, which a named getter cannot override. Extraction now survives clobbered forms with the subtree intact instead of failing wholesale.
- 1c8a523: Classify an editable combobox as a typeable text field. `getActions` treated every `role="combobox"` as click-only, so a custom **editable** combobox — a `contenteditable` `<div role="combobox">`, the ARIA 1.2 editable-combobox pattern used by rich search boxes — surfaced only a `click` action and couldn't be filled. Editable comboboxes (detected by `contenteditable`) now get `focus` + `type` like a textbox, so tooling and the extension panel treat them as text entry; **select-only** comboboxes keep `click` to open their popup natively. Native `<input role="combobox">` was already handled by the input branch and is unchanged.
- a32632a: DomObserver: observe mutations _inside_ open portal overlays, not just their mount/unmount. When `root` is a subtree — the `@real-a11y-dev/react` hook and the inspector pass a user root; the extension passes `documentElement` and was unaffected — a Radix/Headless-UI/Teleport modal, menu, or listbox mounts _outside_ `root`, so the primary observer can't see into it. The extractor pivots onto the overlay, but the panel would show its initial state and then go stale on typing, `aria-*` flips, or content/submenu swaps. Now each open portal gets its own deep observer (childList + subtree + attributes + characterData) plus `input`/`change` listeners, torn down when the overlay unmounts or on `stop()`.

## 0.1.0-beta.10

### Patch Changes

- 7a56937: DomObserver: add a max-wait ceiling to the mutation debounce. The debounce was trailing-only, so a page that mutates faster than the debounce interval — streaming AI responses, progress bars, live tickers, animated `style` updates — kept resetting the timer and `onTreeChange` never fired, leaving consumers (the extension side panel, `testing`'s `flow()`/`waitForMutations`) frozen for the whole stream. A second, non-resetting ceiling timer now forces a flush at least every `maxWaitMs` (new optional constructor arg, default 1000ms, clamped to at least the debounce interval).

  `testing`'s `waitForMutations` now threads its `timeout` through as the observer's ceiling, so the new default ceiling can't resolve a `timeout > 1000` wait early — its documented `timeout` contract is preserved.

- fcd4bc9: Stop using a text input's value as its accessible name. `computeRawAccessibleName` returned `input.value` for **any** input when no label matched, so an unlabeled `<input type="text">` the user typed "John" into was named "John", and an unlabeled `<input type="checkbox">` inherited its default DOM value `"on"`. Both make a genuinely unlabeled control look labelled — the worst failure mode for an a11y tool, because `@real-a11y-dev/testing`'s `assertNoUnlabeledInteractive` would then pass a control that real screen readers announce as unlabeled.

  Per HTML-AAM, `value` names only button-like inputs (`submit` / `reset` / `button`); text, checkbox, radio, and the rest do not use it. The value fallback is now gated to those types, and `title` is ordered before `placeholder` to match the spec. Labels, `aria-label`, and `aria-labelledby` still take precedence as before.

## 0.1.0-beta.9

### Patch Changes

- 3607ac4: Stop non-modal dialogs from hijacking the extraction scope. `findActiveModal` treated **any** visible `role="dialog"` / `role="alertdialog"` as the active modal and made it the _exclusive_ extraction root — so a cookie-consent banner, a Radix `Popover.Content`, or a non-modal drawer collapsed the whole page down to just that element in the inspector.

  Modality is now gated on a positive signal via a new `isModal()` predicate: `aria-modal="true"` (set by every mainstream modal library — Radix Dialog, Headless UI, MUI — and by the APG dialog pattern) or the native `:modal` pseudo-class (a `<dialog>` opened with `showModal()`). A bare `role="dialog"` is treated as an _additive_ overlay — it joins the tree through the portal path instead of hijacking the scope. Genuine modals still pivot exclusively, exactly as before.

## 0.1.0-beta.7

### Minor Changes

- 771f034: Redact sensitive form-field values at the extraction source. `getKeyAttributes` previously captured the live `.value` of every input/textarea/select — including `type="password"`, one-time codes, and credit-card fields — into `node.dom.attributes.value`, and an unlabeled field's value could surface as its accessible name. Because the extracted tree flows into serializer snapshots (committed to git and CI), the testing package, and the Chrome extension's message channel, a typed secret rode along everywhere.

  Now a new `isSensitiveField(element)` predicate (exported from `@real-a11y-dev/core`) identifies password inputs and any field whose `autocomplete` names a credential or payment token. Such a field's value is replaced with `"[redacted]"` in the tree and is never used as an accessible name (the name falls back to the placeholder). Every downstream consumer inherits the fix from the single extraction choke point.

### Patch Changes

- 8c230cb: Fix a stack-overflow crash in accessible-name computation. Since named-widget descendants began contributing their computed name (PR #101), `getAccessibleTextContent` and `computeRawAccessibleName` could call each other without end when an element's `aria-labelledby` points at an ancestor that contains it — a real pattern that threw `RangeError: Maximum call stack size exceeded` out of `extractA11yTree` and froze the inspector (observed on mercadolibre.com.mx's signup form).

  Name computation now follows the accname visit-once rule (§4.3.2): an element already on the current computation path contributes the empty string when reached again, breaking the cycle while leaving every non-cyclic name unchanged. A `visited` set is threaded through `computeAccessibleName` / `computeRawAccessibleName` / `getAccessibleTextContent`, and `aria-describedby` resolution is guarded the same way.

- c7af39c: Resolve `aria-labelledby` before `aria-label` in accessible-name computation. Per accname-1.2 the `aria-labelledby` reference (§2B) is resolved before the inline `aria-label` (§2D), so an element carrying both — e.g. `<button aria-label="X" aria-labelledby="heading">` — is now named from the referenced text (matching Chrome, Firefox, and NVDA) instead of the inline label. Previously the inline `aria-label` won, producing a name that disagreed with what screen readers actually announce.
- 7df0e4d: Whitespace-normalize accessible names at the source. Runs of whitespace — including the stray newlines and indentation some pages leave inside their markup — now collapse to a single space and are trimmed, per accname-1.2 §4.3.2. Previously a name could carry raw newlines (e.g. an Amazon `<h3>` whose name smeared across many lines in serialized output), which surfaced in snapshots, exports, and name-based search. Normalizing in `computeAccessibleName` means every consumer — the panel, search, the serializer, and the testing snapshots — sees the same clean string.
- 088a142: Name-from-content now includes nested named widgets' names instead of skipping them. A heading whose content is a link — GitHub-style file headers, changelog entries, card titles — was computed as nameless; per accname-1.2 §2F.iii the link contributes its _computed accessible name_ (so a nested `aria-label` wins over its text), matching what Chrome and Firefox expose. Applies to `link`, `button`, `checkbox`, `radio`, and `switch` descendants. Structural rows keep their PR #84 behavior — a nested `treeitem`/`menuitem`/`option` is a sibling with its own announceable name, never part of its parent's label.

  If you snapshot pages with link-wrapped headings, expect those names to change (from empty to the link's name) — the new value is what assistive technology actually announces.

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

- a44004c: Add increment/decrement actions for slider and spinbutton rows. The panel
  previously labelled ARIA `[role="slider"]` and `[role="spinbutton"]` as
  TYPE — but typing into a Radix Slider (a `<span role="slider">` that
  listens for arrow keys, not value setters) silently did nothing. Now:
  - `ActionType` gains `"increment"` and `"decrement"` (additive, hence the
    minor bump on `@real-a11y-dev/core`).
  - The dispatcher routes both to a single stepper:
    - Native `<input type="range" | "number">` → `.stepUp()` / `.stepDown()`
      - `input`/`change` events (so frameworks observe the change).
    - Custom ARIA widgets (Radix, Headless UI, etc.) → focus the element +
      dispatch `ArrowRight` / `ArrowLeft` `keydown`+`keyup`. Works under
      the Screen Curtain because the panel drives the value change
      end-to-end without relying on the user seeing the page.
  - `getActions` now exposes:
    - `[role="slider"]` → `focus`, `increment`, `decrement` (drops misleading
      `type`).
    - `[role="spinbutton"]` → `focus`, `type`, `increment`, `decrement`
      (spinbuttons accept typed values too).
    - `<input type="range">` → `focus`, `increment`, `decrement`.
    - `<input type="number">` → `focus`, `type`, `increment`, `decrement`.
  - `TreeNode` renders a paired ▼ ▲ stepper instead of a single primary
    button when both actions are present. Each button dispatches its own
    action via the new optional `action` parameter on `onActivate`.

### Patch Changes

- d583a91: Fix the inspector failing to pivot scope onto modal dialogs that don't carry `aria-modal="true"`. Radix Dialog ≥1.1 (and several other modern libs — Headless UI, Reach UI) intentionally omit `aria-modal` and enforce modality via sibling-`aria-hidden` + focus trap instead. `findActiveModal` only matched `[aria-modal="true"]` and `dialog:modal`, so a Radix-style dialog opened in the page produced no pivot — the panel kept showing the underlying chrome instead of the dialog content. The selector now also matches visible `[role="dialog"]` and `[role="alertdialog"]` elements; the existing `isActuallyVisible` ancestor-chain check still filters out closed/unmounted dialogs.
- 80dc889: Fix the inspector missing portal-mounted overlays (Radix Dialog / DropdownMenu / Toast, Headless UI, Vue Teleport, etc.). The `DomObserver` only watched the configured root, and the extractor only pivoted scope when a modal was active — so portals rendered into `document.body` (modals, dropdown menus, listbox popovers, tooltips, and live-region toasts) triggered no mutation event and never joined the tree. A second observer now watches `document.body` at top level only and re-extracts on portal mounts; `extractDomTree` resolves the effective root in three priority levels — active modal (exclusive scope) > portal overlay outside root (pivot to `body`) > configured root. Selector covers `[aria-modal="true"]`, `<dialog>`, `[role="dialog"|"alertdialog"|"menu"|"menubar"|"listbox"|"tooltip"|"status"|"alert"|"log"]`, and `[aria-live]`. Bounded surface — non-overlay body mounts (analytics divs, script tags) don't trigger re-extracts.
- c2fb61b: Stop treeitem / menuitem / option / etc. accessible-name computation
  from concatenating every nested row's text. The previous walker
  recursed into all descendants for name-from-content, so a tree shaped
  like

  ```html
  <li role="treeitem">
    Reports
    <ul role="group">
      <li role="treeitem">report-1</li>
      <li role="treeitem">report-2 …</li>
    </ul>
  </li>
  ```

  reported the outer treeitem's name as `"Reports report-1 report-2
…"` — visible in the inspector panel on the WAI-ARIA APG Tree View
  example surfaced by PR #80. Real assistive tech reads only `"Reports"`
  for that row; each nested treeitem is a sibling with its own
  announceable name.

  Adds a `NAME_BARRIER_ROLES` set used while walking children for
  `computeAccessibleName` and `computeAccessibleDescription`. Subtrees
  whose computed role is a container (`group`, `list`, `menu`, `tree`,
  `listbox`, `tablist`, `toolbar`, `treegrid`, `grid`, `table`,
  `rowgroup`, `combobox`), a self-named row/item widget (`treeitem`,
  `menuitem*`, `option`, `tab`, `listitem`, `row`, `cell`, `gridcell`,
  `columnheader`, `rowheader`), an interactive widget (`button`, `link`,
  `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `textbox`,
  `searchbox`), or a display/live-region widget (`dialog`,
  `alertdialog`, `tabpanel`, `alert`, `status`, `log`, `tooltip`,
  `progressbar`, `meter`) contribute the empty string.

  Inline formatting roles (`strong`, `emphasis`, `code`, `mark`, etc.)
  and `heading` are intentionally **not** barriers — `<button>Save
<strong>changes</strong></button>` keeps its full label, and a
  `<button><h3>…</h3></button>` card-style trigger still picks up the
  heading text.
