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
  (`packages/extension/src/native/native-core.ts`, `pageReadValue`/
  `VALUE_BEARING_ROLES`; `packages/extension/src/sidepanel/DogfoodPanel.tsx`,
  `formatValue`.)
