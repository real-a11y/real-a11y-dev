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
 * the transport (CDP), the richer AX→a11y mapping (states/properties), the DOM
 * enrichment, and the redaction gate.
 *
 * ## Redaction (RFC finding R1 — the ship gate)
 * A native tree must never carry a user's field values. This producer enforces
 * that by construction: it **never reads any element's live `.value`**, drops
 * the AX `value` field, excludes the value-carrying AX properties
 * (`valuenow` / `valuetext`, which for a spinbutton/slider *are* the input),
 * redacts a value that would otherwise be promoted into the accessible name of
 * an unlabeled control, and the `dom` facet copies only an allowlist of
 * structural / a11y attributes (never `value`). An allowlist is strictly safer
 * than redacting after the fact.
 *
 * What a user typed into a rich-text editor is that editor's field value too —
 * Chromium reports it as the host's AX `value`, which is dropped with every
 * other. But it also names the nodes inside the editor (a paragraph's text, a
 * link's, a heading's), so the same text reaches the tree a second way. The
 * redaction closes that path at the source, before normalization can promote
 * anything: see {@link redactEditableContent}. (Caveat, documented not
 * hand-waved: `getFullAXTree` / `getDocument` responses may themselves contain
 * field values in their CDP payload — Chromium masks passwords but not, e.g.,
 * an email field. That is Chromium's wire content, outside this code's control;
 * what this code controls, it never persists. When live field values are
 * genuinely needed later, capture MUST classify sensitivity in-page.)
 */

import {
  normalizeNativeAX,
  serializeNativeAX,
  buildCssPath,
  NATIVE_AX_NAME_SOURCE_ROLES,
  type CssPathAdapter,
  type NativeAXNode,
  type RawNativeAXNode,
  type SemanticNode,
  type ExtractionResult,
  type A11yInfo,
  type DomInfo,
} from "@real-a11y-dev/core";
import type { CDPSession, Page } from "playwright";

/** The full CDP `Accessibility.AXNode` shape this producer consumes — a
 *  superset of core's structural {@link RawNativeAXNode}. */
interface RawAXNode extends RawNativeAXNode {
  /** `sources` is Chromium's accname trace — see {@link authoredByMarkup}. */
  name?: { value?: string; sources?: AXNameSource[] };
  description?: { value?: string };
  value?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
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
 * Roles whose accessible name, when not authored (no label / aria-label /
 * placeholder / title), Chromium derives from the control's **current value**
 * — which it emits as a `StaticText` descendant. Core's name-promotion would
 * otherwise copy that value into `a11y.name`, leaking a user's typed input
 * past the R1 gate. For these roles a *promoted* name is redacted (see
 * `buildNativeTree`); an authored name is always kept.
 */
const VALUE_BEARING_ROLES = new Set([
  "textbox",
  "searchbox",
  "spinbutton",
  "combobox",
  "slider",
  "scrollbar",
]);

/**
 * AX property names that map to descriptive `a11y.properties` (strings).
 *
 * R1: `valuenow` / `valuetext` are deliberately EXCLUDED. For a value-bearing
 * control (`spinbutton`, `slider`, a numeric `<input>`) those ARE the user's
 * current input — surfacing them would carry a field value into the model, the
 * exact thing the redaction gate forbids. `valuemin` / `valuemax` are authored
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

/**
 * A normalized node's name with the R1 redaction applied.
 *
 * Core's name-promotion pulls text from dropped `StaticText` descendants when
 * a node has no name of its own. For a value-bearing control with no AUTHORED
 * name, that descendant is the field's *typed value* (Chromium represents an
 * unlabeled input's value as a StaticText child), so a promoted name would
 * leak the value. Detect the promotion (own AX name empty) for those roles and
 * drop the name. An authored name (own AX name present) is never promoted, so
 * it is kept untouched.
 */
function redactedName(nn: NativeAXNode, raw: RawAXNode | undefined): string {
  const authoredName = raw ? cleanText(String(raw.name?.value ?? "")) : "";
  const hasAxValue =
    raw?.value?.value !== undefined &&
    raw?.value?.value !== null &&
    String(raw.value.value) !== "";
  const nameWasPromoted = !authoredName && nn.name !== "";
  const redactPromotedValue =
    nameWasPromoted && (VALUE_BEARING_ROLES.has(nn.role) || hasAxValue);
  return redactPromotedValue ? "" : nn.name;
}

/** One step of Chromium's accessible-name computation, as `getFullAXTree`
 *  reports it on `name.sources`, in accname order. */
interface AXNameSource {
  type?: string;
  attribute?: string;
  value?: { value?: unknown };
  superseded?: boolean;
}

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
 * heading's text. No sink prints these today; R1 holds by construction rather
 * than by that coincidence.
 */
const EDITABLE_CONTENT_ATTRIBUTES = new Set(["href", "src", "poster", "id"]);

/**
 * What a node inside an editable region is named when Chromium computed its
 * name from the editor's text. Constant, and deliberately not empty: an empty
 * name reads as UNLABELED, and a link or a cell in a message box is labeled —
 * `no-unlabeled-interactive` would report an error that isn't there. The same
 * literal the DOM producer substitutes for a withheld field value.
 */
const REDACTED_NAME = "[redacted]";

function isEditable(raw: RawAXNode): boolean {
  return (raw.properties ?? []).some((p) => p.name === "editable");
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
  const winner = raw.name?.sources?.find(
    (s) =>
      s.superseded !== true && cleanText(String(s.value?.value ?? "")) !== "",
  );
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
 * R1 for what a user typed into an editor. Returns a copy of `rawNodes` (the
 * input is never mutated) in which every node inside an editable region
 * ({@link nodesInsideEditable}) has lost the editor's text:
 *
 * - a text run (`StaticText` / `LabelText`) loses its name outright, so no
 *   later step — core's leaf promotion, or anything that reads a node's own
 *   text runs — can promote it into another node's name. That includes a
 *   container OUTSIDE the editor: a role-less contenteditable is a bare
 *   `generic` that normalization drops, which leaves its parent a leaf that
 *   would otherwise take the text.
 * - any other node keeps a name only if the page's markup supplied it
 *   ({@link authoredByMarkup}); a name Chromium computed from the content
 *   becomes {@link REDACTED_NAME}.
 * - its description is dropped: with no trace of where it came from, it could
 *   be an `aria-describedby` pointing at typed text.
 *
 * Doing this before normalization, not after, is the point: after
 * normalization a promoted name no longer says which node it came from.
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
    const computed = cleanText(String(raw.name?.value ?? ""));
    const name = NATIVE_AX_NAME_SOURCE_ROLES.has(raw.role?.value ?? "")
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
 *  treating a subtree as the user's content. */
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

/**
 * The flat, text-only view of Chromium's native tree that
 * `BrowserSession.nativeAX()` returns: indented `role "name"` lines (the same
 * shape the DOM producer's serializer prints, so the two are comparable) plus
 * the same lines as a flat list of role+name pairs, for order- and
 * indent-insensitive diffing.
 *
 * Vocabulary comes from core's shared `normalizeNativeAX`, and names pass the
 * same R1 redaction as {@link buildNativeTree} — so this view and the
 * `ExtractionResult` one can never disagree about what is on a page.
 */
export function nativeAXView(rawNodes: RawAXNode[]): {
  tree: string;
  pairs: string[];
} {
  const { nodes: redacted } = redactEditableContent(rawNodes);
  const rawById = new Map<string, RawAXNode>();
  for (const raw of redacted) rawById.set(nativeIdOf(raw), raw);
  const nodes = normalizeNativeAX(redacted).map((nn) => ({
    ...nn,
    name: redactedName(nn, rawById.get(nn.id)),
  }));
  return {
    tree: serializeNativeAX(nodes),
    pairs: nodes.map((n) => (n.name ? `${n.role} "${n.name}"` : n.role)),
  };
}

/**
 * Filter a CDP flat attribute list (`[name, value, name, value, …]`) down to
 * {@link DOM_ATTR_ALLOWLIST}. This is the R1 redaction gate: any attribute not
 * on the allowlist — most importantly `value` — is dropped, so no field value
 * ever reaches a node. Exported so the redaction is directly unit-testable.
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

/** Split an AX node's `properties` into `states` (bool/stateful) and
 *  `properties` (descriptive strings). Field values are never read here. */
function axFacets(raw: RawAXNode): Pick<A11yInfo, "states" | "properties"> {
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
 * an editor may derive a heading's `id` from its typed text (R1).
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
      out.set(node.backendNodeId, {
        tagName: node.nodeName.toLowerCase(),
        attributes: allowlistAttributes(node.attributes ?? []),
        locator: buildCssPath(node, adapter),
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

/**
 * Read Chromium's native accessibility tree for `page` and normalize it into
 * an {@link ExtractionResult} stamped `source.producer === "native"`.
 *
 * Uses its own CDP session (created and detached here), so it composes with the
 * page-bundle DOM path without interfering. Read-only: nodes carry `a11y` and
 * (when resolvable) `dom`, never `interaction` or `ui`.
 */
export async function nativeTree(page: Page): Promise<ExtractionResult> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    const { nodes: rawNodes } = (await client.send(
      "Accessibility.getFullAXTree",
    )) as { nodes: RawAXNode[] };

    const enrichment = await enrichFromDom(
      client,
      editableRootBackendIds(rawNodes),
    );
    const chrome = page.context().browser()?.version();
    return buildNativeTree(rawNodes, enrichment, chrome);
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Pure AX→`ExtractionResult` assembly, split out so it can be unit-tested on a
 * recorded `getFullAXTree` payload with no browser. `enrichment` maps a backend
 * DOM node id to its (already allowlist-filtered) tag + attributes.
 */
export function buildNativeTree(
  rawNodes: RawAXNode[],
  enrichment: Map<number, NativeDomInfo> = new Map(),
  chrome?: string,
): ExtractionResult {
  // Core owns the vocabulary: which nodes survive, sibling order, role map,
  // name promotion, id derivation. We only decorate the survivors — after the
  // editor's text is gone from the raw nodes, so nothing core promotes can
  // carry it (R1).
  const { nodes: redacted, inside } = redactEditableContent(rawNodes);
  const skeleton = normalizeNativeAX(redacted);
  const rawById = new Map<string, RawAXNode>();
  for (const raw of redacted) rawById.set(nativeIdOf(raw), raw);

  const nodes = new Map<string, SemanticNode>();
  for (const nn of skeleton) {
    const raw = rawById.get(nn.id);
    const { states, properties } = raw
      ? axFacets(raw)
      : { states: {}, properties: {} };

    const a11y: A11yInfo = {
      role: nn.role,
      name: redactedName(nn, raw),
      description: raw?.description?.value
        ? cleanText(String(raw.description.value))
        : "",
      states,
      properties,
      isExposedToAT: true,
    };

    const enriched =
      nn.backendDOMNodeId !== null
        ? enrichment.get(nn.backendDOMNodeId)
        : undefined;
    const dom: DomInfo | undefined = enriched
      ? {
          tagName: enriched.tagName,
          attributes:
            raw && inside.has(raw)
              ? withoutEditableContent(enriched.attributes)
              : enriched.attributes,
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
