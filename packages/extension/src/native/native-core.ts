/**
 * Transport-agnostic native-tree core for the extension's `chrome.debugger`
 * dogfood mode (RFC PR H).
 *
 * Everything that reads / normalizes / acts on Chromium's native AX tree is
 * written against a 1-method `CdpTransport`, so this code runs unchanged over
 * `chrome.debugger.sendCommand` (this extension) and Playwright's `CDPSession`
 * (`@real-a11y-dev/browser`). Vocabulary (which nodes survive, sibling order,
 * role map, name promotion) comes from `@real-a11y-dev/core`'s shared
 * `normalizeNativeAX` — the one versioned module (RFC R4); this file adds only
 * the transport plumbing, mirroring the browser producer.
 *
 * The **structural** read (which nodes survive, sibling order, role map, name
 * promotion) is genuinely shared through that core module. The **states /
 * properties** enrichment on top of it (`expanded`, `checked`, `level`, …) is
 * not, for the same reason the **action** path isn't: `normalizeNativeAX`
 * stays a pure structural normalizer by design (R4), so this mirrors
 * `browser`'s `axFacets` rather than growing a second enrichment path in
 * core — see the block comment above {@link EnrichedNativeNode}. The action
 * functions cross into the page as source text, so they are a deliberate,
 * tested mirror of `browser`'s `page-actions.ts` rather than an import — see
 * the block comment above `pageClick` for why, and the tests that pin the
 * behaviour.
 *
 * Redaction discipline (R1) matches the browser side: a value typed into a
 * field never crosses back out of an action — the in-page action functions
 * return only a structural marker, and errors are content-free. Names come
 * from `normalizeNativeAX` as they are: it never promotes a node's value into
 * its name, so what a user typed into an editor stays out of it here exactly
 * as in `browser`. Don't add a second strip here; a rule both transports need
 * belongs in core.
 *
 * Field VALUES follow ADR-0001: a node's value is what a screen reader
 * announces — Chromium's own AX value — and a sensitive field's is withheld.
 * Sensitivity is classified in-page by `pageReadValue` before any value is
 * used, and a node it could not classify shows none (see `fieldFacets`).
 */

import {
  nativeAXStateValue,
  normalizeNativeAX,
  REDACTED_VALUE,
  serializeNativeAX,
  type A11yInfo,
  type NativeAXNode,
  type RawNativeAXNode,
} from "@real-a11y-dev/core";

/**
 * The sentinel a sensitive field's `value` arrives as on the wire — never the
 * raw secret (R1). A node that carries it also carries `redacted: true`,
 * which is what a consumer tests: the sentinel's text alone can't tell "this
 * is the redaction marker" from "an editor happens to hold these words".
 *
 * Core's own marker, so both producers write the same one (ADR-0001). NOT
 * referenced by `pageReadValue` below, which is serialized via `String(fn)`
 * for `Runtime.callFunctionOn` and must stay fully self-contained: it
 * returns a `redacted` flag instead, and this file's (non-serialized)
 * `fieldFacets` is where that flag becomes this value on a node.
 */
export const NATIVE_REDACTED_VALUE = REDACTED_VALUE;

/**
 * The full CDP `Accessibility.AXNode` shape, a superset of core's structural
 * {@link RawNativeAXNode} — core only reads `role`/`name`/tree-shape fields,
 * but Chromium always sends `properties` (`expanded`, `checked`, `level`, …)
 * on the wire regardless of which subset a caller's type asks for.
 *
 * **Deliberate mirror** of `@real-a11y-dev/browser`'s `RawAXNode`/`axFacets`
 * (`native-tree.ts`). The structural read stays genuinely shared through
 * `normalizeNativeAX` — this is the same "richer AX→a11y mapping" `browser`
 * layers on top of that shared base, duplicated here for the reason the file
 * header already gives for the action functions: `browser` carries
 * Playwright, no good in an MV3 worker, and core stays a pure structural
 * normalizer by design (R4) rather than growing a second enrichment path.
 */
interface RawAXNode extends RawNativeAXNode {
  properties?: Array<{
    name: string;
    value?: { type?: string; value?: unknown };
  }>;
  description?: { value?: string };
}

/**
 * AX property names that map to boolean/stateful `a11y.states`. Kept in
 * lockstep with `browser`'s `STATE_PROPS` — the shared ARIA-derived keys
 * (`checked`, `expanded`, `pressed`, `selected`, `disabled`, `required`,
 * `invalid`) match what the DOM producer writes, so cross-producer dogfood
 * comparison reads the same vocabulary.
 */
const STATE_PROPS = new Set([
  "focusable",
  "focused",
  "editable",
  "settable",
  "checked",
  "expanded",
  "pressed",
  "selected",
  "disabled",
  "readonly",
  "required",
  "multiline",
  "invalid",
  "modal",
  "busy",
]);

/**
 * AX property names that map to descriptive `a11y.properties` (strings).
 *
 * R1: `valuenow` / `valuetext` stay EXCLUDED here — this is Chromium's own
 * CDP payload, and it cannot be trusted to have already redacted a sensitive
 * field: it masks passwords but not, e.g. a `cc-number` field on a plain
 * `type="text"` input (the exact caveat `browser`'s own R1 header
 * documents). A node's value reaches it only as `value`, through
 * `fieldFacets`, and only once `pageReadValue` has classified the element
 * in-page — the RFC's own requirement for when values are "genuinely
 * needed": "capture MUST classify sensitivity in-page." Piping these two
 * properties through untouched would bypass that classification entirely.
 * `valuemin` / `valuemax` are authored bounds, not user data, so they stay.
 */
const DETAIL_PROPS = new Set([
  "level",
  "valuemin",
  "valuemax",
  "hasPopup",
  "keyshortcuts",
  "roledescription",
  "orientation",
  "autocomplete",
]);

/** The id `normalizeNativeAX` assigns a raw node, so a normalized node can be
 *  looked back up to its raw AX node for states/properties. Kept in lockstep
 *  with core's own `idOf` — asserted by this file's tests. */
function nativeIdOf(raw: RawAXNode): string {
  return typeof raw.backendDOMNodeId === "number"
    ? nativeIdForBackendNode(raw.backendDOMNodeId)
    : `ax-${raw.nodeId}`;
}

/** The native node id for a DOM-backed node: `ax-dom-<backendNodeId>`. The
 *  inverse of {@link backendNodeIdFrom}; build ids through this, never by
 *  hand, so the format lives in one place. */
export function nativeIdForBackendNode(backendNodeId: number): string {
  return `ax-dom-${backendNodeId}`;
}

/** Collapse internal whitespace and trim — matches `@real-a11y-dev/browser`'s
 *  own `cleanText`, kept in lockstep by hand for the reason every other
 *  mirrored piece of this file is: `browser` carries Playwright. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Split an AX node's `properties` into `states` (bool/stateful) and
 *  `properties` (descriptive strings), plus the accessible description —
 *  Chromium's own `aria-describedby`/`aria-description` resolution, a
 *  top-level AX field alongside `name`/`value`, not one of `properties`.
 *  Field VALUES are never read here (R1) — a description is page-authored
 *  help/error text, not user input, the same distinction `browser`'s own
 *  producer already draws (`native-tree.ts` surfaces it with no redaction
 *  gate at all). */
function axFacets(
  raw: RawAXNode,
): Pick<A11yInfo, "states" | "properties" | "description"> {
  const states: A11yInfo["states"] = {};
  const properties: A11yInfo["properties"] = {};
  for (const p of raw.properties ?? []) {
    const v = p.value?.value;
    if (v === undefined || v === null || typeof v === "object") continue;
    if (STATE_PROPS.has(p.name)) {
      states[p.name] = nativeAXStateValue(p.value!);
    } else if (DETAIL_PROPS.has(p.name)) {
      properties[p.name] = String(v);
    }
  }
  const description = raw.description?.value
    ? cleanText(String(raw.description.value))
    : "";
  return { states, properties, description };
}

/**
 * Roles whose backing DOM element could be an `<input>`/`<textarea>`/
 * `<select>` — the read-side counterpart of DOM producer's own tag check in
 * `getKeyAttributes` (`core/src/extraction/dom-extractor.ts`), approximated
 * from role since the AX tree carries no tag name. Matches
 * `core/src/extraction/role-map.ts`'s own input-type → role table
 * (`textbox`, `searchbox`, `spinbutton`, `slider`) plus `<select>`'s
 * single/multiple split (`combobox`/`listbox`).
 *
 * These are read in-page even while EMPTY, which Chromium reports with no AX
 * value at all: an empty field still has a placeholder to show and a raw
 * value (none) to prefill a retype with. Every other node is read only when
 * Chromium reports a value for it — an editor, a progress bar, a colour well.
 */
const VALUE_BEARING_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "spinbutton",
  "slider",
]);

/**
 * Roles announced by position in a range: a screen reader reads their
 * `aria-valuetext` in place of the number. Chromium's CDP payload never
 * carries `aria-valuetext` (its `valuetext` property is the number as text —
 * measured on Chromium 151), so `pageReadValue` reads the attribute in-page.
 * Mirrors core's `RANGE_VALUE_ROLES` (`dom-extractor.ts`).
 */
const RANGE_VALUE_ROLES = new Set([
  "slider",
  "spinbutton",
  "progressbar",
  "meter",
  "scrollbar",
]);

/** Roles whose checked/pressed STATE is what's announced — never a value.
 *  Mirrors core's `STATE_ONLY_ROLES` (`dom-extractor.ts`). */
const STATE_ONLY_ROLES = new Set([
  "checkbox",
  "radio",
  "switch",
  "menuitemcheckbox",
  "menuitemradio",
]);

/** The cap an announced value is cut to, with `…` — ADR-0001's 240
 *  characters, the same cap core's DOM producer applies
 *  (`getAnnouncedValue`). */
const VALUE_MAX = 240;

/** A normalized native node with the states/properties/description
 *  enrichment attached, plus the field facets `fieldFacets` resolves. */
export type EnrichedNativeNode = NativeAXNode &
  Pick<A11yInfo, "states" | "properties" | "description"> & {
    /**
     * What a screen reader announces for this node (ADR-0001) — Chromium's
     * own AX value (a `<select>`'s selected option LABEL, an editor's text),
     * or a range widget's `aria-valuetext` — whitespace-collapsed and capped
     * at 240 characters. A sensitive field that holds anything reads
     * {@link NATIVE_REDACTED_VALUE}. Absent when there is none, and whenever
     * `pageReadValue` could not classify the element.
     */
    value?: string;
    /**
     * Set when `value` is the redaction marker — a sensitive field that
     * holds something — so a consumer never has to compare `value` against
     * the marker text, which an editor could hold as ordinary content.
     */
    redacted?: boolean;
    /**
     * The raw live DOM value of a non-sensitive `<input>`/`<textarea>`/
     * `<select>` (`"es"` where `value` is `"Spain"`), uncollapsed and
     * uncapped — what a retype starts from, so an unedited submit writes
     * back exactly what was there. Never shown in the tree, and never set
     * for a sensitive field.
     */
    rawValue?: string;
    /** The field's static placeholder hint (`<input>`/`<textarea>` only) —
     *  page-authored text, not user input, so unlike `value` it is never
     *  redacted. Present only for a value-bearing role that actually has
     *  one set. */
    placeholder?: string;
  };

/** The single capability the native path needs from any CDP transport. */
export interface CdpTransport {
  send<T = unknown>(method: string, params?: object): Promise<T>;
}

export interface NativeTreeResult {
  /** Normalized nodes (shared core vocabulary) plus states/properties, document order. */
  nodes: EnrichedNativeNode[];
  /** Indented `role "name"` serialization, identical grammar to the DOM tree. */
  serialized: string;
  /** Raw AX node count before normalization — a dogfood size signal. */
  rawCount: number;
  /** Node count Chromium actually produced, after normalization but before
   *  `rootIdOf`'s synthetic root (if any) is pushed onto `nodes` — the other
   *  half of the `rawCount`/`keptCount` dogfood size signal. `nodes.length`
   *  itself is NOT this number on a multi-root page: it includes the
   *  synthesized wrapper, which Chromium never produced. */
  keptCount: number;
  /** The id of the tree's single root — see {@link rootIdOf}. Empty string
   *  for an empty tree. */
  rootId: string;
}

/**
 * Find or synthesize the tree's single root, and reconcile `depth` to match.
 *
 * Mirrors `@real-a11y-dev/browser`'s `native-tree.ts` exactly (same
 * deliberate-mirror reason every other piece of this file has: that package
 * carries Playwright). `normalizeNativeAX` drops the `RootWebArea` and
 * generic/ignored html/body wrappers, so any ordinary page whose body has
 * more than one kept child — a plain `<header>`/`<main>`/`<footer>` layout,
 * not just a cross-frame payload — yields multiple parent-less nodes. The
 * DOM producer always has exactly one root; a consumer that wants to render
 * this as one tree (rather than the dogfood panel's flat depth-indented
 * list, which never needed a root at all) needs the same guarantee, so a
 * synthetic `document` root adopts every parent-less node instead of
 * silently truncating every root but the first.
 *
 * Mutates `nodes` in place: unshifts the synthetic root to the front (if one
 * was needed) and rewrites every node's `depth` to be its real distance from
 * the returned root id, since wrapping shifts the former roots down a level.
 * Front, not back: every existing consumer of this array — the dogfood
 * panel's flat depth-indented list (`DogfoodPanel.tsx`) today, any preorder-
 * walking consumer tomorrow — renders/walks it in array order with no
 * separate root lookup, so a root appended after its own descendants would
 * render as an indented forest followed by its own root.
 */
/**
 * The synthetic root's id — exported so a consumer that must NOT treat it as
 * a real AX node (the dogfood panel's flat list, which has no rootId concept
 * to render relative to and would otherwise show a page-produced-nothing-
 * like-this "document" row on every multi-root page) can filter it out by
 * identity rather than duplicating this string as a second magic literal.
 */
export const SYNTHETIC_ROOT_ID = "ax-root";

export function rootIdOf(nodes: EnrichedNativeNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasParent = new Set<string>();
  for (const n of nodes) for (const c of n.childIds) hasParent.add(c);
  const roots = nodes.filter((n) => !hasParent.has(n.id));

  let rootId: string;
  if (roots.length === 1) {
    rootId = roots[0]!.id;
  } else if (roots.length > 1) {
    rootId = SYNTHETIC_ROOT_ID;
    const synthetic: EnrichedNativeNode = {
      id: rootId,
      role: "document",
      name: "",
      depth: 0,
      backendDOMNodeId: null,
      childIds: roots.map((r) => r.id),
      states: {},
      properties: {},
      description: "",
    };
    nodes.unshift(synthetic);
    byId.set(rootId, synthetic);
  } else {
    return "";
  }

  const setDepth = (id: string, depth: number): void => {
    const node = byId.get(id);
    if (!node) return;
    node.depth = depth;
    for (const childId of node.childIds) setDepth(childId, depth + 1);
  };
  setDepth(rootId, 0);
  return rootId;
}

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

/** Chromium's AX value for a node, when it reports a usable one. A `0` is a
 *  value; an empty or whitespace-only string is none. */
function announcedAXValue(
  raw: RawAXNode | undefined,
): string | number | undefined {
  const value = raw?.value?.value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return cleanText(value) ? value : undefined;
  return undefined;
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
      facets.value = NATIVE_REDACTED_VALUE;
      facets.redacted = true;
    }
    return facets;
  }
  if (read.value) facets.rawValue = read.value;

  const valuetext = RANGE_VALUE_ROLES.has(role)
    ? cleanText(read.valuetext ?? "")
    : "";
  const source = read.announced ?? axValue;
  const announced =
    valuetext ||
    (typeof source === "number"
      ? formatAXNumber(source)
      : cleanText(source ?? ""));
  if (announced) facets.value = capText(announced, VALUE_MAX);
  return facets;
}

/**
 * The structural backstop behind `pageReadValue`'s own shadow-host walk: no
 * node inside a sensitive one in the tree shows a value, whatever its own
 * verdict said. A sensitive field's parts (a month input's "Month" and "Year"
 * spinbuttons) and a wrapper's contents sit under it in Chromium's tree, so
 * this catches a part the in-page walk could not place. A nested sensitive
 * field's own `[redacted]` stays: it says "entered", never what.
 *
 * Exported for its tests.
 */
export function withholdInsideSensitive(
  nodes: EnrichedNativeNode[],
  sensitiveIds: readonly string[],
): void {
  if (sensitiveIds.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = sensitiveIds.flatMap((id) => byId.get(id)?.childIds ?? []);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (!node.redacted) {
      delete node.value;
      delete node.rawValue;
    }
    stack.push(...node.childIds);
  }
}

/** Numbers each tree read's remote-object group, so releasing one read's
 *  group never frees objects a concurrent read is still using. */
let fieldReadCount = 0;

/** Read + normalize the whole native AX tree over any CDP transport. */
export async function readNativeTree(
  transport: CdpTransport,
): Promise<NativeTreeResult> {
  await transport.send("Accessibility.enable");
  const full = await transport.send<{ nodes: RawAXNode[] }>(
    "Accessibility.getFullAXTree",
  );
  const nodes = normalizeNativeAX(full.nodes);
  // The structural walk (which nodes survive, roles, names, tree shape) is
  // the genuinely shared part — `normalizeNativeAX` doesn't read `properties`
  // at all, so this enrichment pass is additive, not a duplicate of it. One
  // pass over the raw list, keyed by the same id `normalizeNativeAX` assigns,
  // rather than a per-node lookup.
  const rawById = new Map(full.nodes.map((raw) => [nativeIdOf(raw), raw]));
  const enriched: EnrichedNativeNode[] = nodes.map((node) => {
    const raw = rawById.get(node.id);
    const { states, properties, description } = raw
      ? axFacets(raw)
      : { states: {}, properties: {}, description: "" };
    return { ...node, states, properties, description };
  });

  // Field values (see `fieldFacets`) — each candidate classified in-page by
  // `pageReadValue` before any value is used, concurrently, so a form-heavy
  // page costs one round of parallel CDP calls rather than N sequential ones
  // stacked onto the tree read. A range role is a candidate even with no AX
  // value: its `aria-valuetext`, which CDP never carries, may be all it has.
  // Every remote object the pass resolves joins one group, released after it
  // — otherwise each read would pin its elements for the life of the session.
  await transport.send("DOM.enable");
  const objectGroup = `sn-field-values-${++fieldReadCount}`;
  const sensitiveIds: string[] = [];
  try {
    await Promise.all(
      enriched.map(async (node) => {
        if (STATE_ONLY_ROLES.has(node.role)) return;
        const axValue = announcedAXValue(rawById.get(node.id));
        if (
          axValue === undefined &&
          !VALUE_BEARING_ROLES.has(node.role) &&
          !RANGE_VALUE_ROLES.has(node.role)
        ) {
          return;
        }
        const backendNodeId = backendNodeIdFrom(node.id);
        if (backendNodeId === null) return;
        const read = await readFieldValue(
          transport,
          backendNodeId,
          objectGroup,
        );
        if (read.classified && read.sensitive) sensitiveIds.push(node.id);
        Object.assign(node, fieldFacets(node.role, axValue, read));
      }),
    );
  } finally {
    await transport
      .send("Runtime.releaseObjectGroup", { objectGroup })
      .catch(() => {});
  }
  withholdInsideSensitive(enriched, sensitiveIds);

  // `serializeNativeAX(nodes)` runs on the pre-wrap list, matching every
  // other pre-enrichment field it already serializes from (states/
  // properties/value/description never reach the plain-text output either)
  // — the synthetic root, if any, is a rendering/dispatch concern only.
  const serialized = serializeNativeAX(nodes);
  const keptCount = enriched.length;
  const rootId = rootIdOf(enriched);

  return {
    nodes: enriched,
    serialized,
    rawCount: full.nodes.length,
    keptCount,
    rootId,
  };
}

/** Actions the native backend can dispatch. Others are refused, not guessed. */
export type NativeAction =
  "click" | "type" | "focus" | "increment" | "decrement" | "select";

export interface NativeDispatchResult {
  success: boolean;
  /** Content-free reason string only — never page text (R1/R6 invariant). */
  error?: string;
}

/**
 * A normalized native node's id encodes its Chromium `backendDOMNodeId`
 * (`ax-dom-<n>`) when a DOM element backs it. Parse it back, or `null` for
 * `ax-<n>` (no backing DOM element — a synthesized root or UA-internal node).
 * Kept identical to `@real-a11y-dev/browser`'s `backendNodeIdFrom`.
 */
export function backendNodeIdFrom(nodeId: string): number | null {
  const m = /^ax-dom-(\d+)$/.exec(nodeId);
  return m ? Number(m[1]) : null;
}

const SUPPORTED = new Set<NativeAction>([
  "click",
  "type",
  "focus",
  "increment",
  "decrement",
  "select",
]);

/**
 * Dispatch a click / type / focus against a native node over any CDP transport.
 * Resolves the node's backend id to a live DOM element (`DOM.resolveNode`) and
 * runs the action in-page (`Runtime.callFunctionOn`). The typed value is passed
 * INTO the page but never returned; failures surface as static reason strings.
 */
export async function dispatchNative(
  transport: CdpTransport,
  nodeId: string,
  action: NativeAction,
  value?: string,
): Promise<NativeDispatchResult> {
  if (!SUPPORTED.has(action)) {
    return { success: false, error: `unsupported action "${action}"` };
  }
  const backendNodeId = backendNodeIdFrom(nodeId);
  if (backendNodeId === null) {
    return { success: false, error: "node has no backing DOM element" };
  }
  if (action === "type" && typeof value !== "string") {
    return {
      success: false,
      error: 'the "type" action requires a string value',
    };
  }

  let objectId: string | undefined;
  try {
    await transport.send("DOM.enable");
    const resolved = await transport.send<{ object?: { objectId?: string } }>(
      "DOM.resolveNode",
      { backendNodeId },
    );
    objectId = resolved.object?.objectId;
  } catch {
    return {
      success: false,
      error: "could not resolve node — re-read the tree",
    };
  }
  if (!objectId) {
    return {
      success: false,
      error: "could not resolve node — re-read the tree",
    };
  }

  try {
    const marker = await runInPage(transport, objectId, action, value);
    if (marker?.ok) return { success: true };
    return { success: false, error: marker?.reason ?? "action failed" };
  } catch {
    return {
      success: false,
      error: "the action could not be dispatched over CDP",
    };
  }
}

type Marker = { ok?: boolean; reason?: string };

/* eslint-disable @typescript-eslint/no-this-alias --
 * `Runtime.callFunctionOn` invokes these with the target element as `this`, so
 * the element genuinely arrives that way. The local alias is not stylistic:
 * TypeScript narrows a `const` (`el instanceof HTMLInputElement`) but will not
 * narrow `this`, and the type path depends on that narrowing to keep a custom
 * element away from the native value setter. */

/*
 * ── The functions that run INSIDE the page ──────────────────────────────────
 *
 * Each is serialized with `String(fn)` and handed to `Runtime.callFunctionOn`
 * as SOURCE TEXT, not a closure. Everything a function needs must live in its
 * own body: no imports, no module-scope constants, no shared helpers. That is
 * why the composite-role list is declared inside the function rather than
 * hoisted — hoisting produces a `ReferenceError` in the page, not a compile
 * error here. Writing them as real functions (rather than template strings) is
 * what gets them type-checked and linted at all.
 *
 * **Deliberate mirror.** These mirror `@real-a11y-dev/browser`'s
 * `page-actions.ts`, which in turn mirrors core's in-page `ActionDispatcher`.
 * The serialization constraint is what forces a copy instead of an import, and
 * neither original is reachable here: `browser` carries Playwright (no good in
 * an MV3 worker), and core's dispatcher lives *in the page* — precisely what
 * the native path deliberately works without. Sharing via `core` was measured
 * and rejected: core sits ~30 bytes under its gzip budget.
 *
 * The behaviour is not arbitrary — it was earned on real pages. A bare
 * `element.click()` fires `click` alone and silently no-ops on jsaction/Material
 * handlers that gate on a pointer sequence; a click on a composite-widget
 * wrapper misses the delegated handler, which walks *upward* from the target.
 * A raw `textContent` write loses to model-driven editors (ProseMirror, Lexical,
 * Draft), which consume `beforeinput` and then revert the DOM underneath.
 *
 * R1: a marker carries structure only — never the typed text or the element's
 * resulting value.
 */

/** Click the way a real pointer does, redirecting composite wrappers. */
export function pageClick(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };

  // Composite-widget children are commonly containers wrapping the real
  // control. querySelector returns document order — the row's primary action,
  // not an inner chevron. Well-formed ARIA matches nothing and the wrapper is
  // used unchanged.
  let target: Element = el;
  const role = el.getAttribute("role") || "";
  const composite = [
    "treeitem",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "row",
    "gridcell",
    "cell",
  ];
  if (composite.indexOf(role) !== -1) {
    const inner = el.querySelector(
      '[role="link"], [role="button"], a[href], button',
    );
    if (inner) target = inner;
  }

  const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const pointer = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    pointerType: "mouse",
    isPrimary: true,
  };
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", base));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", base));
  target.dispatchEvent(new MouseEvent("click", base));
  return { ok: true };
}

/** Move real keyboard focus. */
export function pageFocus(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const focusable = el as HTMLElement;
  if (typeof focusable.focus !== "function") {
    return { ok: false, reason: "not-focusable" };
  }
  focusable.focus();
  return { ok: true };
}

/** Replace a field's value; the text goes IN but never comes back out. */
export function pageType(this: Element, text: string): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  // `instanceof` (not a tagName check) keeps a custom element from ever
  // reaching a native setter — the setters brand-check their receiver and
  // throw on the wrong element type.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  const editable = el as HTMLElement;
  const editableAttr = editable.getAttribute("contenteditable");
  const isEditable =
    editable.isContentEditable === true ||
    editableAttr === "" ||
    editableAttr === "true" ||
    editableAttr === "plaintext-only";
  if (isEditable) {
    // Clearing is a deletion. An `insertText` carrying no data asks a
    // model-driven editor to insert nothing, so its content stays while the
    // marker reports success. Select everything first — Lexical reads the DOM
    // selection, Slate the event's target range — so the deletion covers the
    // whole editor rather than the character at the caret. It is Backspace
    // over that selection: Chromium blanks an `inputType` it doesn't know,
    // and the spec's `deleteContent` is one of them.
    const clearing = text === "";
    const init: InputEventInit = {
      bubbles: true,
      cancelable: true,
      inputType: clearing ? "deleteContentBackward" : "insertText",
      data: clearing ? null : text,
    };
    if (clearing) {
      const doc = editable.ownerDocument;
      const range = doc.createRange();
      range.selectNodeContents(editable);
      const selection = doc.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof StaticRange === "function") {
        init.targetRanges = [
          new StaticRange({
            startContainer: editable,
            startOffset: 0,
            endContainer: editable,
            endOffset: editable.childNodes.length,
          }),
        ];
      }
    }
    // Model-driven editors consume this and apply it to their own document
    // model; writing textContent anyway would be reverted underneath us.
    const notHandled = editable.dispatchEvent(
      new InputEvent("beforeinput", init),
    );
    if (notHandled) {
      editable.textContent = text;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: init.inputType,
          data: init.data,
        }),
      );
    }
    return { ok: true };
  }

  return { ok: false, reason: "not-a-text-field" };
}

/**
 * In-page sensitivity classification for the native tree's field values.
 *
 * The native tree originally withheld every field's current value outright —
 * no read path existed, `valuenow`/`valuetext` excluded from `axFacets`
 * above. That blanket redaction under-served the product's actual purpose:
 * Semantic Navigator's Screen Curtain mode has a user rely entirely on the
 * accessible tree to perceive the page, which for a value-bearing control
 * means confirming what they just typed — the same read-back a screen reader
 * gives for free. Withholding it made native mode strictly worse than DOM
 * mode for the one workflow native mode exists to dogfood.
 *
 * This adds it back with the SAME redaction the DOM producer already applies
 * (`isSensitiveField` in `core/src/extraction/dom-extractor.ts`), inlined
 * rather than imported for the reason every other in-page function in this
 * file gives: serialized as source text for `Runtime.callFunctionOn`, so no
 * imports or module-scope references survive the trip. The RFC's own R1 text
 * anticipated exactly this case: "When live field values are genuinely
 * needed later, capture MUST classify sensitivity in-page" — this is that
 * classification, not a reversal of R1. Chromium's own CDP payload cannot be
 * trusted to have already redacted the field for us (see `DETAIL_PROPS`'s
 * comment above), so classification happens here, against the live element,
 * before anything crosses back out.
 *
 * Since ADR-0001 the value SHOWN is not this function's raw read but what a
 * screen reader announces — Chromium's AX value, so a `<select>` reads its
 * option label ("Spain"), not its `value` ("es"). This function is the gate
 * in front of that: `fieldFacets` uses a node's AX value only once this has
 * classified the element as not sensitive. So it answers for EVERY element,
 * not just form fields — `{ classified: true }` for a contenteditable editor
 * or an ARIA widget, which the policy never counts as sensitive (it covers
 * only `input`/`textarea`/`select`, as core's `isSensitiveFieldAttributes`
 * does) unless a sensitive field sits inside it — and it classifies an EMPTY
 * sensitive field too, so a value Chromium reported a moment earlier can
 * never stand in for it. For an `<input>` or `<textarea>` it also returns the
 * text the field announces (`announced`), read in this same call, so the
 * verdict and the value can't come from two different moments. The raw
 * `.value` it returns for a non-sensitive field is for a retype's prefill,
 * never for display.
 *
 * The sensitive-token list below is a copy of core's exported
 * `SENSITIVE_AUTOCOMPLETE_TOKENS`, because nothing outside this body survives
 * the trip into the page. A parity test reads the list back out of this
 * function's source text — exactly what `Runtime.callFunctionOn` receives —
 * and fails if it and core's drift apart in either direction. Keep it one
 * array literal under this name.
 *
 * Reads `value`/`type` via each class's OWN property descriptor
 * (`Object.getOwnPropertyDescriptor(...).get.call(el)`) rather than
 * `el.value`/`el.type` directly, `autocomplete` via
 * `Element.prototype.getAttribute.call(el, ...)` rather than
 * `el.getAttribute(...)`, and what kind of element it is via the pinned
 * `localName` rather than `instanceof` — the same defense `pageType` already applies to
 * its setter, for the same class of reason: an instance-level property
 * (`el.type = "text"`, shadowing the real one) or a careless page-side
 * reassignment is the easy, realistic way a sensitivity check like this one
 * gets fooled, and pinning to the prototype's own accessor closes it. It
 * does NOT close a page that redefines the prototype accessor itself before
 * this function ever runs — chrome.debugger attaches after the page has
 * already loaded and may have already run arbitrary code, so no read that
 * happens at that point can un-patch an already-patched prototype. That
 * residual is not new here: `core`'s `isSensitiveField` — the DOM
 * producer's own, already-shipped redaction this mirrors, reachable today
 * via the production side panel's field-state read — has no pinning at
 * all. This closes the easy case relative to that baseline; it does not
 * claim to be adversarially bulletproof, and shouldn't be read as such.
 */
export function pageReadValue(this: Element): PageFieldRead {
  const el = this;
  if (!el) return {};

  // Every read goes through a prototype's own accessor, never the element's
  // (see above). A `this` that is not a Node makes the first one throw, which
  // reaches the caller as no answer at all: unclassified, so nothing shows.
  const accessor = (proto: object, name: string) =>
    Object.getOwnPropertyDescriptor(proto, name)!.get!;
  // Not an element: nothing to classify, so the caller shows nothing.
  if (accessor(Node.prototype, "nodeType").call(el) !== 1) return {};
  const localName = accessor(Element.prototype, "localName");
  const getAttribute = Element.prototype.getAttribute;
  const inputType = accessor(HTMLInputElement.prototype, "type");

  const SENSITIVE_AUTOCOMPLETE_TOKENS = [
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
  ];
  // ADR-0001's policy, as core's `isSensitiveFieldAttributes` states it, for
  // an input, textarea or select. The TAG decides what a field is, never
  // `instanceof`: that fails across realms and bends to a page that swaps an
  // element's prototype, and a field it missed would read as a non-field —
  // never sensitive, its value shown.
  const isSensitive = (field: Element, tag: string): boolean => {
    if (tag === "input" && inputType.call(field) === "password") return true;
    const autocomplete = getAttribute.call(field, "autocomplete");
    if (!autocomplete) return false;
    for (const token of autocomplete.toLowerCase().split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE_TOKENS.indexOf(token) !== -1) return true;
    }
    return false;
  };

  const tag = localName.call(el) as string;
  // `aria-valuetext` is page-authored — what a screen reader reads for a range
  // widget in place of its number — and Chromium's CDP payload never carries
  // it, so it is read here, for any element.
  const valuetext = getAttribute.call(el, "aria-valuetext");
  const authored = valuetext ? { valuetext } : {};

  // A PART of a sensitive field is as sensitive as the field. Chromium builds
  // a date or month input from spinbuttons inside the input's UA shadow root,
  // each announcing its part of the value — so a `cc-exp` month input's
  // "Month" and "Year" would read the expiry date. Walk out through every
  // shadow root this element sits in; a sensitive field hosting any of them
  // withholds this element's value. Its parts carry no `[redacted]` of their
  // own: the field itself says that once.
  const nodeType = accessor(Node.prototype, "nodeType");
  const shadowHost = accessor(ShadowRoot.prototype, "host");
  for (let inner: Node = el; ;) {
    const root = Node.prototype.getRootNode.call(inner);
    if (nodeType.call(root) !== 11) break; // not in a shadow root
    let host: Element;
    try {
      host = shadowHost.call(root) as Element;
    } catch {
      break; // a plain fragment: a detached subtree, not a shadow root
    }
    const hostTag = localName.call(host) as string;
    if (
      (hostTag === "input" || hostTag === "textarea" || hostTag === "select") &&
      isSensitive(host, hostTag)
    ) {
      return { classified: true, sensitive: true };
    }
    inner = host;
  }

  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    // Not a form field, so never sensitive itself: its value is whatever
    // Chromium announces for it (an editor's text, a custom slider's number).
    // Chromium computes that from the element's content, so a sensitive field
    // nested inside withholds the whole value. Chromium 151 leaves a nested
    // control's value out of its wrapper's (measured); this does not bet on
    // every version doing so.
    const nested = Element.prototype.querySelectorAll.call(
      el,
      "input, textarea, select",
    );
    for (let i = 0; i < nested.length; i++) {
      const control = nested[i]!;
      if (isSensitive(control, localName.call(control) as string)) {
        return { classified: true, sensitive: true, ...authored };
      }
    }
    return { classified: true, ...authored };
  }

  // Placeholder is page-authored hint text, not user input — same distinction
  // `description` already draws (R1 only concerns a field's live VALUE) — so
  // it is returned for a redacted or empty field too: it's the one thing
  // worth showing an empty sensitive field for. `<select>` has none.
  const own = (proto: object, name: string): unknown =>
    accessor(proto, name).call(el);
  let value: string;
  let placeholder = "";
  // What an input or textarea announces, read in this same call — see
  // `PageFieldRead.announced`. A select's announced LABEL is Chromium's.
  let announced: string | undefined;
  if (tag === "input") {
    value = own(HTMLInputElement.prototype, "value") as string;
    placeholder = own(HTMLInputElement.prototype, "placeholder") as string;
    const type = inputType.call(el) as string;
    if (type === "file") {
      // Its `.value` is a fake path, and it is never retyped.
      const files = own(HTMLInputElement.prototype, "files") as FileList | null;
      const names: string[] = [];
      for (let i = 0; files && i < files.length; i++)
        names.push(files[i]!.name);
      announced = names.join(", ");
      value = "";
    } else if (
      // Core's VALUELESS_INPUT_TYPES: a state, a name, or nothing says these.
      [
        "checkbox",
        "radio",
        "button",
        "submit",
        "reset",
        "image",
        "hidden",
      ].indexOf(type) !== -1
    ) {
      announced = "";
    } else {
      announced = value;
    }
  } else if (tag === "textarea") {
    value = own(HTMLTextAreaElement.prototype, "value") as string;
    placeholder = own(HTMLTextAreaElement.prototype, "placeholder") as string;
    announced = value;
  } else {
    value = own(HTMLSelectElement.prototype, "value") as string;
  }
  const answered = {
    classified: true,
    ...authored,
    ...(placeholder ? { placeholder } : {}),
  };

  // Classified whether or not it holds anything: an empty sensitive field
  // still says so, so no AX value read before it was cleared can show.
  if (isSensitive(el, tag)) {
    return value || announced
      ? { ...answered, sensitive: true, redacted: true }
      : { ...answered, sensitive: true };
  }
  return {
    ...answered,
    ...(value ? { value } : {}),
    ...(announced !== undefined ? { announced } : {}),
  };
}

/**
 * Step a value-bearing control by one unit — native `stepUp()`/`stepDown()`
 * for a real `<input type="range"|"number">`, else dispatch `ArrowRight`/
 * `ArrowLeft` on the element itself. Mirrors core's `ActionDispatcher`'s
 * `handleStep`/`dispatchArrowStep`
 * (`core/src/interaction/action-dispatcher.ts`) exactly, inlined for the
 * same reason every other in-page function here is: serialized as source
 * text for `Runtime.callFunctionOn`, so no imports or module-scope
 * references survive the trip. One function taking a signed `delta`, not
 * two — matching `handleStep`'s own shape rather than duplicating the whole
 * body per direction.
 *
 * Custom ARIA sliders (Radix, Headless UI, the W3C APG examples themselves)
 * install their keyboard listener on the slider element itself, so
 * dispatching there reaches the handler regardless of which element
 * currently holds focus — but a real, common share of them additionally
 * gate the handler on `document.activeElement === this` (a reasonable
 * assumption for hand-written widget code: a real user can only reach the
 * handler by having tabbed to the thumb first). Live dogfood finding:
 * "still unable to interact with the sliders" on the W3C multi-thumb
 * example — this function's marker reported `{ ok: true }` (the events
 * genuinely dispatched) while `aria-valuenow` never moved, because the
 * dogfooder's last real focus was the panel button, not the thumb. This
 * DIVERGES from core's `dispatchArrowStep`, which still doesn't call
 * `.focus()` first (see its own comment) — that decision predates this
 * finding and core has no report against it yet; the fix belongs here
 * until (or unless) the same gap is confirmed on the DOM producer too.
 *
 * `el.focus()` up front is safe specifically because the very next thing
 * this function does is the two-stage restore that already existed for a
 * different reason (a widget that moves focus to ITSELF as a side effect of
 * handling the key) — that restore doesn't care why focus moved, only that
 * it isn't where it started, so it undoes our own upfront call exactly the
 * same way. Restored in two stages, matching the DOM producer exactly:
 * synchronously (covers a widget that moves focus to itself inside its own
 * synchronous keydown handler, or nothing moving it at all, in which case
 * this undoes our own `.focus()` call) and via `setTimeout(0)` (covers a
 * Radix-style widget that schedules its OWN focus call through a state
 * update + re-render, landing on a microtask/RAF boundary after this
 * function has already returned).
 */
export function pageStep(this: Element, delta: number): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const input = el as HTMLInputElement;
    if (input.type === "range" || input.type === "number") {
      // Only stepUp()/stepDown() go in the try, matching core's own
      // handleStep exactly — dispatchEvent is never expected to throw (a
      // listener's own exception is reported to the global error handler,
      // not propagated back to the caller), so it stays outside the catch
      // that exists for an invalid step configuration. Keeping it outside
      // means a step can never double-fire: the native step already
      // succeeded by the time these run, so nothing here should fall
      // through to the keyboard path below.
      let stepped = false;
      try {
        if (delta > 0) input.stepUp();
        else input.stepDown();
        stepped = true;
      } catch {
        // stepUp/stepDown throw on an invalid configuration (e.g. already at
        // a bound with no step) — fall through to the keyboard path below so
        // the dogfooder still gets an attempt rather than a bare failure.
      }
      if (stepped) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
    }
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;
  (el as HTMLElement).focus?.({ preventScroll: true });
  const key = delta > 0 ? "ArrowRight" : "ArrowLeft";
  const init: KeyboardEventInit = {
    key,
    code: key,
    keyCode: delta > 0 ? 39 : 37,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  const restore = (): void => {
    if (
      previouslyFocused &&
      document.activeElement !== previouslyFocused &&
      previouslyFocused.isConnected
    ) {
      previouslyFocused.focus?.({ preventScroll: true });
    }
  };
  restore();
  setTimeout(restore, 0);
  return { ok: true };
}

/**
 * Choose a native `<option>` the way the DOM producer's own `handleSelect`
 * does for the `<select>` it belongs to — set the select's value and fire
 * `change` — rather than clicking it. Live dogfood finding: a native
 * `<select>`'s options (Chromium normalizes it to `combobox` →
 * `menuListPopup` → `option` on the native tree, e.g. Amazon's department
 * dropdown) showed up on the tree but had no way to act on them, matching
 * `ACTABLE`'s own long-standing exclusion of `option` — a synthetic click on
 * a real `<option>` is a no-op, since the browser renders the open list as
 * OS chrome, not DOM the click model reaches. This is a DEDICATED action,
 * not a `click` alias: `this instanceof HTMLOptionElement` is checked
 * in-page, against the live element, at dispatch time — the one place this
 * codebase can tell a real `<option>` apart from a custom
 * `role="option"` widget (impossible from the native tree's role-only data
 * alone, the reason `ACTABLE` stayed silent on it). A custom widget refuses
 * cleanly (`not-an-option`) rather than misfiring a wrong action.
 */
export function pageSelectOption(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  if (!(el instanceof HTMLOptionElement)) {
    return { ok: false, reason: "not-an-option" };
  }
  const select = el.closest("select");
  if (!select) return { ok: false, reason: "no-select-ancestor" };
  select.value = el.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

/* eslint-enable @typescript-eslint/no-this-alias */

/** The in-page source for each action, as `Runtime.callFunctionOn` wants it. */
export const IN_PAGE_ACTION_SOURCE: Record<NativeAction, string> = {
  click: String(pageClick),
  focus: String(pageFocus),
  type: String(pageType),
  increment: String(pageStep),
  decrement: String(pageStep),
  select: String(pageSelectOption),
};

/** Run the action's in-page function; returns only a structural marker. */
async function runInPage(
  transport: CdpTransport,
  objectId: string,
  action: NativeAction,
  value?: string,
): Promise<Marker | undefined> {
  const res = await transport.send<{ result?: { value?: Marker } }>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: IN_PAGE_ACTION_SOURCE[action],
      returnByValue: true,
      ...(action === "type" ? { arguments: [{ value }] } : {}),
      ...(action === "increment" || action === "decrement"
        ? { arguments: [{ value: action === "increment" ? 1 : -1 }] }
        : {}),
    },
  );
  return res.result?.value;
}

/** The in-page source for the field classification — same calling
 *  convention as `IN_PAGE_ACTION_SOURCE` above, but not itself a
 *  `NativeAction`: it runs during the tree walk, not on user dispatch. */
export const IN_PAGE_READ_VALUE_SOURCE = String(pageReadValue);

/**
 * Resolve one node's backing element and classify it in-page per
 * `pageReadValue`. Returns `{}` — unclassified, so no value is shown — for
 * anything that doesn't resolve: a failed resolve during a read-only
 * enrichment pass has nothing useful to do with a per-node failure, so it
 * degrades to "no value" rather than surfacing an error.
 */
async function readFieldValue(
  transport: CdpTransport,
  backendNodeId: number,
  objectGroup: string,
): Promise<PageFieldRead> {
  try {
    const resolved = await transport.send<{ object?: { objectId?: string } }>(
      "DOM.resolveNode",
      { backendNodeId, objectGroup },
    );
    const objectId = resolved.object?.objectId;
    if (!objectId) return {};
    const res = await transport.send<{
      result?: { value?: PageFieldRead };
    }>("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: IN_PAGE_READ_VALUE_SOURCE,
      returnByValue: true,
    });
    return res.result?.value ?? {};
  } catch {
    return {};
  }
}

/** First normalized node matching role + optional accessible-name substring. */
export function findNative<T extends NativeAXNode>(
  nodes: T[],
  role: string,
  nameIncludes?: string,
): T | undefined {
  return nodes.find(
    (n) =>
      n.role === role &&
      (nameIncludes === undefined ||
        n.name.toLowerCase().includes(nameIncludes.toLowerCase())),
  );
}
