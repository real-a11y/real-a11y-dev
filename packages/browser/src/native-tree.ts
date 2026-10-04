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
 * include one: see {@link fieldSensitivity}.
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
  NATIVE_AX_NAME_SOURCE_ROLES,
  RANGE_VALUE_ROLES,
  REDACTED_VALUE,
  STATE_ONLY_ROLES,
  ancestry,
  carriesAXValue,
  holdsContent,
  indexRaw,
  nonEmptyAXText,
  propertyOf,
  valueRegions,
  winningNameSource,
  withholdRegionNames,
  type CssPathAdapter,
  type RawAXNameNode,
  type RawIndex,
  type ValueRegions,
  type SemanticNode,
  type ExtractionResult,
  type A11yInfo,
  type DomInfo,
} from "@real-a11y-dev/core";
import type { CDPSession, Page } from "playwright";

/** The full CDP `Accessibility.AXNode` shape this producer consumes. */
type RawAXNode = RawAXNameNode;

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
 * `focused`, `editable`, `settable`, `readonly`, `multiline`, `modal`, `busy`)
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

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ── Field values (ADR-0001) ─────────────────────────────────────────────────

/**
 * Chromium's password mask: a value made only of these is a password field
 * whose markup this producer could not read. Treated as sensitive, so the
 * length the bullets encode never reaches the tree.
 */
const MASKED_VALUE = /^[•●]+$/;

function isMasked(value: unknown): boolean {
  return (
    typeof value === "string" && MASKED_VALUE.test(value.replace(/\s/g, ""))
  );
}

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
      nonEmptyAXText(propertyOf(raw, "valuetext")?.value) ??
      nonEmptyAXText(raw.value?.value) ??
      nonEmptyAXText(propertyOf(raw, "valuenow")?.value)
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
  return finishAnnouncedValue(text, () => sensitive || isMasked(text));
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
 */
function fieldSensitivity(
  rawNodes: RawAXNode[],
  index: RawIndex,
  enrichment: ReadonlyMap<number, NativeDomInfo>,
): FieldSensitivity {
  const fields = new Set<string>();
  for (const raw of rawNodes) {
    const enriched =
      typeof raw.backendDOMNodeId === "number"
        ? enrichment.get(raw.backendDOMNodeId)
        : undefined;
    const unclassified =
      typeof raw.backendDOMNodeId === "number" &&
      enriched === undefined &&
      carriesAXValue(raw);
    if (
      unclassified ||
      isMasked(raw.value?.value) ||
      (enriched !== undefined &&
        isSensitiveFieldAttributes(enriched.tagName, {
          type: enriched.attributes.type,
          autocomplete: enriched.attributes.autocomplete,
        }))
    ) {
      fields.add(raw.nodeId);
    }
  }
  // Only a field that holds something withholds names around it: an empty
  // one has nothing to give away (see holdsContent). Its own value is empty.
  for (const id of fields) {
    const field = index.byId.get(id);
    if (!field || !holdsContent(field, index.byId, false)) fields.delete(id);
  }
  const regions = valueRegions(index, fields);
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
 * The attributes allowed to name a node INSIDE an editable region. They are
 * the page's markup — an `aria-label` on a mention chip, an inserted image's
 * `alt`, a `title` — rather than the editor's text, and Chromium leaves them
 * out of the host's `value` too. Every other name source there (the node's
 * contents, a `<figcaption>` / `<caption>` / `<legend>`, an `aria-labelledby`
 * target) is, or can point at, what the user typed. An allowlist, so a source
 * Chromium adds later is withheld until someone decides otherwise.
 */
const MARKUP_NAME_ATTRIBUTES = new Set(["aria-label", "alt", "title"]);

/**
 * The `dom` attributes dropped inside an editable region: a URL the user typed
 * or pasted into a link or an image (an auto-linked `?token=` is the likeliest
 * secret in a message box), and an `id`, which some editors derive from a
 * heading's text. No sink prints these today; the strict mode holds by
 * construction rather than by that coincidence.
 */
const EDITABLE_CONTENT_ATTRIBUTES = new Set(["href", "src", "poster", "id"]);

/**
 * What a node inside an editable region is named when Chromium computed its
 * name from the editor's text. Constant, and deliberately not empty: an empty
 * name reads as UNLABELED, and a link or a cell in a message box is labeled —
 * `no-unlabeled-interactive` would report an error that isn't there. The same
 * literal the sensitivity policy substitutes for a withheld field value.
 */
const REDACTED_NAME = REDACTED_VALUE;

function isEditable(raw: RawAXNode): boolean {
  return (raw.properties ?? []).some((p) => p.name === "editable");
}

/** Roles whose value is the page's own state, never something a user entered. */
const PAGE_STATE_VALUE_ROLES: ReadonlySet<string> = new Set([
  "progressbar",
  "meter",
  "scrollbar",
]);

/**
 * Strict mode's value roots: every field whose value it withholds. That is
 * every node Chromium reports a value for — a text field, a `<select>`, a
 * slider, a file input, an editor — plus the root of every rich-text editing
 * region that holds text, since what is typed there reaches names as well as
 * the host's value.
 *
 * An EMPTY field or editor is not a root (see {@link holdsContent}): it
 * contributes nothing to a name built around it, and counting it would
 * withhold every row and cell name in a table of empty inputs.
 */
function strictValueRoots(rawNodes: RawAXNode[], index: RawIndex): Set<string> {
  // What a user entered, not what the page reports: a progress bar, a meter
  // and a scrollbar hold the page's own state, and a media element's timeline
  // and volume are playback, not input. Counting them would withhold a
  // `<video>`'s name for containing its scrubber.
  const inMedia = (raw: RawAXNode): boolean => {
    for (const cur of ancestry(raw, index.byId)) {
      const role = cur.role?.value;
      if (role === "Video" || role === "Audio") return true;
    }
    return false;
  };
  const roots = new Set<string>();
  for (const raw of rawNodes) {
    if (
      carriesAXValue(raw) &&
      !PAGE_STATE_VALUE_ROLES.has(raw.role?.value ?? "") &&
      !inMedia(raw)
    ) {
      roots.add(raw.nodeId);
    }
    if (!isEditable(raw)) continue;
    let root = raw;
    for (const cur of ancestry(raw, index.byId)) {
      if (!isEditable(cur)) break;
      root = cur;
    }
    // An editing root counts only once something was typed into it: an empty
    // editor, like an empty text field, has nothing a name could borrow.
    if (holdsContent(root, index.byId, true)) roots.add(root.nodeId);
  }
  return roots;
}

/**
 * True when `raw`'s name is exactly the text of one of the
 * {@link MARKUP_NAME_ATTRIBUTES}. The winning source is the first one in the
 * trace that produced text and wasn't superseded; requiring its text to equal
 * the computed name means a trace that disagrees with its own result — or is
 * missing, as in a payload recorded without it — fails closed.
 */
function authoredByMarkup(raw: RawAXNode): boolean {
  const name = cleanText(String(raw.name?.value ?? ""));
  const winner = winningNameSource(raw);
  return (
    winner?.type === "attribute" &&
    MARKUP_NAME_ATTRIBUTES.has(winner.attribute ?? "") &&
    cleanText(String(winner.value?.value)) === name
  );
}

/**
 * The raw nodes strictly INSIDE an editable region — below a node Chromium
 * marks `editable` (a contenteditable host, a `designMode` document, a native
 * text field). The region's own root is not inside it: that is the field
 * itself, whose authored label is kept and whose value is already withheld.
 *
 * Decided by ancestry rather than by each node's own `editable` flag, because
 * a `contenteditable="false"` island (a mention chip, an embedded link) carries
 * no flag of its own but is still part of what the user wrote.
 */
function nodesInsideEditable(rawNodes: RawAXNode[]): Set<RawAXNode> {
  const byId = new Map(rawNodes.map((n) => [n.nodeId, n]));
  // nodeId → "this node, or one of its ancestors, is editable".
  const covered = new Map<string, boolean>();
  const isCovered = (start: RawAXNode | undefined): boolean => {
    const chain: string[] = [];
    let result = false;
    for (
      let cur = start;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    ) {
      const known = covered.get(cur.nodeId);
      if (known !== undefined) {
        result = known;
        break;
      }
      chain.push(cur.nodeId);
      if (isEditable(cur)) {
        result = true;
        break;
      }
      // A parent cycle is malformed input with no root to reach; treat what
      // it holds as inside rather than prove a negative about it.
      if (chain.length > rawNodes.length) {
        result = true;
        break;
      }
    }
    for (const id of chain) covered.set(id, result);
    return result;
  };

  const inside = new Set<RawAXNode>();
  for (const raw of rawNodes) {
    if (raw.parentId && isCovered(byId.get(raw.parentId))) inside.add(raw);
  }
  return inside;
}

/**
 * Strict mode (`redactInput`) for what a user typed into an editor. Returns a
 * copy of `rawNodes` (the input is never mutated) in which every node inside
 * an editable region ({@link nodesInsideEditable}) has lost the editor's text:
 *
 * - a text run (`StaticText` / `LabelText`) loses its name outright, so no
 *   later step — core's leaf promotion, or anything that reads a node's own
 *   text runs — can promote it into another node's name.
 * - any other node keeps a name only if the page's markup supplied it
 *   ({@link authoredByMarkup}); a name Chromium computed from the content
 *   becomes {@link REDACTED_NAME}.
 * - its description is dropped: with no trace of where it came from, it could
 *   be an `aria-describedby` pointing at typed text.
 *
 * Names OUTSIDE a region that carry what is in it — a node around an editor or
 * a filled field, named from its contents or by reference — are
 * {@link withholdRegionNames}' job, over {@link strictValueRoots}.
 *
 * Doing this before normalization, not after, is the point: after
 * normalization a promoted name no longer says which node it came from. The
 * AX `value` itself is left on each raw node, because core reads it to keep a
 * value out of names ({@link normalizeNativeAX}); strict mode withholds it by
 * never copying it to `a11y.value`.
 */
function redactEditableContent(rawNodes: RawAXNode[]): {
  nodes: RawAXNode[];
  inside: Set<RawAXNode>;
} {
  const inside = nodesInsideEditable(rawNodes);
  if (inside.size === 0) return { nodes: rawNodes, inside };
  const redactedInside = new Set<RawAXNode>();
  const nodes = rawNodes.map((raw) => {
    if (!inside.has(raw)) return raw;
    const textRun = NATIVE_AX_NAME_SOURCE_ROLES.has(raw.role?.value ?? "");
    const computed = cleanText(String(raw.name?.value ?? ""));
    const name = textRun
      ? ""
      : computed === "" || authoredByMarkup(raw)
        ? computed
        : REDACTED_NAME;
    const { description: _dropped, ...rest } = raw;
    const redacted: RawAXNode = { ...rest, name: { value: name } };
    redactedInside.add(redacted);
    return redacted;
  });
  return { nodes, inside: redactedInside };
}

/** The editable roots' backend DOM ids — where {@link enrichFromDom} starts
 *  treating a subtree as the user's content (strict mode only). */
function editableRootBackendIds(rawNodes: RawAXNode[]): Set<number> {
  const inside = nodesInsideEditable(rawNodes);
  const roots = new Set<number>();
  for (const raw of rawNodes) {
    if (
      isEditable(raw) &&
      !inside.has(raw) &&
      typeof raw.backendDOMNodeId === "number"
    ) {
      roots.add(raw.backendDOMNodeId);
    }
  }
  return roots;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Every name-level redaction, applied to the raw nodes before core normalizes
 * them — the only point at which a name still says which node it came from.
 * Sensitive fields always ({@link withholdRegionNames} over
 * {@link fieldSensitivity}); in strict mode, every field value and all editor
 * content too ({@link withholdRegionNames} over {@link strictValueRoots}, then
 * {@link redactEditableContent}).
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
  const index = indexRaw(rawNodes);
  const sensitivity = fieldSensitivity(rawNodes, index, enrichment);
  const named = withholdRegionNames(rawNodes, sensitivity.regions);
  if (options.redactInput !== true) {
    return { nodes: named, sensitivity, insideEditor: new Set() };
  }
  const strict = withholdRegionNames(
    named,
    valueRegions(index, strictValueRoots(rawNodes, index)),
  );
  const { nodes, inside } = redactEditableContent(strict);
  return { nodes, sensitivity, insideEditor: inside };
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
  const { root } = (await client.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as { root: DomNode };

  // Parent links aren't in the payload — record them on the way down so the
  // locator walk can go back up.
  const parents = new Map<DomNode, DomNode>();
  // Everything strictly below an editable root — the user's content.
  const insideEditable = new Set<DomNode>();
  const ELEMENT_NODE = 1;
  const elementChildren = (node: DomNode): DomNode[] =>
    (node.children ?? []).filter((c) => c.nodeType === ELEMENT_NODE);

  const adapter: CssPathAdapter<DomNode> = {
    tagName: (n) => (n.nodeName ?? "").toLowerCase(),
    id: (n) => (insideEditable.has(n) ? null : attributeOf(n, "id")),
    parent: (n) => parents.get(n) ?? null,
    children: (n) => elementChildren(n),
    // Two kinds of stop. `<html>` is the document element — the path stops
    // before including it, matching the DOM producer. Anything that isn't an
    // element (`#document`, and a `#document-fragment` shadow root) is a
    // boundary a CSS path cannot cross: this walk pierces shadow roots and the
    // in-page one does not, so native alone reaches nodes with no whole-document
    // selector. Those stop too, yielding a partial path anchored inside the
    // shadow root rather than a `#document-fragment > …` selector that would
    // look queryable and match nothing.
    isRoot: (n) =>
      n.nodeType !== ELEMENT_NODE ||
      (n.nodeName ?? "").toLowerCase() === "html",
  };

  const walk = (node: DomNode, inside: boolean): void => {
    if (inside) insideEditable.add(node);
    for (const child of elementChildren(node)) parents.set(child, node);
    if (typeof node.backendNodeId === "number" && node.nodeName) {
      const ariaValueText = attributeOf(node, "aria-valuetext");
      out.set(node.backendNodeId, {
        tagName: node.nodeName.toLowerCase(),
        attributes: allowlistAttributes(node.attributes ?? []),
        locator: buildCssPath(node, adapter),
        ...(ariaValueText !== null ? { ariaValueText } : {}),
      });
    }
    const below =
      inside ||
      (typeof node.backendNodeId === "number" &&
        editableRoots.has(node.backendNodeId));
    for (const child of node.children ?? []) walk(child, below);
    if (node.contentDocument) walk(node.contentDocument, below);
    for (const sub of node.shadowRoots ?? []) walk(sub, below);
  };
  walk(root, false);
  return out;
}

/** Read one attribute out of CDP's flat `[name, value, name, value, …]`. */
function attributeOf(node: DomNode, want: string): string | null {
  const attrs = node.attributes ?? [];
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if (attrs[i] === want) return attrs[i + 1];
  }
  return null;
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
}

interface DomNode {
  backendNodeId?: number;
  nodeName?: string;
  nodeType?: number;
  attributes?: string[];
  children?: DomNode[];
  contentDocument?: DomNode;
  shadowRoots?: DomNode[];
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
    for (const cur of ancestry(raw, rawByNodeId)) {
      const role = cur.role?.value;
      if (cur !== raw && (role === "combobox" || role === "listbox")) {
        return true;
      }
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
        ? cleanText(String(raw.description.value))
        : "",
      ...(value !== undefined ? { value } : {}),
      states,
      properties,
      isExposedToAT: true,
    };

    const dom: DomInfo | undefined = enriched
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
    source: { producer: "native", ...(chrome ? { chrome } : {}) },
  };
}
