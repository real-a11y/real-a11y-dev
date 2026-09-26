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
 * field never crosses back out — the in-page function returns only a structural
 * marker, and errors are content-free.
 */

import {
  normalizeNativeAX,
  serializeNativeAX,
  type A11yInfo,
  type NativeAXNode,
  type RawNativeAXNode,
} from "@real-a11y-dev/core";

/**
 * The sentinel a sensitive field's `value` arrives as on the wire — never the
 * raw secret (R1). Exported so a consumer can tell "the real value happens
 * to be this exact string" apart from "this is the redaction marker, not
 * data" — `App.tsx`'s native-activate handler needs that distinction so it
 * never offers this literal text back to the user as something to submit,
 * which would silently overwrite their real value with the word itself.
 *
 * NOT referenced by `pageReadValue` below, even though that's conceptually
 * where this sentinel is produced: that function is serialized via
 * `String(fn)` for `Runtime.callFunctionOn` and must stay fully
 * self-contained (no imports, no module-scope references — see its own
 * docs), so it keeps its own inline `"[redacted]"` literal there instead.
 * This constant is what everywhere ELSE that needs the sentinel imports,
 * including this file's own (non-serialized) `readNativeTree`, which is
 * where `pageReadValue`'s `redacted` flag actually becomes this value on a
 * node — so there is exactly one second copy of the literal, not a third.
 *
 * Importing this one constant does not pull `pageReadValue`'s (or any other
 * in-page action's) source text into a consumer's bundle — confirmed by
 * building the store bundle with `App.tsx` importing this directly and
 * grepping it for every other symbol unique to this file (`readNativeTree`,
 * `dispatchNative`, `backendDOMNodeId`, `pageSelectOption`, …): none of them
 * appear. Each is its own top-level binding, and esbuild's tree-shaking
 * proves the unreferenced ones dead independently of this one being kept.
 */
export const NATIVE_REDACTED_VALUE = "[redacted]";

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
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
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
 * R1: `valuenow` / `valuetext` stay EXCLUDED here, matching `browser` — this
 * is Chromium's own CDP payload, and it cannot be trusted to have already
 * redacted a sensitive field: it masks passwords but not, e.g. a `cc-number`
 * field on a plain `type="text"` input (the exact caveat `browser`'s own R1
 * header documents). `pageReadValue` below is where field values are
 * surfaced instead, precisely because it classifies sensitivity itself,
 * in-page, against the live element — the RFC's own requirement for when
 * values are "genuinely needed": "capture MUST classify sensitivity
 * in-page." Piping these two CDP properties through untouched would bypass
 * that classification entirely. `valuemin` / `valuemax` are authored bounds,
 * not user data, so they stay.
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
    ? `ax-dom-${raw.backendDOMNodeId}`
    : `ax-${raw.nodeId}`;
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
      // Chromium sends some states as booleans and some as "true"/"false"
      // strings; normalize the latter so native states read like DOM ones
      // (a tristate like aria-pressed="mixed" stays a string).
      states[p.name] =
        typeof v === "boolean"
          ? v
          : v === "true"
            ? true
            : v === "false"
              ? false
              : String(v);
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
 * single/multiple split (`combobox`/`listbox`). A node with one of these
 * roles but a non-native backing element (e.g. a custom `role="textbox"`
 * contenteditable div) resolves to "no value" from `pageReadValue`'s own tag
 * check — same as DOM producer's own badge, which likewise only reads
 * `.value` for these three tags.
 */
const VALUE_BEARING_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "spinbutton",
  "slider",
]);

/** A normalized native node with the states/properties/description
 *  enrichment attached, plus a redacted field value where `pageReadValue`
 *  found one. */
export type EnrichedNativeNode = NativeAXNode &
  Pick<A11yInfo, "states" | "properties" | "description"> & {
    value?: string;
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

  // Field-value read-back (see `pageReadValue`) — resolved only for candidate
  // roles, concurrently, so a form-heavy page costs one round of parallel CDP
  // calls rather than N sequential ones stacked onto the tree read.
  await transport.send("DOM.enable");
  await Promise.all(
    enriched.map(async (node) => {
      if (!VALUE_BEARING_ROLES.has(node.role)) return;
      const backendNodeId = backendNodeIdFrom(node.id);
      if (backendNodeId === null) return;
      const { value, redacted, placeholder } = await readFieldValue(
        transport,
        backendNodeId,
      );
      if (redacted) node.value = NATIVE_REDACTED_VALUE;
      else if (value) node.value = value;
      if (placeholder) node.placeholder = placeholder;
    }),
  );

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

/**
 * Move real keyboard focus. `preventScroll` always on, matching the DOM
 * producer's own `content.ts` focus call: its caller has usually already
 * scrolled/centered the element by other means, and a default-scroll
 * `.focus()` on top would re-snap it to a viewport edge or jump the page
 * out from under a user simply arrow-navigating the tree.
 */
export function pageFocus(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const focusable = el as HTMLElement;
  if (typeof focusable.focus !== "function") {
    return { ok: false, reason: "not-focusable" };
  }
  focusable.focus({ preventScroll: true });
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
    // Model-driven editors consume this and insert into their own document
    // model; writing textContent anyway would be reverted underneath us.
    const notHandled = editable.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    if (notHandled) {
      editable.textContent = text;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      );
    }
    return { ok: true };
  }

  return { ok: false, reason: "not-a-text-field" };
}

/**
 * Read-back for the dogfood panel's field-value display.
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
 * Matches `getKeyAttributes`'s own behaviour exactly, not just its intent: an
 * empty field gets no value at all (not even a redacted marker), and only
 * `input`/`textarea`/`select` are read — a custom `role="textbox"`
 * contenteditable widget is out of scope here the same way it's out of scope
 * there.
 *
 * Reads `value`/`type` via each class's OWN property descriptor
 * (`Object.getOwnPropertyDescriptor(...).get.call(el)`) rather than
 * `el.value`/`el.type` directly, and `autocomplete` via
 * `Element.prototype.getAttribute.call(el, ...)` rather than
 * `el.getAttribute(...)` — the same defense `pageType` already applies to
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
export function pageReadValue(this: Element): {
  value?: string;
  redacted?: boolean;
  placeholder?: string;
} {
  const el = this;
  if (!el) return {};

  let value: string;
  let type: string | undefined;
  // Placeholder is page-authored hint text, not user input — same distinction
  // `description` already draws (R1 only concerns a field's live VALUE) — so
  // it is read and returned unconditionally below, including for a redacted
  // or empty field: it's the one thing worth showing an empty sensitive
  // field's placeholder for. Only `<input>`/`<textarea>` have a native
  // `placeholder`; `<select>` has none. Read via the prototype's own
  // descriptor, the same defense `value`/`type` already get below, for the
  // same reason: a page-side instance shadow is the easy, realistic way an
  // unpinned read gets fooled.
  let placeholder: string | undefined;
  if (el instanceof HTMLInputElement) {
    value = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.get!.call(el) as string;
    type = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "type",
    )!.get!.call(el) as string;
    placeholder = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "placeholder",
    )!.get!.call(el) as string;
  } else if (el instanceof HTMLTextAreaElement) {
    value = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.get!.call(el) as string;
    placeholder = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "placeholder",
    )!.get!.call(el) as string;
  } else if (el instanceof HTMLSelectElement) {
    value = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.get!.call(el) as string;
  } else {
    return {};
  }
  const placeholderResult = placeholder ? { placeholder } : {};

  if (!value) return placeholderResult;

  if (type === "password") {
    return { redacted: true, ...placeholderResult };
  }
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
  const autocomplete = Element.prototype.getAttribute.call(el, "autocomplete");
  if (autocomplete) {
    for (const token of autocomplete.toLowerCase().split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE_TOKENS.indexOf(token) !== -1) {
        return { redacted: true, ...placeholderResult };
      }
    }
  }

  return { value, ...placeholderResult };
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

/** The in-page source for the field-value read-back — same calling
 *  convention as `IN_PAGE_ACTION_SOURCE` above, but not itself a
 *  `NativeAction`: it runs during the tree walk, not on user dispatch. */
const IN_PAGE_READ_VALUE_SOURCE = String(pageReadValue);

/**
 * Resolve one node's backing element to its live field value, redacted per
 * `pageReadValue`. Returns `{}` for anything that doesn't resolve — a failed
 * resolve during a read-only enrichment pass has nothing useful to do with a
 * per-node failure, so it degrades to "no value" rather than surfacing an
 * error for what is, for most nodes, an expected miss (most roles aren't
 * value-bearing at all).
 */
async function readFieldValue(
  transport: CdpTransport,
  backendNodeId: number,
): Promise<{ value?: string; redacted?: boolean; placeholder?: string }> {
  try {
    const resolved = await transport.send<{ object?: { objectId?: string } }>(
      "DOM.resolveNode",
      { backendNodeId },
    );
    const objectId = resolved.object?.objectId;
    if (!objectId) return {};
    const res = await transport.send<{
      result?: {
        value?: { value?: string; redacted?: boolean; placeholder?: string };
      };
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
