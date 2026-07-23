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
 * that by construction: it **never reads any element's live `.value`**, it
 * drops the AX `value` field entirely, and the `dom` facet copies only an
 * allowlist of structural / a11y attributes (never `value`). An allowlist is
 * strictly safer than redacting after the fact. (Caveat, documented not
 * hand-waved: `getFullAXTree` / `getDocument` responses may themselves contain
 * field values in their CDP payload — Chromium masks passwords but not, e.g.,
 * an email field. That is Chromium's wire content, outside this code's control;
 * what this code controls, it never persists. When live field values are
 * genuinely needed later, capture MUST classify sensitivity in-page.)
 */

import {
  normalizeNativeAX,
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

/** AX property names that map to descriptive `a11y.properties` (strings). */
const DETAIL_PROPS = new Set([
  "level",
  "valuemin",
  "valuemax",
  "valuenow",
  "valuetext",
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
 * attributes) → a `backendDOMNodeId → { tagName, attributes }` map. Attributes
 * are filtered to {@link DOM_ATTR_ALLOWLIST} as they are read, so no field
 * value is ever placed on a node (R1). This is the batched enrichment of RFC
 * finding R3 — no per-node `resolveNode` / `callFunctionOn`.
 */
async function enrichFromDom(
  client: CDPSession,
): Promise<
  Map<number, { tagName: string; attributes: Record<string, string> }>
> {
  const out = new Map<
    number,
    { tagName: string; attributes: Record<string, string> }
  >();
  const { root } = (await client.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as { root: DomNode };

  const walk = (node: DomNode): void => {
    if (typeof node.backendNodeId === "number" && node.nodeName) {
      out.set(node.backendNodeId, {
        tagName: node.nodeName.toLowerCase(),
        attributes: allowlistAttributes(node.attributes ?? []),
      });
    }
    for (const child of node.children ?? []) walk(child);
    if (node.contentDocument) walk(node.contentDocument);
    for (const sub of node.shadowRoots ?? []) walk(sub);
  };
  walk(root);
  return out;
}

interface DomNode {
  backendNodeId?: number;
  nodeName?: string;
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

    const enrichment = await enrichFromDom(client);
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
  enrichment: Map<
    number,
    { tagName: string; attributes: Record<string, string> }
  > = new Map(),
  chrome?: string,
): ExtractionResult {
  // Core owns the vocabulary: which nodes survive, sibling order, role map,
  // name promotion, id derivation. We only decorate the survivors.
  const skeleton = normalizeNativeAX(rawNodes);
  const rawById = new Map<string, RawAXNode>();
  for (const raw of rawNodes) rawById.set(nativeIdOf(raw), raw);

  const nodes = new Map<string, SemanticNode>();
  for (const nn of skeleton) {
    const raw = rawById.get(nn.id);
    const { states, properties } = raw
      ? axFacets(raw)
      : { states: {}, properties: {} };

    // R1 (redaction): core's name-promotion pulls text from dropped
    // `StaticText` descendants when a node has no name of its own. For a
    // value-bearing control with no AUTHORED name, that descendant is the
    // field's *typed value* (Chromium represents an unlabeled input's value as
    // a StaticText child), so a promoted name would leak the value into
    // `a11y.name`. Detect the promotion (own AX name empty) for those roles and
    // drop the name. An authored name (own AX name present) is never promoted,
    // so it is kept untouched.
    const authoredName = raw ? cleanText(String(raw.name?.value ?? "")) : "";
    const hasAxValue =
      raw?.value?.value !== undefined &&
      raw?.value?.value !== null &&
      String(raw.value.value) !== "";
    const nameWasPromoted = !authoredName && nn.name !== "";
    const redactPromotedValue =
      nameWasPromoted && (VALUE_BEARING_ROLES.has(nn.role) || hasAxValue);
    const name = redactPromotedValue ? "" : nn.name;

    const a11y: A11yInfo = {
      role: nn.role,
      name,
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
          attributes: enriched.attributes,
          textContent: null,
          descendantText: "",
          isHidden: false,
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

  // Single-frame: one root. A cross-frame `getFullAXTree` payload yields
  // multiple top-level subtrees (core's `normalizeNativeAX` drops every
  // `RootWebArea` and treats each parent-less node as a root), and only the
  // subtree under `rootId` serializes. Multi-frame native trees are out of
  // scope for Phase 1 — iframes are on the parity-corpus backlog (RFC PR E),
  // where frame nesting needs frame metadata a transport-aware producer must
  // add (`frameId` → `DOM.getFrameOwner`).
  const rootId =
    skeleton.find((n) => nodes.get(n.id)?.parentId === null)?.id ??
    skeleton[0]?.id ??
    "";

  return {
    nodes,
    rootId,
    source: { producer: "native", ...(chrome ? { chrome } : {}) },
  };
}
