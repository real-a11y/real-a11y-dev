# Extension native mode — `chrome.debugger` dogfood

**Status:** dev-only · **RFC:** [native-tree RFC (#197)](https://github.com/real-a11y/real-a11y-dev/pull/197) (Revision 2 + PR H) · not for the Chrome Web Store.

This is the time-boxed dogfood the native-tree RFC gates the desktop decision on.
Spike 5 already proved the mechanism works (an MV3 service worker reads **and**
dispatches Chromium's native accessibility tree — UA-shadow media controls
included — over `chrome.debugger`). What it **could not** answer needs a real,
headed, human session. This build instruments exactly those three questions.

> **It produces a decision, not a feature.** The goal is a verdict written back
> into the RFC, not shipping native mode to store users.

## Why it's a separate build

`chrome.debugger` is one of Chrome's most sensitive permissions. Requesting it
in the **published** extension would trigger heightened store review, a scary
permission warning, and a forced re-consent for every existing user — for a
feature that's off by default. So the store build never carries it:

- `packages/extension/public/manifest.json` (the **shipped** manifest) stays
  clean: `activeTab`, `sidePanel`, `webNavigation`.
- The native code is gated behind a build-time `__DOGFOOD__` constant, so it is
  **dead-code-eliminated** from the store build (verified: the production
  `background.js` contains no `chrome.debugger` reference).
- The dogfood build is a **separate, unpacked** artifact (`dist-dogfood/`) with
  its own manifest that adds `debugger` + `tabs` + `storage` (the last for the
  content-free instrumentation log). Unpacked extensions need no store review.
  It is never submitted.

## Build & load

```sh
pnpm --filter @real-a11y-dev/semantic-navigator-extension build:dogfood
```

Then in Chrome:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `packages/extension/dist-dogfood/`.
3. It appears as **"Semantic Navigator (native dogfood)"** — distinct from the
   store version, so you can tell them apart.

## Run the dogfood

Open the side panel on a real page you actually use (one with a `<video controls>`
is a good test — its media controls are the thing only native mode can see).

1. Expand **"⚠︎ chrome.debugger native mode — DEV dogfood"** at the top of the panel.
2. Tick **native mode** (this is the runtime flag — the `debugger` capability is
   still inert until you do this).
3. **Load native tree** — attaches the debugger (you'll see Chrome's
   "…is debugging this browser" banner), reads the tree, and lists it. Interactive
   rows are buttons; click one to dispatch a click (or type into a text field).
   The tree **re-reads itself after every successful action**, so the ids stay
   valid for the next one — you should not need to reload by hand between
   clicks. If you navigate the page, or switch tabs, the panel drops the tree
   and says so rather than dispatching against ids the document no longer has.
   The re-read waits a short beat for the page to react, which covers batching
   and menu transitions but **not** a slow fetch-driven re-render — if a click
   ever seems to act on the previous state of the page, that is the case to
   note, and re-reading by hand will confirm it.
4. **On a page native can't reach**, the panel names the reason instead of
   reporting a bare failure. Two different moments, because they are two
   different kinds of answer:
   - **Before attaching**, from the URL alone — a `chrome://` tab, the Web
     Store, an extension page, `view-source:`, or a `file://` URL without
     "Allow access to file URLs". An amber panel names the reason as soon as you
     land there, and no banner ever flashes.
   - **On the attach**, for anything the URL can't predict — most importantly
     **DevTools holding the tab**.

   **Load native tree** stays enabled in both cases. That is deliberate: the
   refusal is only counted when you actually press it, so a disabled button
   would keep most of the reason codes out of the Capability split entirely.
   Pressing costs nothing — the service worker refuses before it attaches.

   Where the DOM producer still works (a DevTools conflict), the message points
   you at it; where Chrome blocks every extension surface (`chrome://`, the Web
   Store), it says _that_ rather than sending you to a panel which will also
   never load.

5. **Switching native mode off detaches.** `debugger` cannot be an optional
   permission, so "revoked" can only mean "not attached" — unticking the box
   drops any live attachment and reports the count, **including zero**.
   Zero is the normal answer and is not a problem: a suspend that strands
   bookkeeping has usually already dropped the attachment itself, so there is
   nothing left to detach and the report records it as `detach-stale` rather
   than as a suspend. A **non-zero** count is the one to note — it means a
   genuinely live attachment, and its banner, outlived the switch.
6. Use it across normal sessions for ~2 weeks. Leave DevTools open sometimes.

Everything is instrumented to `chrome.storage.local` (content-free — event kinds,
timings, counts; never page text or typed values).

## Report back

**Copy dogfood report** puts a summary + raw log on your clipboard. Paste it into
the RFC PR H thread. The RFC's three questions, plus the one that frames them:

- **Banner tolerance** — attach count + total time attached. Did the banner
  actually bother you during deliberate audit sessions?
- **MV3 service-worker lifecycle** — unsolicited detaches (the worker suspending
  drops the debugger) and whether reattach recovered. _This is the main
  engineering risk._ Both numbers are deliberately narrow: attach bookkeeping
  lives in `chrome.storage.session`, so a detach still gets attributed after the
  suspend that destroyed the worker's memory; and only a genuine dropped
  connection counts as a reattach — a CDP command that merely failed, or a page
  the debugger can never attach to (`chrome://`, the Web Store), does not.
- **DevTools conflict** — how often attach was refused because DevTools (or
  another debugger) held the tab.
- **Recovery abandoned** — a drop that was never retried because native mode
  went off mid-operation. It is separated from `reattach failed` on purpose:
  nothing was attempted, so counting it as a failure would overstate the risk,
  and counting it as nothing would leave a drop with no verdict at all.
- **Capability** — how often native was unavailable at all, split by reason.
  This is the fourth number and it reframes the other three: a run that is mostly
  `devtools-conflict` says the problem is conflict handling, while one that is
  mostly `browser-ui` says users simply spend their time on pages native can
  never reach — and no amount of engineering changes that. The split is kept as
  an uncapped counter, so it stays true after the raw log rolls.

Add your qualitative read alongside the numbers. That verdict decides whether
extension-native ships (and, per the RFC, whether the Electron desktop shell is
ever built).

## Findings from real-use dogfooding

Bugs and gaps a real session turned up, distinct from the four instrumented
questions above — those are quantitative signals the report exports on its
own; this is the qualitative "something was wrong" log a number can't capture.
Kept here rather than only in the PR thread so it survives past any one PR's
review — a fix round's own summary describes what changed in that diff, not
what a person actually ran into holding the tree next to a page.

- **Select-only combobox opened a text prompt instead of its dropdown.**
  ARIA overloads `combobox` across two shapes — an editable autocomplete
  input, and the APG "Combobox (Select-Only)" pattern (a `<select>`-equivalent
  with nowhere to type) — and the panel's `isText` heuristic couldn't tell
  them apart from role alone, so acting on the latter opened a browser
  `prompt()` and then dispatched a `type` the page had nowhere to put. The
  dispatch mechanism itself was already correct — `pageType` refused with
  `not-a-text-field` — the bug was entirely the panel deciding to ask in the
  first place. Fixed: only `textbox` prompts; every combobox shape gets a
  click, which opens a select-only one and focuses an editable one for typing
  at the keyboard. (`packages/extension/src/sidepanel/DogfoodPanel.tsx`,
  `isTypableRole`.)
- **The native tree showed no state/property attributes at all** —
  `aria-expanded`, `aria-level`, and friends were invisible, where the same
  widget's DOM/A11Y tree view (left panel) showed them right next to the row.
  Root cause: `core`'s shared `normalizeNativeAX` — the one place both the
  extension and `@real-a11y-dev/browser`'s CLI/MCP native producer get their
  structure from — deliberately stays a pure structural normalizer (role,
  name, tree shape only); `browser` layers its own `axFacets` enrichment on
  top for the richer AX→a11y mapping, and the extension's dev-only
  `native-core.ts` never had the equivalent layer. Fixed by mirroring that
  enrichment locally, the same "deliberate mirror, not an import" pattern
  already used here for click/type — `browser` carries Playwright, no good in
  an MV3 worker, and `core` stays pure by design (R4).
  (`packages/extension/src/native/native-core.ts`, `axFacets`/
  `EnrichedNativeNode`.)
- **Menu items showed no CLICK button on the native tree.** A `menuitemradio`
  row in the ARIA APG menubar-editor pattern (and by extension
  `menuitemcheckbox`) got a CLICK button in the DOM/A11Y tree view but not
  here, even though the dispatch mechanism itself was already correct —
  `pageClick`'s `composite` redirect list already special-cases
  `menuitemcheckbox`/`menuitemradio`/`option`/`treeitem`/`row`/`gridcell`/`cell`
  wrapper roles. The gap was entirely the panel's own `ACTABLE` allowlist,
  which had fallen behind what the DOM producer's `getActions`
  (`core/src/extraction/dom-extractor.ts`) already treats as clickable.
  Cross-checked every ARIA role `getActions` gives a click-family action
  against `ACTABLE` rather than just the reported role: added
  `menuitemcheckbox`, `menuitemradio`, `treeitem`, `gridcell` (deliberately
  not `slider` / `spinbutton`, which `getActions` gives `increment`/
  `decrement` rather than `click` — `dispatchNative`'s `NativeAction` union
  has no increment/decrement yet, so offering a button there would dispatch
  the wrong action; and not bare `cell`, which is in `pageClick`'s redirect
  list for safety only and is never itself actionable per `getActions`).
  Also added `searchbox` to `isTypableRole`, the one other role `getActions`
  gives `focus, type` that the panel had missed.

  A first pass also added `row`, `listbox`, and `option` — reverted one
  `/code-review` round later. `getActions` does give all three a click
  branch, but each is also the _implicit_ ARIA role of a plain native
  element (`<tr>` → `row`, `<select multiple>` → `listbox`, `<option>` →
  `option` — `core/src/extraction/role-map.ts`), which Chromium's own AX
  tree reports identically with no ARIA authoring at all. `getActions` only
  reaches those three branches off the element's _literal_ `role` attribute
  (`tag === "select"` is even checked earlier in its chain), so a plain
  `<tr>`/native `<select>`/`<option>` never gets those actions from the DOM
  producer — only an explicitly `role="row"`/`"listbox"`/`"option"` custom
  widget does. A native-tree node carries only a role string, no tag, so it
  can't draw that distinction; offering CLICK on every table row and native
  dropdown (virtually any page with a data table or `<select>`) would misfire
  far more often than it would help. Left out for the same "worse than the
  current gap" reason as `slider`/`spinbutton`/`cell`.
  (`packages/extension/src/sidepanel/DogfoodPanel.tsx`, `ACTABLE`/
  `isTypableRole`.)

- **The native tree showed no current field value at all** — a textbox read
  as `textbox "Name:"` with nothing to confirm what was actually typed,
  where the DOM/A11Y tree view (left panel) showed `textbox "Name:" =
"456465"` right next to it. This was flagged as a bug at first, but it
  wasn't one: R1's blanket exclusion of `valuenow`/`valuetext` was working
  exactly as designed. What was actually wrong is that the design didn't fit
  the product it was gating — Semantic Navigator's whole point in Screen
  Curtain mode is that the user relies entirely on the accessible tree to
  perceive the page, and for a value-bearing control that means confirming
  what was just typed, the same read-back a screen reader gives for free.
  Withholding it made native mode strictly worse than DOM mode for the one
  workflow native mode exists to dogfood.

  Fixed by adding a value read-back, deliberately not by loosening the
  `valuenow`/`valuetext` exclusion above — Chromium's own CDP payload can't
  be trusted to have already redacted a sensitive field (it masks passwords
  but not, say, a `cc-number` field on a plain `type="text"` input), so
  piping those two properties through untouched would have bypassed
  classification entirely. Instead: a new in-page function
  (`pageReadValue`), mirroring the DOM producer's own `isSensitiveField`
  redaction (`core/src/extraction/dom-extractor.ts`) rather than importing
  it — same "deliberate mirror, not an import" constraint as `pageClick`/
  `pageType`, since it runs as source text over CDP. A password field or a
  field with a sensitive `autocomplete` token (`cc-number`, `new-password`,
  …) reports `"[redacted]"`; everything else reports its live value; an
  empty field reports nothing at all, matching the DOM producer's own badge
  exactly. Resolved only for roles that could plausibly back an
  `input`/`textarea`/`select` element (`textbox`, `searchbox`, `combobox`,
  `listbox`, `spinbutton`, `slider`), concurrently, so a form-heavy page
  costs one round of parallel CDP calls rather than stacking N sequential
  ones onto the tree read. The RFC's own R1 text anticipated this exact
  case: "When live field values are genuinely needed later, capture MUST
  classify sensitivity in-page" — this is that classification.

  Deliberately scoped to the extension only, not `@real-a11y-dev/browser`'s
  native producer (CLI/MCP): that surface serves automation/testing output,
  often written to files or logs, where withholding live input still makes
  sense. **Verified end-to-end in a real headed Chromium**: a plain text
  field's typed value surfaces, a password field and a `cc-number`
  autocomplete field both redact even though their raw value is present in
  the CDP response Chromium itself sends, an empty field shows nothing, and
  — closing a gap a `/code-review` pass flagged, since `VALUE_BEARING_ROLES`
  is a role-string guess rather than something the existing fixture corpus
  demonstrated — both `<select>` shapes resolve too: a single-select reports
  role `combobox` and a multi-select reports `listbox` in real Chromium, and
  both correctly read back their selected option's value.

  A `/security-review` pass then found the first version of `pageReadValue`
  read `.type` / `.getAttribute("autocomplete")` directly — accessors the
  inspected page's own JS realm controls, so a page (its own code, or a
  compromised third-party script on it) could shadow an instance property to
  make a password or `cc-number` field misreport as ordinary text and defeat
  the redaction gate. Fixed by pinning both reads to each class's own
  property descriptor (`Object.getOwnPropertyDescriptor(...).get.call(el)`,
  `Element.prototype.getAttribute.call(el, ...)`) — the same defense
  `pageType` already applies to its setter, for the same reason. This closes
  the realistic case (an instance-level override). It does **not** close a
  page that redefines the _prototype's_ accessor before this function ever
  runs — `chrome.debugger` attaches after the page has already loaded and
  may have already run arbitrary code, so no in-page read at that point can
  un-patch an already-patched prototype; closing that would need capturing
  pristine accessors at `document_start`, before any page script runs, which
  this build doesn't do. That residual isn't new: `core`'s `isSensitiveField`
  — the already-shipped DOM producer redaction this mirrors, reachable today
  via the production side panel's field-state read — has no pinning at all,
  so this closes a real gap relative to that baseline without claiming to be
  adversarially bulletproof.
  (`packages/extension/src/native/native-core.ts`, `pageReadValue`/
  `VALUE_BEARING_ROLES`; `packages/extension/src/sidepanel/DogfoodPanel.tsx`,
  `formatValue`.)

- **A collapsed accordion trigger showed no state at all on the native
  tree** — `button "Personal Information"` with nothing to say it was
  collapsed, where the DOM/A11Y tree view (right panel) showed an explicit
  `collapsed` badge on the same button. `expanded: true` had already been
  fixed to surface (an earlier finding above), so this looked like the same
  bug returning; it wasn't. Confirmed in a real headed Chromium first: the
  raw CDP data for the collapsed button already carried `expanded: false`
  correctly — `native-core.ts`'s enrichment layer was never the problem.
  The bug was entirely in the panel's own `formatFacets`, which treats
  `false` as "default, not worth a badge" for every boolean state — correct
  for `disabled`/`pressed`/`selected`/etc., but wrong for `expanded`
  specifically: the production side panel's own badge renderer
  (`App.tsx`'s `states.disabled === true` / … block) deliberately shows
  `expanded` either way, `"expanded"` or `"collapsed"`, because a collapsed
  disclosure is exactly as informative as an expanded one. `formatFacets`'s
  own docstring had claimed this matched `packages/ui/TreeNode.tsx`'s
  `renderBadges` — that component turned out to have no state-badge logic
  of its own at all (its only "expanded" is the tree row's own disclosure
  triangle, an unrelated concept); the actual production renderer, in
  `App.tsx`, had never been checked against. Fixed by special-casing
  `expanded` (`"expanded"`/`"collapsed"`, both shown) and, found by the same
  close read, `checked`'s `"mixed"` tristate (rendered bare as `"mixed"`,
  not `checked=mixed`, matching `App.tsx` there too).
  (`packages/extension/src/sidepanel/DogfoodPanel.tsx`, `formatFacets`.)
- **Slider controls were not interactable at all.** The W3C multi-thumb
  slider example's thumbs showed up in the native tree with no way to act
  on them — not a display gap like the findings above, an outright missing
  capability. `ACTABLE` had deliberately excluded `slider`/`spinbutton`
  from the start: the DOM producer's `getActions` gives them `increment`/
  `decrement` (arrow-key stepping), never `click`, and `dispatchNative`'s
  `NativeAction` union had no increment/decrement at all — offering a
  button would have dispatched the wrong action, worse than the gap it
  would claim to fix. That was correct triage at the time (round 7); this
  is the round that closes it properly instead of leaving it open forever.

  Added `pageStep(this: Element, delta: number)` to `native-core.ts`,
  mirroring core's `ActionDispatcher.handleStep`/`dispatchArrowStep`
  (`core/src/interaction/action-dispatcher.ts`) exactly: native
  `stepUp()`/`stepDown()` for a real `<input type="range"|"number">` (with
  a fallback to the keyboard path if that throws), else `ArrowRight`/
  `ArrowLeft` dispatched directly on the element — custom ARIA sliders
  (Radix, Headless UI, …) install their keyboard listener on the slider
  itself, so this fires regardless of what currently holds focus, and
  deliberately never calls `.focus()` first (that would steal focus from
  the panel button just clicked, and worse, redirect the dogfooder's next
  keystroke into the page's own tab order). One function taking a signed
  delta, not two, matching `handleStep`'s own shape. `NativeAction` gained
  `increment`/`decrement`, wired through `dispatchNative`/`SUPPORTED`/
  `IN_PAGE_ACTION_SOURCE`.

  On the panel side: `slider` stays out of `ACTABLE` (never gets a click/
  type button — `getActions` never gives it one either) but a new
  `isSteppableRole` renders a pair of `−`/`+` step buttons alongside
  whatever `ACTABLE` already offers. `spinbutton` moved from "excluded
  entirely" to genuinely correct: it's in `ACTABLE` now (a real `<input
type="number">` or custom ARIA spinbutton is unambiguously typable, no
  select-only-combobox-style ambiguity), `isTypableRole` too, and
  `isSteppableRole` — so it gets a type button _and_ step buttons at once,
  matching `getActions`'s own `focus, type, increment, decrement` for it.

  **Verified end-to-end in a real headed Chromium**: a custom ARIA slider
  (matching the W3C example's shape — a `role="slider"` div with its own
  keydown listener) correctly increments via `NATIVE_ACT`, confirmed by
  reading back the page's own `aria-valuenow` after dispatch; a native
  `<input type="range">` decrements via the `stepUp`/`stepDown` path,
  confirmed by reading its live `.value` — composing correctly with the
  value read-back feature, which shows the post-step value on the next
  tree read.
  (`packages/extension/src/native/native-core.ts`, `pageStep`;
  `packages/extension/src/sidepanel/DogfoodPanel.tsx`, `isSteppableRole`.)

- **An editable combobox — a real search box — always dispatched a click,
  never let the dogfooder type.** Round 4 decided every `combobox` gets a
  click, never a type prompt, because role alone can't tell an editable
  autocomplete input apart from the ARIA APG select-only trigger pattern —
  correct for the select-only case, but it meant a NATIVE `<input
role="combobox">` (Google's search box, YouTube's, and most real-world
  search boxes are built exactly this way) always got a click too, even
  though the DOM producer's own `getActions` gives it `focus, type`: its
  `tag === "input"` branch fires before it ever reaches the ARIA
  `role === "combobox"` branch, so role never even enters into the DOM
  producer's own decision for this shape.

  Round 4 was working with role+name+depth alone, which genuinely couldn't
  resolve the ambiguity. It no longer has to: the native tree's own
  `editable` state — part of the states/properties enrichment every node
  already carries, not something the later value read-back added — is
  precisely Chromium's own answer to "does this AX node accept typed text"
  — present (e.g. `"plaintext"`) for a native input or contenteditable-
  backed combobox, absent for a select-only trigger. Confirmed against
  both shapes side by side in a real headed Chromium. Fixed by having
  `isTypableRole` consult it for `combobox` specifically (every other
  typable role ignores `states` entirely — none of them have this
  ambiguity to resolve).

  **Verified end-to-end in a real headed Chromium**, against a page
  mirroring an actual search box's markup: the editable combobox reports
  an `editable` state and typing into it via `NATIVE_ACT` actually lands
  the text in the input; a select-only combobox on the same page reports
  no `editable` state and still correctly dispatches a click, confirming
  the fix doesn't regress round 4's original case.
  (`packages/extension/src/sidepanel/DogfoodPanel.tsx`, `isTypableRole`.)

- **Error messages (and any other `aria-describedby` help text) were
  entirely invisible on the native tree.** An invalid form field — role
  `combobox`, `aria-invalid="true"`, `aria-describedby` pointing at a
  helper span reading "Ingresa tu e-mail." — showed the error text right
  next to it in the DOM/A11Y tree view, but the native tree showed nothing
  beyond `[invalid ...]`: the state was there, the message wasn't. Not a
  formatting gap like `expanded`/`collapsed` — `EnrichedNativeNode` never
  carried a `description` facet at all, so there was nothing to format.

  Root cause and fix mirror the value read-back finding's shape, but the
  data itself needed no new redaction gate: an accessible description is
  Chromium's own `aria-describedby`/`aria-description` resolution — a
  top-level AX `description` field, not one of the `properties` array
  `axFacets` already reads `states`/`properties` from — and it's
  page-authored help/error text, not user input, so R1 doesn't apply to it
  the way it does to a field's value. `@real-a11y-dev/browser`'s own
  native producer (the CLI/MCP surface) already reads this exact field
  with no redaction gate; this mirrors an already-shipped, already-reviewed
  piece of enrichment rather than adding a new class of data flow.
  `axFacets` now also returns `description`, cleaned the same way
  `browser`'s own `cleanText` does; the panel renders it right after the
  name (`— "message"`, truncated at 80 characters), matching where and how
  `App.tsx` shows it.

  **Verified end-to-end in a real headed Chromium**, against a page
  mirroring the actual reported markup (a visually-hidden "Error" span
  plus a visible helper span, both inside the `aria-describedby` target):
  the native tree now reports the full concatenated description text on
  the invalid field, and a field with no `aria-describedby` correctly
  reports an empty one.
  (`packages/extension/src/native/native-core.ts`, `axFacets`;
  `packages/extension/src/sidepanel/DogfoodPanel.tsx`,
  `formatDescription`.)

- **A native `<select>`'s options had no way to act on them at all.**
  Amazon's department dropdown (`<select>` with plain `<option>` children)
  showed up on the native tree — Chromium normalizes it to `combobox` →
  `menuListPopup` → `option` — but each `option` row had no action,
  matching the DOM/A11Y tree view's own dedicated picker UI
  (`InputPanel.tsx`'s `SelectPicker`) for the identical element, which the
  native side had nothing equivalent to. `option` staying out of `ACTABLE`
  was already correct (round 7's own docstring: a role-only tree can't tell
  a real `<option>` apart from a custom `role="option"` widget), but a
  generic `click` was never going to be the fix regardless — a synthetic
  pointer sequence on a real `<option>` is a no-op, since the browser
  renders an open `<select>`'s list as OS chrome, not DOM a click reaches.

  Added a dedicated `select` action instead of stretching `click`: a new
  in-page function, `pageSelectOption`, mirrors the DOM producer's own
  `handleSelect` (`core/src/interaction/action-dispatcher.ts`) — set the
  owning `<select>`'s `.value` and fire `change` — but verifies `this
instanceof HTMLOptionElement` in-page, against the live element, before
  doing anything. That check is what makes offering the button safe even
  though the role-only ambiguity above is unresolved: a custom
  `role="option"` widget now refuses cleanly (`not-an-option`) instead of
  either misfiring a click or being silently excluded forever. `option`
  still isn't added to `ACTABLE` — a new `isSelectableRole` predicate gates
  a separate button with `select` semantics, not `click` ones.

  **Verified end-to-end in a real headed Chromium**, against a page
  mirroring Amazon's dropdown markup: `NATIVE_ACT select` on an `option`
  node changes the owning `<select>`'s value and a real `change` listener
  on it observes the dispatch, for two different target options in turn.
  (`packages/extension/src/native/native-core.ts`, `pageSelectOption`;
  `packages/extension/src/sidepanel/DogfoodPanel.tsx`,
  `isSelectableRole`.)

- **Sliders were still not interactable after the round that was supposed
  to fix it.** The W3C multi-thumb slider example's thumbs (SVG `<g
role="slider">` elements, not the `<div role="slider">` shape the
  original fix's own real-Chromium test happened to use) reported
  `NATIVE_ACT increment`/`decrement` as successful — the events genuinely
  dispatched — while `aria-valuenow` never moved. Confirmed first that the
  SVG shape itself wasn't the issue: a faithful reconstruction of the exact
  reported markup, with a keydown listener bound directly to the `<g>` and
  reacting to its own `event.target`, incremented correctly end-to-end.
  The actual gap only showed up once the reconstruction's handler was
  changed to match a real, common ARIA-widget pattern: gating on
  `document.activeElement === this` — a reasonable assumption for
  hand-written widget code, since a real user can only reach the handler
  by having tabbed to the thumb first. `pageStep` deliberately never called
  `.focus()` before dispatching (see the round-6 finding above) specifically
  to avoid stealing focus from the panel button the dogfooder just clicked
  — correct concern, but it meant any widget gating on real focus silently
  ignored every dispatched key, with a marker that still reported success.

  Fixed by calling `el.focus()` immediately before dispatch after all. This
  is safe specifically because the very next thing `pageStep` does is the
  two-stage restore that already existed for an unrelated reason (a widget
  moving focus to itself as a side effect of handling the key) — that
  restore doesn't care why focus moved, only that it isn't where it
  started, so it undoes this call exactly the same way it undoes a
  widget's own focus-stealing. This deliberately diverges from core's
  `dispatchArrowStep` (`core/src/interaction/action-dispatcher.ts`), which
  still doesn't call `.focus()` — that decision predates this finding, and
  there's no report yet that the DOM producer's own equivalent has the same
  gap; the fix lives here until (or unless) that changes.

  **Verified end-to-end in a real headed Chromium**: the exact reported SVG
  markup increments correctly (role reports literally `slider`, not
  downgraded to `generic`/`group`, and `aria-valuenow` moves), and a
  synthetic focus-gated slider — silently no-op before this fix, confirmed
  by reproducing the failure first — now updates correctly too, with focus
  restored to the panel's last-clicked control afterward either way.
  (`packages/extension/src/native/native-core.ts`, `pageStep`.)

## Automated coverage: the native-tree e2e suite

Every finding logged above was found by hand and verified by a throwaway
Playwright script under `/tmp` that was then discarded. `e2e/` is that
verification made permanent: real APG-modeled fixture pages, driven against the
actual built `dist-dogfood/` extension in a real Chromium, checked into the repo
so the widget shapes that have already burned dogfood sessions get
regression-checked on every dispatch change.

```sh
pnpm --filter @real-a11y-dev/semantic-navigator-extension test:e2e
```

`e2e/README.md` has the full scope — what is covered, what is deliberately not,
and the four gaps building the suite surfaced. Two things from it belong here,
because they are facts about this build rather than about the suite:

- **`chrome.debugger.attach` does not collide with another CDP client on the
  same tab.** Chromium allows more than one client per target, so the extension
  attaches to a Playwright-controlled tab, dispatches, and Playwright keeps
  driving that tab afterwards — no `devtools-conflict` is provoked. That refusal
  reason is specific to **DevTools** holding the tab, not to CDP clients in
  general, which is narrower than this runbook previously implied.
- **The dogfood build loads, and its `chrome.debugger` works, under
  `--headless=new`.** Headed Chromium is not a requirement for the native path.
  (Passed as a raw `--headless=new` arg — Playwright's own `headless: true`
  selects the old headless shell, which loads no extensions at all.)

The claim these tests make is narrower than "the panel is covered end-to-end",
and the note under _Notes for reviewers_ still stands for everything outside
them: the suite pins **dispatch fidelity against specific widget shapes**, which
is the class of failure rounds 4–15 kept producing. It does not make the panel's
capability/attach lifecycle — suspend races, reattach accounting, revoke — any
better covered than it was; that remains unit-tested logic plus the manual steps
above.
