/**
 * Which native-tree roles are actionable, and how — shared between the
 * dev-only `DogfoodPanel.tsx` debug harness and the production side panel's
 * native-mode integration (both dogfood-only surfaces; this module carries
 * no `chrome.debugger` use of its own, but stays under `native/` alongside
 * everything else this build tree-shakes out of the store bundle).
 *
 * Extracted from `DogfoodPanel.tsx`, where these predicates originated
 * across rounds 4-15 of the live dogfood exercise (see `DOGFOOD.md`'s
 * "Findings from real-use dogfooding" for the full history of each one).
 * Kept as one shared module rather than duplicated so a future fix lands in
 * one place, not two that can drift.
 */

/**
 * A native tree node, as the `NATIVE_READ` wire response shapes it
 * (`native/index.ts`). Flat and self-contained — no `parentId`, since a
 * consumer that wants one derives it once from every node's `childIds`.
 */
export type NativeNode = {
  id: string;
  role: string;
  name: string;
  depth: number;
  childIds?: string[];
  states?: Record<string, string | boolean>;
  properties?: Record<string, string>;
  /** The field's live value, redacted to `native-core.ts`'s
   *  `NATIVE_REDACTED_VALUE` sentinel for a sensitive field by
   *  `pageReadValue` — never the raw secret. */
  value?: string;
  /** The field's static placeholder hint — page-authored, never redacted.
   *  Present only for a value-bearing role that has one set. */
  placeholder?: string;
  /** The node's accessible description — Chromium's own
   *  `aria-describedby`/`aria-description` resolution. Empty string, not
   *  undefined, when there is none (matches `A11yInfo.description`). */
  description?: string;
};

/**
 * Roles worth offering a one-click action for during a dogfood session.
 *
 * Sourced from the DOM producer's own role→action mapping (`getActions` in
 * `core/src/extraction/dom-extractor.ts`, the "ARIA role-based actions"
 * branch) — the authoritative answer to "is this role actionable" in this
 * codebase, since it drives `interaction.isInteractive` for the DOM/A11Y
 * tree view rendered right alongside this panel. A role missing here after
 * DOM's own list carries it is exactly the "not interactive on native tree"
 * class of bug: the widget IS actionable, the panel just never learned it.
 *
 * Every wrapper-composite role here (`treeitem`, `menuitemcheckbox`,
 * `menuitemradio`, `gridcell` — `tab`/`menuitem` were already present) is
 * also in `pageClick`'s own `composite` redirect list below, so the dispatch
 * mechanism was already correct for all of them; only the panel's own
 * allowlist was behind. `nativeIdOf`-lockstep note applies the same way
 * here — kept in step by hand, asserted by the test that stringifies
 * `pageClick` and checks each composite role appears in it.
 *
 * Deliberately excludes `slider`: the DOM producer gives it `focus`,
 * `increment`, `decrement` — never `click` or `type` — so it gets no wide
 * button here at all, only the step buttons `isSteppableRole` renders
 * separately below. Includes `spinbutton`, unlike `slider`: `getActions`
 * gives it `focus, type, increment, decrement`, so it gets both the wide
 * type-button (via `isTypableRole` below) and the step buttons. This split
 * used to exclude both roles entirely — `dispatchNative`'s `NativeAction`
 * union had no `increment`/`decrement` at all, so offering any button for
 * either would have dispatched the wrong action rather than a missing one.
 * That gap is closed (`pageStep` in `native-core.ts`); this list and
 * `isTypableRole` were updated to match. Also excludes bare `cell` (present
 * in `pageClick`'s composite list for redirect-safety, but the DOM producer
 * itself never treats a plain table cell as actionable — only
 * `gridcell`/`columnheader`/`rowheader` are).
 *
 * Deliberately excludes `row`, `listbox`, `option` too, despite `getActions`
 * having a click branch for each: unlike the wrapper-composite roles above,
 * these three are also the IMPLICIT ARIA role of a plain native element —
 * `<tr>` → `row`, `<select multiple>` → `listbox`, `<option>` → `option`
 * (`core/src/extraction/role-map.ts`), and Chromium's own AX tree computes
 * the identical implicit role via HTML-AAM, with no ARIA authoring needed.
 * `getActions` only fires those three branches off the ELEMENT'S LITERAL
 * `role` ATTRIBUTE (`element.getAttribute("role")`, not the computed role),
 * and `tag === "select"` is checked earlier in its if/else-if chain — so a
 * plain `<tr>` or native `<select multiple>`/`<option>` never reaches those
 * branches at all; only an explicitly `role="row"`/`"listbox"`/`"option"`
 * custom widget does. A native-tree node carries no tag, only the role
 * string, so it cannot tell a plain `<tr>` apart from a `role="row"` ARIA
 * grid row. Offering CLICK on every table row and native `<select>`/
 * `<option>` (virtually any page with a data table or dropdown) would fire a
 * synthetic pointer sequence nothing is listening for — same "worse than the
 * current gap" call as `slider`/`spinbutton` above, not a fix for the
 * (rarer) custom-widget case.
 *
 * `option` still isn't added here, but it isn't stuck at "no action" either
 * — see `isSelectableRole` below. A generic CLICK stays wrong for it even
 * once the ambiguity above is resolved: a synthetic pointer sequence on a
 * real `<option>` is a no-op, because the open list is OS chrome, not DOM a
 * click reaches. `isSelectableRole` offers a dedicated `select` action
 * instead, verified in-page against the live element (`this instanceof
 * HTMLOptionElement` in `native-core.ts`'s `pageSelectOption`) rather than
 * guessed from the role string — the one place this codebase actually can
 * tell a real `<option>` apart from a custom `role="option"` widget, unlike
 * `row`/`listbox` above, which stay excluded with no such per-dispatch check
 * to lean on.
 */
export const ACTABLE = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
]);

/**
 * Is this node one where "act" means typing text, as opposed to a click?
 *
 * `textbox`, `searchbox`, and `spinbutton` — the roles the DOM producer's
 * own `getActions` gives `type` for — are unconditionally typable. `combobox`
 * is not one of them, but it isn't unconditionally NOT typable either.
 *
 * ARIA overloads `combobox` across two shapes: an EDITABLE combobox
 * (autocomplete text input) and a SELECT-ONLY combobox — the ARIA APG
 * "Combobox (Select-Only)" pattern, a non-editable trigger that behaves like
 * a `<select>`. When this function took only a role, role+name+depth alone
 * genuinely couldn't tell them apart, so every combobox defaulted to a
 * click — correct for the select-only case (round 4's original fix:
 * prompting for text there opened a browser `prompt()` for nothing, since
 * `pageType` would refuse it as `not-a-text-field`), but silently wrong for
 * an editable one: on a NATIVE `<input role="combobox">` (Google's,
 * YouTube's, and most real-world search boxes are built exactly this way),
 * `getActions`'s `tag === "input"` branch fires before it ever reaches the
 * ARIA `role === "combobox"` branch — so the DOM producer already gives
 * these `focus, type`, and always defaulting to click here left them
 * strictly worse to act on than the DOM/A11Y tree view right next to them.
 *
 * The native tree's own `editable` state — part of the states/properties
 * enrichment `axFacets` (`native-core.ts`) attaches to every node, not
 * something the later value read-back added — is precisely Chromium's own
 * answer to "does this AX node accept typed text": present (e.g.
 * `"plaintext"`) for a native input or contenteditable-backed combobox,
 * absent for a select-only trigger — confirmed against both shapes in a
 * real headed Chromium. That makes the ambiguity actually resolvable now,
 * so `combobox` consults it instead of guessing; every other typable role
 * ignores `states` entirely, since none of them have this ambiguity to
 * resolve.
 */
export function isTypableRole(
  role: string,
  states?: Record<string, string | boolean>,
): boolean {
  if (role === "textbox" || role === "searchbox" || role === "spinbutton") {
    return true;
  }
  if (role === "combobox") return Boolean(states?.["editable"]);
  return false;
}

/**
 * Roles that step by one unit via `increment`/`decrement` rather than (or in
 * addition to) a click/type action — `slider` and `spinbutton`, the two
 * roles the DOM producer's `getActions` gives those actions for. Rendered as
 * a pair of step buttons alongside whatever `ACTABLE`/`isTypableRole` already
 * offer for the role (nothing, for `slider`; a type button, for
 * `spinbutton`), never instead of them — a spinbutton is both typable and
 * steppable at once, matching `getActions`'s own `focus, type, increment,
 * decrement` for it.
 */
export function isSteppableRole(role: string): boolean {
  return role === "slider" || role === "spinbutton";
}

/**
 * Live dogfood finding: "combobox options are not interactive" — Amazon's
 * department dropdown is a real `<select>`; Chromium normalizes it to
 * `combobox` → `menuListPopup` → `option` on the native tree, and each
 * `option` row had no action at all, next to the DOM/A11Y tree view's own
 * picker UI (`InputPanel.tsx`'s `SelectPicker`) for the identical element.
 * `option` is deliberately absent from `ACTABLE` (see its own docstring) —
 * this is not a reversal of that, it's the dedicated action that exclusion
 * was always missing: `native-core.ts`'s `pageSelectOption` verifies
 * `instanceof HTMLOptionElement` in-page before doing anything, so a row
 * that turns out to be a custom `role="option"` widget refuses cleanly
 * rather than misfiring.
 */
export function isSelectableRole(role: string): boolean {
  return role === "option";
}
