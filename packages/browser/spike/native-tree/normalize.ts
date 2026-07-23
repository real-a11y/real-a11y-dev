/**
 * SPIKE — not a public API.
 *
 * Normalize Chromium CDP `Accessibility.getFullAXTree` nodes into today's
 * `ExtractionResult` / `SemanticNode` shape so we can feed `serializeTree`
 * and prove (or kill) the "one model, two producers" path from the RFCs.
 *
 * Intentional shortcuts (called out in docs/rfcs/native-tree-spike.md):
 * - Fills required `dom` / `interaction` / `ui` with placeholders when CDP
 *   has no DOM facet — evidence for the AccNode (optional facets) break.
 * - Aggressive noise drop (InlineTextBox, StaticText, ignored, none, …).
 * - Role map is minimal (Video→video, Audio→audio, image→img).
 */

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

/** Subset of CDP `Accessibility.AXNode` we actually consume. */
export interface SpikeAXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  value?: { type?: string; value?: unknown };
  properties?: Array<{
    name: string;
    value?: { type?: string; value?: unknown; relatedNodes?: unknown };
  }>;
}

export interface DomEnrichment {
  tagName: string | null;
  id: string | null;
  type: string | null;
  /** Raw DOM `.value` — SENSITIVE; spike redacts before putting on the node. */
  value: string | null;
  autocomplete: string | null;
}

export interface NormalizeOptions {
  /** backendDOMNodeId → enrichment from DOM.resolveNode. */
  enrichmentByBackendId?: Map<number, DomEnrichment>;
  /** Chromium product version string for provenance notes. */
  chromeVersion?: string;
}

const DROP_ROLES = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "ListMarker",
  "listmarker",
  "generic",
  "none",
  "presentation",
  "RootWebArea",
  "Ignored",
]);

const ROLE_MAP: Record<string, string> = {
  Video: "video",
  Audio: "audio",
  image: "img",
};

const SENSITIVE_TYPES = new Set(["password"]);
const SENSITIVE_AUTOCOMPLETE =
  /^(current-password|new-password|cc-number|cc-csc|cc-exp)$/i;

function isSensitive(enrichment: DomEnrichment | undefined): boolean {
  if (!enrichment) return false;
  if (enrichment.type && SENSITIVE_TYPES.has(enrichment.type)) return true;
  if (
    enrichment.autocomplete &&
    SENSITIVE_AUTOCOMPLETE.test(enrichment.autocomplete)
  )
    return true;
  return false;
}

function axProps(node: SpikeAXNode): {
  states: Record<string, string | boolean>;
  properties: Record<string, string>;
} {
  const states: Record<string, string | boolean> = {};
  const properties: Record<string, string> = {};
  for (const p of node.properties ?? []) {
    const raw = p.value?.value;
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "object") continue; // nodeList etc. — skip in spike
    const key = p.name;
    if (
      key === "focusable" ||
      key === "editable" ||
      key === "settable" ||
      key === "disabled" ||
      key === "readonly" ||
      key === "required" ||
      key === "multiline" ||
      key === "invalid"
    ) {
      states[key] = raw as string | boolean;
    } else {
      properties[key] = String(raw);
    }
  }
  return { states, properties };
}

function emptyDom(tagName = ""): SemanticNode["dom"] {
  return {
    tagName,
    attributes: {},
    textContent: null,
    descendantText: "",
    isHidden: false,
  };
}

function emptyInteraction(
  focusable: boolean,
  editable: boolean,
): SemanticNode["interaction"] {
  return {
    isInteractive: focusable || editable,
    actions: [],
    isFocusable: focusable,
    isEditable: editable,
  };
}

function emptyUi(): SemanticNode["ui"] {
  return {
    expanded: true,
    highlighted: false,
    matchesFilter: true,
    selected: false,
  };
}

/**
 * Build an ExtractionResult from a flat CDP AX node list.
 * Drops ignored / noise roles and re-parents surviving children.
 */
export function normalizeNativeTree(
  axNodes: SpikeAXNode[],
  options: NormalizeOptions = {},
): ExtractionResult {
  const byId = new Map(axNodes.map((n) => [n.nodeId, n]));
  const enrichment = options.enrichmentByBackendId ?? new Map();

  // Decide which AX nodes survive into the AccNode tree.
  const keep = new Set<string>();
  for (const n of axNodes) {
    const role = n.role?.value ?? "";
    if (n.ignored) continue;
    if (!role || DROP_ROLES.has(role)) continue;
    keep.add(n.nodeId);
  }

  const nodes = new Map<string, SemanticNode>();

  // Sibling order must follow each parent's childIds (document order) — the
  // flat getFullAXTree payload interleaves subtrees, so grouping survivors by
  // flat-list position scrambles siblings. Same childIds-driven walk as
  // core's normalizeNativeAX (#205), which this spike predates and graduates
  // into (execution plan PR D).
  const childrenOf = new Map<string | null, string[]>();
  const collectChildren = (axId: string, keptAncestor: string | null) => {
    const ax = byId.get(axId);
    if (!ax) return;
    if (keep.has(axId)) {
      const list = childrenOf.get(keptAncestor) ?? [];
      list.push(axId);
      childrenOf.set(keptAncestor, list);
      for (const c of ax.childIds ?? []) collectChildren(c, axId);
    } else {
      for (const c of ax.childIds ?? []) collectChildren(c, keptAncestor);
    }
  };
  for (const root of axNodes.filter((n) => !n.parentId)) {
    collectChildren(root.nodeId, null);
  }

  for (const id of keep) {
    const ax = byId.get(id)!;

    const rawRole = ax.role?.value ?? "generic";
    const role = ROLE_MAP[rawRole] ?? rawRole;
    const { states, properties } = axProps(ax);
    const enrich =
      typeof ax.backendDOMNodeId === "number"
        ? enrichment.get(ax.backendDOMNodeId)
        : undefined;
    const sensitive = isSensitive(enrich);

    const dom = emptyDom(enrich?.tagName ?? "");
    if (enrich?.id) dom.attributes.id = enrich.id;
    if (enrich?.type) dom.attributes.type = enrich.type;
    if (enrich?.autocomplete) dom.attributes.autocomplete = enrich.autocomplete;
    // Never put raw sensitive values on the node. Email-like values are still
    // present on the AX `value` field — spike records them under states only
    // when not sensitive, so serializeTree (name/role only) stays clean, but
    // callers inspecting the model can see the leak surface.
    if (ax.value?.value !== undefined && ax.value.value !== null) {
      const v = String(ax.value.value);
      states.value = sensitive ? "[redacted]" : v;
    }

    const focusable = states.focusable === true;
    const editable =
      states.editable === true ||
      states.editable === "plaintext" ||
      states.settable === true;

    // Chromium often puts the accessible name on a StaticText child while the
    // parent listitem/button name is empty. Dropping StaticText without
    // promoting the name loses "Alpha"/"Beta" etc. — a real-app corpus gap.
    let name = (ax.name?.value ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      for (const cid of ax.childIds ?? []) {
        const child = byId.get(cid);
        const childRole = child?.role?.value ?? "";
        if (
          child &&
          !child.ignored &&
          (childRole === "StaticText" || childRole === "LabelText")
        ) {
          const childName = (child.name?.value ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (childName) {
            name = childName;
            break;
          }
        }
      }
    }

    const node: SemanticNode = {
      // Prefer a stable-looking id when we have a backend DOM id; else ax-*.
      id:
        typeof ax.backendDOMNodeId === "number"
          ? `ax-dom-${ax.backendDOMNodeId}`
          : `ax-${ax.nodeId}`,
      parentId: null, // filled in second pass
      childIds: [],
      depth: 0,
      dom,
      a11y: {
        role,
        name,
        description: (ax.description?.value ?? "").trim(),
        states,
        properties,
        isExposedToAT: true,
      },
      interaction: emptyInteraction(focusable, editable),
      ui: emptyUi(),
    };

    // Stash provenance on a non-serialized attribute bag for the spike report.
    (node as SemanticNode & { __spike?: unknown }).__spike = {
      producer: "native",
      axNodeId: ax.nodeId,
      backendDOMNodeId: ax.backendDOMNodeId ?? null,
      chromeRole: rawRole,
      chromeVersion: options.chromeVersion ?? null,
      hadDomEnrichment: Boolean(enrich),
      sensitive,
    };

    nodes.set(id, node);
  }

  // Second pass: rewrite ids to the SemanticNode.id space and wire parents/children/depth.
  const idMap = new Map<string, string>(); // ax nodeId → SemanticNode.id
  for (const [axId, node] of nodes) idMap.set(axId, node.id);

  const out = new Map<string, SemanticNode>();
  const roots: string[] = [];

  const visit = (axId: string, parentSemId: string | null, depth: number) => {
    const node = nodes.get(axId);
    if (!node) return;
    const semId = node.id;
    const childAxIds = childrenOf.get(axId) ?? [];
    const childSemIds = childAxIds
      .map((c) => idMap.get(c))
      .filter((x): x is string => Boolean(x));

    const next: SemanticNode = {
      ...node,
      parentId: parentSemId,
      childIds: childSemIds,
      depth,
    };
    out.set(semId, next);
    if (!parentSemId) roots.push(semId);
    for (const childAx of childAxIds) visit(childAx, semId, depth + 1);
  };

  for (const rootAx of childrenOf.get(null) ?? []) visit(rootAx, null, 0);

  // Fallback: if filtering removed everything above a kept node, pick first kept.
  let rootId = roots[0];
  if (!rootId) {
    const first = out.values().next().value as SemanticNode | undefined;
    if (!first) {
      return { nodes: out, rootId: "" };
    }
    rootId = first.id;
  }

  // If multiple roots, synthesize a generic wrapper so serializeTree has one root.
  if (roots.length > 1) {
    const wrapId = "ax-root";
    const wrap: SemanticNode = {
      id: wrapId,
      parentId: null,
      childIds: roots,
      depth: 0,
      dom: emptyDom("BODY"),
      a11y: {
        role: "generic",
        name: "",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: false,
      },
      interaction: emptyInteraction(false, false),
      ui: emptyUi(),
    };
    for (const r of roots) {
      const n = out.get(r)!;
      out.set(r, { ...n, parentId: wrapId, depth: n.depth + 1 });
      // bump depths of descendants roughly — serialize uses printed-ancestor count
      // so exact depth is less critical; leave as-is for spike.
    }
    out.set(wrapId, wrap);
    rootId = wrapId;
  }

  return { nodes: out, rootId };
}
