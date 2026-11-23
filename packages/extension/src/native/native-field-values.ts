/**
 * Field values and what withholds them (ADR-0001), split out of
 * `native-core.ts`: what a field announces ({@link fieldFacets}), and which
 * nodes show no value because a sensitive field sits in or around them.
 *
 * Pure functions over the in-page read ({@link PageFieldRead}) and the raw
 * and normalized nodes; no CDP, no module-scope state. `native-core.ts`
 * re-exports the public names, so every caller still finds them there.
 */

import {
  cleanAXText,
  dropChoiceStates,
  REDACTED_VALUE,
} from "@real-a11y-dev/core";

import type { EnrichedNativeNode } from "./native-core.js";

/**
 * Roles announced by position in a range: a screen reader reads their
 * `aria-valuetext` in place of the number. Chromium's CDP payload never
 * carries `aria-valuetext` (its `valuetext` property is the number as text —
 * measured on Chromium 151), so `pageReadValue` reads the attribute in-page.
 * Mirrors core's `RANGE_VALUE_ROLES` (`dom-extractor.ts`).
 */
export const RANGE_VALUE_ROLES = new Set([
  "slider",
  "spinbutton",
  "progressbar",
  "meter",
  "scrollbar",
]);

/** The cap an announced value is cut to, with `…` — ADR-0001's 240
 *  characters, the same cap core's DOM producer applies
 *  (`getAnnouncedValue`). */
const VALUE_MAX = 240;

/**
 * What `pageReadValue` reports for one element, from inside the page.
 *
 * `classified` is the load-bearing bit: it is set on every answer the
 * function actually gives, so a read that never happened (the node did not
 * resolve, the call threw) comes back without it — and an unclassified node
 * shows no value at all, Chromium's included (see {@link fieldFacets}).
 */
export interface PageFieldRead {
  /** The element answered, so `sensitive` below is a real verdict. */
  classified?: boolean;
  /** A sensitive field under ADR-0001's policy (`type="password"`, or a
   *  credential or payment `autocomplete` token) — neither its value nor
   *  Chromium's value for it ever leaves the page's classification. */
  sensitive?: boolean;
  /** A sensitive field that holds something: it reads `[redacted]`, so an
   *  agent can tell "entered" from "empty" — never what, or how long. */
  redacted?: boolean;
  /** The raw live `.value` of a non-sensitive `<input>`/`<textarea>`/
   *  `<select>` — the retype prefill. Absent when empty, and for a file
   *  input. */
  value?: string;
  /**
   * What a non-sensitive `<input>` or `<textarea>` announces, read here in
   * the same call as the classification: its text, or a file input's file
   * names — `""` when empty or valueless (a button-type input). Present for
   * every such field, so Chromium's AX value, captured a moment earlier,
   * never stands in for it: a "show password" toggle flipping `type` between
   * the two reads would otherwise show Chromium's bullet mask — the length.
   */
  announced?: string;
  /** The field's placeholder hint — page-authored, never redacted. */
  placeholder?: string;
  /** The element's `aria-valuetext` — page-authored, and what a screen
   *  reader reads for a range widget in place of its number. */
  valuetext?: string;
}

/**
 * A numeric AX value as the author wrote it. Chromium keeps range values as
 * 32-bit floats, so `aria-valuenow="0.6"` arrives as `0.6000000238418579`;
 * the shortest decimal that is the same float32 is the `0.6` a screen reader
 * says. Nine significant digits always round-trip a float32.
 */
function formatAXNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const single = Math.fround(n);
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(n.toPrecision(digits));
    if (Math.fround(candidate) === single) return String(candidate);
  }
  return String(n);
}

/**
 * Cut `text` to `max` characters with a trailing `…`, never between the two
 * halves of a surrogate pair (an emoji), which would leave a lone half.
 * Exported for the panel's own raw-value cut.
 */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + "…";
}

type FieldFacets = Pick<
  EnrichedNativeNode,
  "value" | "redacted" | "rawValue" | "placeholder"
>;

/**
 * Resolve a node's field facets from Chromium's AX value and the in-page
 * classification (ADR-0001):
 *
 *  - **Unclassified** → nothing. Chromium's payload is not redacted for us —
 *    it masks a password but sends a `cc-number` text field in plaintext — so
 *    with no in-page verdict there is no way to know its value is showable.
 *  - **Sensitive** → `[redacted]` when the field holds anything, else no
 *    value — never Chromium's value, which for a password is one bullet per
 *    character: its length.
 *  - **Otherwise** → the announced value: a range widget's `aria-valuetext`;
 *    else an `<input>`'s or `<textarea>`'s text as read in-page (what
 *    Chromium announces for one, without the gap between two reads); else
 *    Chromium's AX value (a `<select>`'s selected option label, an editor's
 *    text, a progress bar's number). Whitespace-collapsed and capped at 240
 *    characters with `…`. The raw field value rides along separately as
 *    `rawValue`, for a retype to start from.
 *
 * Pure, and exported for its tests.
 */
export function fieldFacets(
  role: string,
  axValue: string | number | undefined,
  read: PageFieldRead,
): FieldFacets {
  if (!read.classified) return {};
  const facets: FieldFacets = {};
  if (read.placeholder) facets.placeholder = read.placeholder;
  if (read.sensitive) {
    if (read.redacted) {
      facets.value = REDACTED_VALUE;
      facets.redacted = true;
    }
    return facets;
  }
  if (read.value) facets.rawValue = read.value;

  const valuetext = RANGE_VALUE_ROLES.has(role)
    ? cleanAXText(read.valuetext ?? "")
    : "";
  const source = read.announced ?? axValue;
  const announced =
    valuetext ||
    (typeof source === "number"
      ? formatAXNumber(source)
      : cleanAXText(source ?? ""));
  if (announced) facets.value = capText(announced, VALUE_MAX);
  return facets;
}

/**
 * Whether a field's value is withheld, from its in-page read (ADR-0001):
 * shown only when the element was classified and is not sensitive. An
 * unclassified field fails closed, as `fieldFacets` does for its value. An
 * empty sensitive field is withheld too, although it has no value to redact:
 * which option a sensitive `<select>` has chosen IS its value.
 *
 * Exported for its tests.
 */
export function fieldValueWithheld(read: PageFieldRead): boolean {
  return !(read.classified === true && read.sensitive !== true);
}

/**
 * The structural backstop behind `pageReadValue`'s own shadow-host walk: no
 * node inside a sensitive one in the tree shows a value, whatever its own
 * verdict said. A sensitive field's parts (a month input's "Month" and "Year"
 * spinbuttons) and a wrapper's contents sit under it in Chromium's tree, so
 * this catches a part the in-page walk could not place. A nested sensitive
 * field's own `[redacted]` stays: it says "entered", never what.
 *
 * What the sensitive field controls or owns (`aria-controls`, `aria-owns`),
 * or what a combobox around it does (the ARIA 1.1 wrapper; core's
 * `sensitiveChoiceHosts`), is not inside it, but it says which option is
 * chosen: an ARIA combobox's listbox is not its descendant, and the option it
 * marks selected is the field's value. So
 * everything there loses its choice states, and nothing else: a controlled
 * panel can hold fields of its own (a shipping address beside the card
 * number), each classified on its own, whose values are theirs to show. A
 * listbox has no AX value of its own to give the choice away (Chromium 141,
 * measured). `controlled` holds the kept nodes those relations reach,
 * standing in for a target the tree dropped ({@link controlledRegion}).
 *
 * Nor does a node inside one say which of it is chosen: core's
 * `dropChoiceStates` drops an option's choice inside the field, and in what
 * it controls a menu item's `checked` and a `pressed` too, as the browser
 * producer drops them, so the two native transports agree. That fails closed: a node counts as sensitive when it merely holds
 * a sensitive control (a rich-text editor around a card input), and then no
 * option anywhere inside it shows whether it is chosen.
 *
 * Exported for its tests.
 */
export function withholdInsideSensitive(
  nodes: EnrichedNativeNode[],
  sensitiveIds: readonly string[],
  controlled: readonly string[] = [],
): void {
  // A popup only the document places can be all there is: its field may
  // have no row of its own (core's `domChoiceTargets`).
  if (sensitiveIds.length === 0 && controlled.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Hands each node at or below `from` to `visit`, once.
  const walk = (
    from: readonly string[],
    visit: (node: EnrichedNativeNode) => void,
  ) => {
    const seen = new Set<string>();
    const stack = [...from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) continue;
      visit(node);
      stack.push(...node.childIds);
    }
  };
  const fields = sensitiveIds.flatMap((id) => {
    const field = byId.get(id);
    return field ? [field] : [];
  });
  walk(
    fields.flatMap((field) => field.childIds),
    (node) => {
      if (!node.redacted) {
        delete node.value;
        delete node.rawValue;
      }
      node.valueWithheld = true;
      dropChoiceStates(node.states, node.role, "field");
    },
  );
  // A node also inside the field has lost its value above; one reached only
  // through `aria-controls` keeps what its own read decided, and a node never
  // read (an option) reads as withheld, as it would absent.
  walk(
    [...fields.flatMap((field) => field.controls ?? []), ...controlled],
    (node) => {
      node.valueWithheld ??= true;
      dropChoiceStates(node.states, node.role);
    },
  );
}
