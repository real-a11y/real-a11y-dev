/**
 * Native accessibility-tree producer — Chromium's own tree over CDP, normalized
 * into the same `ExtractionResult` / `SemanticNode` model the DOM producer emits.
 *
 * This is the second producer from the native-tree RFC ("one model, two
 * producers"): where `@real-a11y-dev/core`'s extractors walk the light DOM,
 * this reads `Accessibility.getFullAXTree` and turns it into a `SemanticNode`
 * tree. It exists because Chromium exposes structure no in-page walk can reach
 * — most visibly a `<video controls>`'s user-agent-shadow controls (play,
 * scrubber, mute), which live in a closed shadow root.
 *
 * Read-only (Phase 1). Every node gets `a11y` (the product) and, when the AX
 * node has a backing DOM element, a `dom` facet. There is deliberately **no
 * `interaction` facet** — dispatching through the native tree is the CDP
 * `ActionBackend` of a later phase; a read-only tree lies less by omitting it.
 *
 * Vocabulary (which AX nodes survive, sibling order, role map, name promotion)
 * comes from core's shared `normalizeNativeAX` — this file does NOT re-implement
 * it (that was the drift bug RFC finding R4 consolidated away). It only adds
 * the transport (CDP), the richer AX→a11y mapping (states/properties/value),
 * the DOM enrichment, and the redaction gates.
 *
 * ## Field values (ADR-0001)
 * A field's value is page content: `a11y.value` holds what a screen reader
 * announces, taken from Chromium's own AX value — a text field's text, a
 * `<select>`'s selected option, a range widget's `aria-valuetext` else its
 * number, a file input's names, an editor's text. What is **sensitive** is
 * withheld: a field whose markup says `type="password"` or carries a
 * credential or payment `autocomplete` token (core's
 * {@link isSensitiveFieldAttributes}, read off the `type` / `autocomplete`
 * attributes this producer's DOM walk already records) reads `[redacted]` when
 * it holds anything — never Chromium's masking bullets, which give away the
 * length. So does anything inside such a field (a month input's UA-shadow
 * spinbuttons) or around it, and a container Chromium named from contents that
 * include one: see {@link fieldSensitivity}. That holds for a field the tree
 * has no node of its own for, too: what stands in for it there is classified
 * by the field's own markup (core's `fieldStandIns`).
 *
 * Nothing here reads an element's live `.value`, and the `dom` facet still
 * copies only an allowlist of structural / a11y attributes (never `value`): the
 * value reaches the tree through `a11y.value` alone, classified first. Core's
 * normalizer never promotes a node's value into its NAME (an unlabeled
 * field's, or an editor's typed text — the extension's native path shares that
 * rule): a value belongs in `a11y.value` and nowhere else.
 *
 * ## Strict mode — `redactInput` (RFC finding R1's blanket rule)
 * {@link NativeTreeOptions.redactInput} withholds every field value, sensitive
 * or not, and every rich-text editor's content. What a user typed into an
 * editor is its value — but Chromium also names the nodes inside the editor
 * from it (a paragraph's text, a link's, a heading's), so the same text reaches
 * the tree a second way. The strict mode closes that path at the source,
 * before normalization can promote anything: see {@link redactEditableContent}.
 *
 * (Caveat, documented not hand-waved: `getFullAXTree` / `getDocument`
 * responses themselves carry field values in their CDP payload — Chromium masks
 * passwords, but not, e.g., a `cc-number` on a plain text input. That is
 * Chromium's wire content, received in this process; what this code controls,
 * it classifies before anything leaves `buildNativeTree`.)
 */

import {
  normalizeNativeAX,
  nativeAXStateValue,
  serializeNativeAX,
  buildCssPath,
  finishAnnouncedValue,
  isSensitiveFieldAttributes,
  NATIVE_AX_CHOICE_STATES,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
  holdsEnteredValue,
  nativeAncestry,
  cleanAXText,
  fieldStandIns,
  givesValueAway,
  holdsUnclassifiedValue,
  indexNativeAX,
  isNativePasswordMask,
  nonEmptyAXText,
  nativeAXProperty,
  opensFieldInternals,
  valueRegions,
  withholdFieldInternals,
  withholdRegionNames,
  treeSource,
  type FieldHostOf,
  type FieldStandIn,
  type RawAXNameNode as RawAXNode,
  type NativeAXIndex,
  type ValueRegions,
  type SemanticNode,
  type ExtractionResult,
  type A11yInfo,
  type DomInfo,
} from "@real-a11y-dev/core";
import type { CDPSession, Page } from "playwright";

import { attributeOf, readDomRoot, type DomNode } from "./dom-document.js";
import {
  editableRootBackendIds,
  redactEditableContent,
  strictValueRoots,
} from "./native-editable.js";
import { createLocatorIndex } from "./native-locator.js";

/**
 * How {@link nativeTree} / {@link buildNativeTree} treat what users entered.
 */
export interface NativeTreeOptions {
  /**
   * Strict mode (ADR-0001's `redactInput`): withhold every field value — not
   * just the sensitive ones — and all rich-text editor content. No node
   * carries `a11y.value`, and inside a `contenteditable` / `designMode` region
   * a name Chromium computed from the typed text reads `[redacted]`. Default
   * `false`: values are shown the way a screen reader announces them, and only
   * sensitive fields are withheld.
   */
  redactInput?: boolean;
}

/** Structural / accessibility attributes we surface on the `dom` facet.
 *  Deliberately an ALLOWLIST — `value` and any other content-bearing or
 *  potentially-sensitive attribute is simply never copied (R1). */
const DOM_ATTR_ALLOWLIST = new Set([
  "id",
  "type",
  "role",
  "href",
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-describedby",
  "name",
  "for",
  "controls",
  "autoplay",
  "loop",
  "muted",
  "poster",
  "src",
  "lang",
  "dir",
  "disabled",
  "readonly",
  "required",
  "checked",
  "selected",
  "multiple",
  "open",
  "hidden",
  "autocomplete",
]);

/**
 * AX property names that map to boolean/stateful `a11y.states`.
 *
 * The shared ARIA-derived keys (`checked`, `expanded`, `pressed`, `selected`,
 * `disabled`, `required`, `invalid`) match what the DOM producer writes, so
 * those compare cleanly across producers. Native additionally exposes
 * Blink-computed state Chromium has but the in-page walk doesn't (`focusable`,
 * `focused`, `editable`, `settable`, `multiline`, `modal`, `busy`)
 * — a superset, not a conflict. Cross-producer state comparison is normalized
 * by the parity harness (RFC PR E), not relied on raw.
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
 * `valuenow` / `valuetext` are deliberately NOT here. For a range widget they
 * ARE its value, and a value has one home — `a11y.value`, where the
 * sensitivity policy and `redactInput` both apply ({@link announcedValue}). A
 * copy here would route around both. `valuemin` / `valuemax` are authored
 * bounds (min/max attributes), not user data, so they stay.
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

/** Derive the id core's {@link normalizeNativeAX} assigns, so we can look a
 *  normalized node back up to its raw AX node (for states/properties). Kept in
 *  lockstep with core; the round-trip is asserted in the producer's tests. */
function nativeIdOf(raw: RawAXNode): string {
  return typeof raw.backendDOMNodeId === "number"
    ? `ax-dom-${raw.backendDOMNodeId}`
    : `ax-${raw.nodeId}`;
}

// ── Field values (ADR-0001) ─────────────────────────────────────────────────

/**
 * The value a screen reader announces for `raw`, before sensitivity. Chromium's
 * AX `value` is the source: a text field's text, a `<select>`'s (and an ARIA
 * combobox's) selected text, a file input's names, a date input's value, an
 * editor's text. A range widget reads its `aria-valuetext` first (Chromium 151
 * does not report it over CDP, so it comes from the DOM walk), then Chromium's
 * `valuetext`, then its number. A checkbox or radio has none: its state says
 * it. The roles are core's, so both producers read the same kinds of field.
 */
function rawAnnouncedValue(
  raw: RawAXNode,
  role: string,
  enriched: NativeDomInfo | undefined,
): string | undefined {
  if (STATE_ONLY_ROLES.has(role)) return undefined;
  if (RANGE_VALUE_ROLES.has(role)) {
    return (
      nonEmptyAXText(enriched?.ariaValueText) ??
      nonEmptyAXText(nativeAXProperty(raw, "valuetext")?.value) ??
      nonEmptyAXText(raw.value?.value) ??
      nonEmptyAXText(nativeAXProperty(raw, "valuenow")?.value)
    );
  }
  return nonEmptyAXText(raw.value?.value);
}

/**
 * {@link rawAnnouncedValue}, finished by core's {@link finishAnnouncedValue} —
 * whitespace collapsed, capped at 240 characters with `…`, and
 * {@link REDACTED_VALUE} for a sensitive field that holds anything (or a value
 * that is Chromium's password mask). Empty reads as no value, so an agent can
 * tell "password entered" from "empty" but never the length.
 */
function announcedValue(
  raw: RawAXNode,
  role: string,
  enriched: NativeDomInfo | undefined,
  sensitive: boolean,
): string | undefined {
  const text = rawAnnouncedValue(raw, role, enriched);
  return finishAnnouncedValue(
    text,
    () => sensitive || isNativePasswordMask(text),
  );
}

/** Where the sensitive fields are, and what their values reach. */
interface FieldSensitivity {
  regions: ValueRegions;
  /** A value on this node must read `[redacted]`. */
  withholdsValue(raw: RawAXNode): boolean;
}

/**
 * Classify every node against the sensitivity policy — core's
 * {@link isSensitiveFieldAttributes}, over the tag and the `type` /
 * `autocomplete` attributes the DOM walk recorded. A field counts as sensitive
 * when its markup says so, when it holds Chromium's password mask, or when it
 * is DOM-backed, holds a value, and the DOM walk never saw it — a node the
 * page added between the two reads, or a caller that passed no enrichment:
 * unclassified is withheld, for its value and for every name built from it.
 *
 * A value is then withheld when its node IS such a field; is INSIDE one (a
 * `<input type="month" autocomplete="cc-exp">` exposes its month and year as
 * UA-shadow `spinbutton`s backed by a `<div>`: their own markup says nothing,
 * their ancestor says everything); or CONTAINS one (an editor or ARIA combobox
 * around a credential field may build its value from it).
 *
 * A field the tree has no node of its own for (a disabled one with
 * `role="none"`) is classified by its own markup all the same, and withholds
 * through what stands in for it there, its inner box or its parts (core's
 * `fieldStandIns`). One the DOM walk can't name is unclassified.
 */
function fieldSensitivity(
  rawNodes: RawAXNode[],
  index: NativeAXIndex,
  enrichment: ReadonlyMap<number, NativeDomInfo>,
  standIns: readonly FieldStandIn[],
): FieldSensitivity {
  const fields = new Set<string>();
  for (const raw of rawNodes) {
    const enriched =
      typeof raw.backendDOMNodeId === "number"
        ? enrichment.get(raw.backendDOMNodeId)
        : undefined;
    if (
      holdsUnclassifiedValue(raw, enriched !== undefined) ||
      isNativePasswordMask(raw.value?.value) ||
      (enriched !== undefined &&
        isSensitiveFieldAttributes(enriched.tagName, {
          type: enriched.attributes.type,
          autocomplete: enriched.attributes.autocomplete,
        }))
    ) {
      fields.add(raw.nodeId);
    }
  }
  // Only a field that can give its value away withholds names around it: an
  // empty one has nothing to give (see givesValueAway, which counts an ignored
  // field, whose value Chromium never sends, as able to).
  for (const id of fields) {
    const field = index.byId.get(id);
    if (!field || !givesValueAway(field, index.byId)) fields.delete(id);
  }
  // Stand-ins only come back when they give the field's value away.
  for (const { host, nodeIds, masked } of standIns) {
    const enriched = host === undefined ? undefined : enrichment.get(host);
    if (
      masked ||
      enriched === undefined ||
      isSensitiveFieldAttributes(enriched.tagName, {
        type: enriched.attributes.type,
        autocomplete: enriched.attributes.autocomplete,
      })
    ) {
      for (const id of nodeIds) fields.add(id);
    }
  }
  const regions = valueRegions(index, fields, standIns);
  return {
    regions,
    withholdsValue: (raw) =>
      regions.inside(raw) ||
      regions.containing.has(raw.nodeId) ||
      (typeof raw.backendDOMNodeId === "number" &&
        !enrichment.has(raw.backendDOMNodeId)),
  };
}

// ── Strict mode: rich-text editor content (`redactInput`) ──────────────────

/**
 * The `dom` attributes dropped inside an editable region: a URL the user typed
 * or pasted into a link or an image (an auto-linked `?token=` is the likeliest
 * secret in a message box), and an `id`, which some editors derive from a
 * heading's text. No sink prints these today; the strict mode holds by
 * construction rather than by that coincidence.
 */
const EDITABLE_CONTENT_ATTRIBUTES = new Set(["href", "src", "poster", "id"]);

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Every name-level redaction, applied to the raw nodes before core normalizes
 * them — the only point at which a name still says which node it came from.
 * Sensitive fields always ({@link withholdRegionNames} over
 * {@link fieldSensitivity}); in strict mode, every field value and all editor
 * content too ({@link withholdRegionNames} over {@link strictValueRoots}, then
 * {@link redactEditableContent}). And always, the text a form control draws
 * inside itself, which the DOM walk marks (`fieldHost`; core's
 * `withholdFieldInternals`).
 */
function prepareRawNodes(
  rawNodes: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo>,
  options: NativeTreeOptions,
): {
  nodes: RawAXNode[];
  sensitivity: FieldSensitivity;
  insideEditor: Set<RawAXNode>;
} {
  const index = indexNativeAX(rawNodes);
  // A node the DOM walk never saw is `undefined`: see core's FieldHostOf.
  const hostOf: FieldHostOf = (backendDOMNodeId) => {
    const info = enrichment.get(backendDOMNodeId);
    return info === undefined ? undefined : (info.fieldHost ?? null);
  };
  // Read before any text is blanked: a stand-in counts by what it holds.
  const standIns = fieldStandIns(index, hostOf);
  const sensitivity = fieldSensitivity(rawNodes, index, enrichment, standIns);
  const named = withholdRegionNames(rawNodes, sensitivity.regions);
  // Last: it blanks text runs only, which no step above keeps by identity.
  if (options.redactInput !== true) {
    return {
      nodes: withholdFieldInternals(named, hostOf),
      sensitivity,
      insideEditor: new Set(),
    };
  }
  // A button's internals hold its label, the page's, not what a user entered.
  const entered = standIns.filter(({ host }) => {
    const info = host === undefined ? undefined : enrichment.get(host);
    return !info || holdsEnteredValue(info.tagName, info.attributes.type);
  });
  const strict = withholdRegionNames(
    named,
    valueRegions(index, strictValueRoots(rawNodes, index, entered), entered),
  );
  const { nodes, inside } = redactEditableContent(strict);
  return {
    nodes: withholdFieldInternals(nodes, hostOf),
    sensitivity,
    insideEditor: inside,
  };
}

/**
 * The flat, text-only view of Chromium's native tree that
 * `BrowserSession.nativeAX()` returns: indented `role "name"` lines (the same
 * shape the DOM producer's serializer prints, so the two are comparable) plus
 * the same lines as a flat list of role+name pairs, for order- and
 * indent-insensitive diffing.
 *
 * Vocabulary and names both come from core's shared `normalizeNativeAX`, after
 * the same name redactions as {@link buildNativeTree} — so this view and the
 * `ExtractionResult` one can never disagree about what is on a page.
 */
export function nativeAXView(
  rawNodes: RawAXNode[],
  enrichment: ReadonlyMap<number, NativeDomInfo> = new Map(),
  options: NativeTreeOptions = {},
): {
  tree: string;
  pairs: string[];
} {
  const { nodes: prepared } = prepareRawNodes(rawNodes, enrichment, options);
  const nodes = normalizeNativeAX(prepared);
  return {
    tree: serializeNativeAX(nodes),
    pairs: nodes.map((n) => (n.name ? `${n.role} "${n.name}"` : n.role)),
  };
}

/**
 * Filter a CDP flat attribute list (`[name, value, name, value, …]`) down to
 * {@link DOM_ATTR_ALLOWLIST}. This is the R1 redaction gate: any attribute not
 * on the allowlist — most importantly `value` — is dropped, so no field value
 * ever reaches a node's `dom` facet. Exported so the gate is directly
 * unit-testable.
 */
export function allowlistAttributes(flat: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const key = flat[i];
    if (DOM_ATTR_ALLOWLIST.has(key)) attributes[key] = flat[i + 1];
  }
  return attributes;
}

/** {@link allowlistAttributes}' output minus what an editor's user supplied —
 *  see {@link EDITABLE_CONTENT_ATTRIBUTES}. */
function withoutEditableContent(
  attributes: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => !EDITABLE_CONTENT_ATTRIBUTES.has(key),
    ),
  );
}

/** `attributes` without the markup `selected` flag when the option's selection
 *  is withheld — an `<option selected>` would otherwise say what a sensitive
 *  `<select>` holds even with its AX state dropped. */
function withoutSelection(
  attributes: Record<string, string>,
  withhold: boolean,
): Record<string, string> {
  if (!withhold || !("selected" in attributes)) return attributes;
  const { selected: _dropped, ...rest } = attributes;
  return rest;
}

/** Split an AX node's `properties` into `states` (bool/stateful) and
 *  `properties` (descriptive strings). Field values are never read here. */
function axFacets(raw: RawAXNode): Pick<A11yInfo, "states" | "properties"> {
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
  return { states, properties };
}

/**
 * One CDP round-trip: the whole DOM tree (backendNodeId + tagName +
 * attributes) → a `backendDOMNodeId → { tagName, attributes, locator }` map.
 * Attributes are filtered to {@link DOM_ATTR_ALLOWLIST} as they are read, so no
 * field value is ever placed on a node (R1). This is the batched enrichment of
 * RFC finding R3 — no per-node `resolveNode` / `callFunctionOn`.
 *
 * The locator is computed *here*, during this same walk, because this is the
 * only place the native path ever sees document structure. Findings run in
 * Node with no live element, so without this they carry no "where" at all —
 * and `audit` is documented as rule · severity · locator. Computing it here
 * costs nothing extra: the parent/child links are already in hand.
 *
 * Below an `editableRoots` element the walk ignores `id`s, so a locator inside
 * an editor anchors on the nearest id outside it (typically the host's own):
 * an editor may derive a heading's `id` from its typed text. Only strict mode
 * passes any.
 */
async function enrichFromDom(
  client: CDPSession,
  editableRoots: ReadonlySet<number> = new Set(),
): Promise<Map<number, NativeDomInfo>> {
  const out = new Map<number, NativeDomInfo>();
  const root = await readDomRoot(client);

  const locators = createLocatorIndex();

  // `host`: the form control whose user-agent shadow root, where it draws its
  // value, holds this node (`NativeDomInfo.fieldHost`).
  const walk = (
    node: DomNode,
    inside: boolean,
    host: number | undefined,
  ): void => {
    locators.link(node, inside);
    if (typeof node.backendNodeId === "number" && node.nodeName) {
      const ariaValueText = attributeOf(node, "aria-valuetext");
      out.set(node.backendNodeId, {
        tagName: node.nodeName.toLowerCase(),
        attributes: allowlistAttributes(node.attributes ?? []),
        locator: buildCssPath(node, locators.adapter),
        ...(ariaValueText !== null ? { ariaValueText } : {}),
        ...(host !== undefined ? { fieldHost: host } : {}),
      });
    }
    const below =
      inside ||
      (typeof node.backendNodeId === "number" &&
        editableRoots.has(node.backendNodeId));
    for (const child of node.children ?? []) walk(child, below, host);
    if (node.contentDocument) walk(node.contentDocument, below, undefined);
    for (const sub of node.shadowRoots ?? []) {
      walk(
        sub,
        below,
        host ??
          (opensFieldInternals(node.nodeName, sub.shadowRootType)
            ? node.backendNodeId
            : undefined),
      );
    }
    // A `::before` or `::after` Chromium lays out as a box has a node of its
    // own in the tree: recorded as seen, with no element to describe.
    for (const pseudo of node.pseudoElements ?? []) {
      if (typeof pseudo.backendNodeId !== "number") continue;
      out.set(pseudo.backendNodeId, {
        tagName: (pseudo.nodeName ?? "").toLowerCase(),
        attributes: {},
        pseudo: true,
        ...(host !== undefined ? { fieldHost: host } : {}),
      });
    }
  };
  walk(root, false, undefined);
  return out;
}

/**
 * What the batched DOM walk records per backend node. `locator` is optional
 * because {@link buildNativeTree} is a pure function anyone can hand a map to —
 * a recorded fixture or a hand-built one has no document to walk. The live walk
 * always fills it.
 */
export interface NativeDomInfo {
  tagName: string;
  attributes: Record<string, string>;
  locator?: string;
  /**
   * The element's `aria-valuetext`, which a range widget announces instead of
   * its number — and which Chromium does not report over CDP. Read only into
   * `a11y.value` (so the value policy and strict mode govern it), never onto
   * the `dom` facet.
   */
  ariaValueText?: string;
  /**
   * The backend id of the `<input>`, `<textarea>` or `<select>` whose
   * user-agent shadow root holds the node, where the control draws what it
   * holds (core's `opensFieldInternals`). Its text never reaches the tree
   * (core's `withholdFieldInternalText`, which says why), and when the tree
   * has no node of the control's own, the node stands in for it, classified
   * by the control's markup (core's `fieldStandIns`).
   */
  fieldHost?: number;
  /**
   * A pseudo-element (`::before`, `::after`, `::marker`): content the page's
   * CSS generates, with no element of its own. The walk records it so its
   * node in the tree counts as seen, and gives it no `dom` facet.
   */
  pseudo?: boolean;
}

/** Both CDP reads a native tree is built from, over one session. */
async function readNative(
  client: CDPSession,
  options: NativeTreeOptions,
): Promise<{
  rawNodes: RawAXNode[];
  enrichment: Map<number, NativeDomInfo>;
}> {
  await client.send("Accessibility.enable");
  const { nodes: rawNodes } = (await client.send(
    "Accessibility.getFullAXTree",
  )) as { nodes: RawAXNode[] };
  const enrichment = await enrichFromDom(
    client,
    options.redactInput === true ? editableRootBackendIds(rawNodes) : new Set(),
  );
  return { rawNodes, enrichment };
}

/**
 * Read Chromium's native accessibility tree for `page` and normalize it into
 * an {@link ExtractionResult} stamped `source.producer === "native"`.
 *
 * Uses its own CDP session (created and detached here), so it composes with the
 * page-bundle DOM path without interfering. Read-only: nodes carry `a11y` and
 * (when resolvable) `dom`, never `interaction` or `ui`. Field values follow
 * ADR-0001 unless `options.redactInput` is set — see {@link NativeTreeOptions}.
 */
export async function nativeTree(
  page: Page,
  options: NativeTreeOptions = {},
): Promise<ExtractionResult> {
  const client = await page.context().newCDPSession(page);
  try {
    const { rawNodes, enrichment } = await readNative(client, options);
    const chrome = page.context().browser()?.version();
    return buildNativeTree(rawNodes, enrichment, chrome, options);
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * {@link nativeAXView} for a live page — both CDP reads, so the view's names
 * pass the same sensitivity classification as {@link nativeTree}'s.
 */
export async function nativeAXViewOf(
  page: Page,
  options: NativeTreeOptions = {},
): Promise<{ tree: string; pairs: string[] }> {
  const client = await page.context().newCDPSession(page);
  try {
    const { rawNodes, enrichment } = await readNative(client, options);
    return nativeAXView(rawNodes, enrichment, options);
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Pure AX→`ExtractionResult` assembly, split out so it can be unit-tested on a
 * recorded `getFullAXTree` payload with no browser. `enrichment` maps a backend
 * DOM node id to its (already allowlist-filtered) tag + attributes; a
 * DOM-backed node missing from it has any value withheld, since there is
 * nothing to classify it by.
 */
export function buildNativeTree(
  rawNodes: RawAXNode[],
  enrichment: Map<number, NativeDomInfo> = new Map(),
  chrome?: string,
  options: NativeTreeOptions = {},
): ExtractionResult {
  const redactInput = options.redactInput === true;
  // Core owns the vocabulary: which nodes survive, sibling order, role map,
  // name promotion, id derivation. We only decorate the survivors — after the
  // name-level redactions, so nothing core promotes can carry what they
  // withhold.
  const {
    nodes: prepared,
    sensitivity,
    insideEditor,
  } = prepareRawNodes(rawNodes, enrichment, options);
  const skeleton = normalizeNativeAX(prepared);
  const rawById = new Map<string, RawAXNode>();
  for (const raw of prepared) rawById.set(nativeIdOf(raw), raw);
  const rawByNodeId = new Map(prepared.map((raw) => [raw.nodeId, raw]));

  // A `<select>`'s value is also which of its options is `selected`: an
  // option's state would say what a withheld value is. Dropped for an option
  // inside a sensitive field, and in strict mode for one inside any choice
  // field (a combobox or listbox).
  const inChoiceField = (raw: RawAXNode): boolean => {
    for (const cur of nativeAncestry(raw, rawByNodeId)) {
      const role = cur.role?.value;
      if (cur !== raw && (role === "combobox" || role === "listbox"))
        return true;
    }
    return false;
  };

  const nodes = new Map<string, SemanticNode>();
  for (const nn of skeleton) {
    const raw = rawById.get(nn.id);
    const { states, properties } = raw
      ? axFacets(raw)
      : { states: {}, properties: {} };
    // One decision for both places the selection shows: the AX state and the
    // option's markup `selected` attribute on the `dom` facet.
    const withholdSelection =
      !!raw &&
      (sensitivity.regions.inside(raw) || (redactInput && inChoiceField(raw)));
    if (withholdSelection) {
      for (const state of NATIVE_AX_CHOICE_STATES) delete states[state];
    }

    const enriched =
      nn.backendDOMNodeId !== null
        ? enrichment.get(nn.backendDOMNodeId)
        : undefined;

    // What a screen reader announces — never in strict mode, and `[redacted]`
    // for anything the sensitivity policy covers.
    const value =
      raw && !redactInput
        ? announcedValue(
            raw,
            nn.role,
            enriched,
            sensitivity.withholdsValue(raw),
          )
        : undefined;

    const a11y: A11yInfo = {
      role: nn.role,
      // Core never promotes a node's value into its name, so this is safe to
      // take as-is: a value lives in `value`, below, or nowhere.
      name: nn.name,
      description: raw?.description?.value
        ? cleanAXText(String(raw.description.value))
        : "",
      ...(value !== undefined ? { value } : {}),
      states,
      properties,
      isExposedToAT: true,
    };

    const dom: DomInfo | undefined =
      enriched && enriched.pseudo !== true
        ? {
            tagName: enriched.tagName,
            attributes: withoutSelection(
              raw && insideEditor.has(raw)
                ? withoutEditableContent(enriched.attributes)
                : enriched.attributes,
              withholdSelection,
            ),
            textContent: null,
            descendantText: "",
            isHidden: false,
            ...(enriched.locator ? { locator: enriched.locator } : {}),
          }
        : undefined;

    const node: SemanticNode = {
      id: nn.id,
      parentId: null, // wired below
      childIds: nn.childIds,
      depth: nn.depth,
      a11y,
      // Read-only: no `interaction` (that is the CDP ActionBackend's phase) and
      // no panel-only `ui`. `dom` present only when a DOM node backed this.
      ...(dom ? { dom } : {}),
    };
    nodes.set(nn.id, node);
  }

  // Second pass: wire parentId from the skeleton's childIds (document order).
  for (const nn of skeleton) {
    for (const childId of nn.childIds) {
      const child = nodes.get(childId);
      if (child) child.parentId = nn.id;
    }
  }

  // Core's `normalizeNativeAX` drops the `RootWebArea` and generic/ignored
  // html/body wrappers, so ANY page whose body has more than one kept child —
  // a normal `<header>`/`<main>`/`<footer>` layout, not just cross-frame
  // payloads — yields multiple parent-less roots. `linearize`/`serializeTree`
  // only traverse `rootId`'s subtree, so picking the first root would silently
  // truncate every sibling. Synthesize a single `document` root that adopts
  // all parent-less nodes, matching the DOM producer (always exactly one root).
  const roots = [...nodes.values()].filter((n) => n.parentId === null);
  let rootId: string;
  if (roots.length === 1) {
    rootId = roots[0].id;
  } else if (roots.length > 1) {
    rootId = "ax-root";
    const synthetic: SemanticNode = {
      id: rootId,
      parentId: null,
      childIds: roots.map((r) => r.id),
      depth: 0,
      a11y: {
        role: "document",
        name: "",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
    };
    for (const r of roots) r.parentId = rootId;
    nodes.set(rootId, synthetic);
  } else {
    rootId = "";
  }

  // Recompute depths from the real root so `node.depth` is always the
  // distance from `rootId` (wrapping shifted the former roots down a level).
  if (rootId) {
    const setDepth = (id: string, depth: number) => {
      const node = nodes.get(id);
      if (!node) return;
      node.depth = depth;
      for (const childId of node.childIds) setDepth(childId, depth + 1);
    };
    setDepth(rootId, 0);
  }

  // Chromium marks the focused node with the `focused` AX property, which
  // lands in `a11y.states`. Promote it to the tree-level pointer the DOM
  // producer sets, because that is what every focus-aware consumer reads:
  // `serializeTree`'s `[focused]` marker and `serializeTreeDiff`'s focus-move
  // line both take nodes looked up by `focusedId`. Without this a native tree
  // knows where focus is and can't say so — a `focus` action reports a bare
  // `a11y.states.focused` flip instead of the focus move it actually was.
  const focused = [...nodes.values()].find(
    (n) => n.a11y.states.focused === true,
  );

  return {
    nodes,
    rootId,
    ...(focused ? { focusedId: focused.id } : {}),
    source: treeSource("native", { chrome, redactInput }),
  };
}
