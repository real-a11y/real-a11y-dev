import { TEXT_RUN_ROLE } from "../text-run.js";
import type { ExtractionResult, SemanticNode, TreeSource } from "../types.js";
import { collapseAscii } from "../utils/ascii-whitespace.js";
import { getNodeId } from "../utils/id-generator.js";

import { safeGetAttribute, safeNodeType } from "./clobber-safe.js";
import {
  extractDomTree,
  getElementRefs,
  type RedactInputOption,
} from "./dom-extractor.js";
import type { StyleCache } from "./role-map.js";
import { TEXT_RUN_HOST_ROLES, walkOwnText } from "./text-runs.js";
import { isHiddenOnlyByVisibility } from "./visibility-hidden.js";

// See SUPPRESS_KEEP_INTERACTIVE.
const SUPPRESS_KEEP_INTERACTIVE = new Set(["legend", "summary", "label"]);

// Identify which nodes to keep in the a11y tree
function keepNode(node: SemanticNode, rootId: string): boolean {
  if (!node.a11y.isExposedToAT) return false;

  // role="presentation" / role="none" / <img alt=""> — element is
  // decorative and drops out of the AT tree per ARIA spec. Children are
  // still walked and promoted to the parent via the flattening branch.
  // Carve-out: a focusable element with role="presentation" keeps its
  // implicit role per spec (presenting it as decorative would lose
  // keyboard access), so we keep interactive presentational elements.
  if (node.a11y.role === "presentation") {
    return node.interaction!.isInteractive;
  }

  // HTML-AAM's header/footer-in-sectioning-content roles. Its mapping note
  // says user agents MAY leave them unexposed when the element has no
  // accessible name, isn't focusable and carries no other global ARIA
  // attribute — so they flatten like a bare `generic`, with those extra keep
  // conditions below. The native normalizer applies the matching rule
  // (`NATIVE_AX_DROP_WHEN_BARE`) so both producers agree.
  const role = node.a11y.role;
  const sectioned = role === "sectionheader" || role === "sectionfooter";

  // Keep nodes with meaningful roles (not generic)
  if (!sectioned && role !== "generic") return true;

  // Keep named or interactive generics, and the root — and a generic holding a
  // value: a role-less editor is a field (ADR-0001), not a wrapper to fold.
  if (
    node.a11y.name ||
    node.a11y.value !== undefined ||
    node.interaction!.isInteractive ||
    node.id === rootId
  )
    return true;

  // "Another global ARIA attribute", as far as the node records it:
  // `dom.attributes` holds only KEY_ATTRIBUTES (no `aria-describedby`), but a
  // describedby reference surfaces as a computed description instead, and
  // aria-busy (not a KEY_ATTRIBUTE) lands in `a11y.states`.
  return (
    sectioned &&
    (node.interaction!.isFocusable ||
      !!node.a11y.description ||
      "busy" in node.a11y.states ||
      Object.keys(node.dom?.attributes ?? {}).some(
        (name) => name.startsWith("aria-") && name !== "aria-hidden",
      ))
  );
}

/**
 * True if `nodeId`'s subtree contains at least one interactive element
 * (self-inclusive). Used inside SUPPRESS_KEEP_INTERACTIVE handling to drop
 * decorative/text-only descendants whose content is already consumed as the
 * container's accessible name.
 */
function hasInteractiveDescendant(
  nodeId: string,
  domNodes: Map<string, SemanticNode>,
): boolean {
  const n = domNodes.get(nodeId);
  if (!n) return false;
  if (n.interaction!.isInteractive) return true;
  for (const childId of n.childIds) {
    if (hasInteractiveDescendant(childId, domNodes)) return true;
  }
  return false;
}

/** What the second pass shares across every recursive call. */
interface FilterContext {
  domNodes: Map<string, SemanticNode>;
  a11yNodes: Map<string, SemanticNode>;
  rootId: string;
  /** Fresh per projection, like an extraction's: styles change between two. */
  styleCache: StyleCache;
}

/** A row for one run of its parent's own text, which starts at `first`. */
function textRunNode(
  first: Node,
  name: string,
  parentId: string,
  depth: number,
): SemanticNode {
  return {
    // The text node's own id: the row keeps it for as long as the node lives.
    id: getNodeId(first),
    parentId,
    childIds: [],
    depth,
    dom: {
      tagName: "#text",
      attributes: {},
      textContent: name,
      descendantText: name,
      isHidden: false,
    },
    a11y: {
      role: TEXT_RUN_ROLE,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

/** Whether any of `ids`, or a node below one, is more than a `generic`: a
 *  node every view prints, which the native producer keeps too. */
function holdsPrintedNode(
  ids: string[],
  a11yNodes: Map<string, SemanticNode>,
): boolean {
  return ids.some((id) => {
    const node = a11yNodes.get(id);
    return (
      node !== undefined &&
      (node.a11y.role !== "generic" ||
        holdsPrintedNode(node.childIds, a11yNodes))
    );
  });
}

/** What a part of an element's own text reads as, or `null` for a child
 *  element, which has a node of its own. */
function runText(part: Node | " "): string | null {
  if (part === " ") return part;
  return safeNodeType(part) === Node.TEXT_NODE ? part.textContent || "" : null;
}

/** An attribute by which an author names an element, whatever its text. */
const AUTHOR_NAME_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];

/**
 * The parts of `node`'s own text ({@link walkOwnText}), if that text is what
 * names it: a prose role ({@link TEXT_RUN_HOST_ROLES}) with children, no name
 * from its author, and a name that reads exactly as those parts do. `null`
 * for anything else — see {@link splitTextRuns}.
 */
function ownTextParts(
  node: SemanticNode,
  ctx: FilterContext,
): Array<Node | " "> | null {
  const name = node.a11y.name;
  if (
    !name ||
    node.childIds.length === 0 ||
    !TEXT_RUN_HOST_ROLES.has(node.a11y.role)
  ) {
    return null;
  }
  const element = getElementRefs().get(node.id);
  // Named by its author: the text is not its name, even where the two read
  // the same.
  if (
    !element ||
    AUTHOR_NAME_ATTRIBUTES.some(
      (attribute) => safeGetAttribute(element, attribute) !== null,
    )
  ) {
    return null;
  }
  const parts: Array<Node | " "> = [];
  walkOwnText(element, ctx.styleCache, (part) => parts.push(part));
  const ownText = parts.map((part) => runText(part) ?? "").join("");
  return collapseAscii(ownText) === name ? parts : null;
}

/**
 * The children of a prose node that mixes its own text with children that have
 * a node of their own, in reading order: a `text` row for each run of its
 * text, between those children. `<p>You accept our <a>terms</a> and have read
 * our <a>privacy policy</a>.</p>` is
 *
 *     paragraph
 *       text "You accept our"
 *       link "terms"
 *       text "and have read our"
 *       link "privacy policy"
 *       text "."
 *
 * as Chromium's own tree has it (`StaticText`, `link`, `StaticText`…), where
 * the name `paragraph "You accept our and have read our ."` said neither where
 * a link sits nor a sentence anyone reads. The caller then leaves the node
 * unnamed: ARIA prohibits a name on these roles, and the text is in the rows.
 *
 * `null` leaves the node as it is, named from its text:
 * - any role outside {@link TEXT_RUN_HOST_ROLES}, and a node whose name is not
 *   that text (an `aria-label`, a `title`, a name strict mode withheld). The
 *   rows only ever divide a name the node already carries, so they can show
 *   nothing the name did not;
 * - a node with no such child: `<p>Pure <b>bold</b> text.</p>` stays
 *   `paragraph "Pure bold text."`. A `generic` named from its own text (the
 *   `<b>`) is no such child, nor is any other `generic` holding only those.
 *
 * A role-less inline wrapper (`isTextRun`) is part of the run around it and
 * gets no node here, as in Chromium; a node inside it moves up to this one.
 */
function splitTextRuns(
  node: SemanticNode,
  depth: number,
  ctx: FilterContext,
): { childIds: string[]; rows: SemanticNode[] } | null {
  const parts = ownTextParts(node, ctx);
  if (!parts) return null;

  const childIds: string[] = [];
  const rows: SemanticNode[] = [];
  let found = false;
  let run = "";
  let first: Node | null = null;
  const endRun = () => {
    const text = collapseAscii(run);
    if (text && first) {
      const row = textRunNode(first, text, node.id, depth + 1);
      rows.push(row);
      childIds.push(row.id);
    }
    run = "";
    first = null;
  };
  for (const part of parts) {
    const text = runText(part);
    if (text !== null) {
      run += text;
      if (part !== " ") first ??= part;
      continue;
    }
    const childId = getElementRefs().findId(part as Element);
    if (!childId || !ctx.domNodes.has(childId)) continue;
    const kept = processNode(childId, node.id, depth + 1, ctx);
    // A child that leaves nothing behind (a hidden span) does not end the run.
    if (kept.length === 0) continue;
    endRun();
    childIds.push(...kept);
    found ||= holdsPrintedNode(kept, ctx.a11yNodes);
  }
  endRun();
  return found ? { childIds, rows } : null;
}

/** Fill kept node `a11yNode`'s children from `node`'s, the DOM view's. */
function addChildren(
  node: SemanticNode,
  a11yNode: SemanticNode,
  ctx: FilterContext,
): void {
  const split = splitTextRuns(node, a11yNode.depth, ctx);
  if (split) {
    // Its text is in the rows now, each where it reads.
    a11yNode.a11y = { ...node.a11y, name: "" };
    a11yNode.childIds = split.childIds;
    for (const row of split.rows) ctx.a11yNodes.set(row.id, row);
    return;
  }
  // Process children, which may flatten through skipped nodes
  for (const childId of node.childIds) {
    a11yNode.childIds.push(
      ...processNode(childId, node.id, a11yNode.depth + 1, ctx),
    );
  }
}

// Second pass: build the filtered tree with correct parent/child relationships
function processNode(
  nodeId: string,
  newParentId: string | null,
  depth: number,
  ctx: FilterContext,
): string[] {
  const { domNodes, a11yNodes, rootId } = ctx;
  const node = domNodes.get(nodeId);
  if (!node) return [];
  // Drop `node` and hand its children to `newParentId`, each on its own terms.
  const promote = () =>
    node.childIds.flatMap((childId) =>
      processNode(childId, newParentId, depth, ctx),
    );

  // Hidden by its own `visibility:hidden` only: the node goes, but a child that
  // sets `visibility:visible` is rendered, so walk on. Any other hiding
  // (`aria-hidden`) takes the whole subtree with it.
  if (!node.a11y.isExposedToAT) {
    // A hidden root has no parent to promote its children to.
    const element = newParentId && getElementRefs().get(node.id);
    return element && isHiddenOnlyByVisibility(element) ? promote() : [];
  }

  // See SUPPRESS_KEEP_INTERACTIVE.
  if (SUPPRESS_KEEP_INTERACTIVE.has(node.dom!.tagName)) {
    // A name source Chromium can focus is more than a name: the <summary>
    // that toggles its <details> is a tab stop. It stays as a node of its
    // own, or the tab sequence and a [focused] marker have nothing to point
    // at. Its text-only children go either way, since that text is its name.
    const keep = node.interaction!.isFocusable;
    const keptChildIds: string[] = [];
    for (const childId of node.childIds) {
      if (!hasInteractiveDescendant(childId, domNodes)) continue;
      keptChildIds.push(
        ...processNode(
          childId,
          keep ? node.id : newParentId,
          keep ? depth + 1 : depth,
          ctx,
        ),
      );
    }
    if (!keep) return keptChildIds;
    a11yNodes.set(node.id, {
      ...node,
      parentId: newParentId,
      childIds: keptChildIds,
      depth,
      ui: { ...node.ui!, expanded: depth < 3 },
    });
    return [node.id];
  }

  if (keepNode(node, rootId)) {
    // This node stays — create an a11y version
    const a11yNode: SemanticNode = {
      ...node,
      parentId: newParentId,
      childIds: [],
      depth,
      ui: {
        ...node.ui!,
        expanded: depth < 3,
      },
    };

    addChildren(node, a11yNode, ctx);

    a11yNodes.set(node.id, a11yNode);
    return [node.id];
  } else {
    // This node is flattened — promote its children to the parent
    return promote();
  }
}

/**
 * Build an accessibility tree projection from an existing DOM tree map.
 *
 * This is the second half of {@link extractA11yTree}: it takes the DOM-level
 * `SemanticNode` map and filters/flattens it into the view a screen reader
 * would expose. It is exposed separately so {@link LiveTreeExtractor} can
 * reuse it after incrementally patching the DOM map.
 *
 * `source` is the stamp of the extraction that built `domNodes`, carried over
 * as it is. This function never decides it: a strict stamp says the names were
 * built in strict mode, which only that extraction can know, and a serializer
 * trusts it (see `redactInput` in the serializers).
 */
export function buildA11yTree(
  domNodes: Map<string, SemanticNode>,
  rootId: string,
  focusedId?: string,
  source: TreeSource = { producer: "dom" },
): ExtractionResult {
  const a11yNodes = new Map<string, SemanticNode>();
  processNode(rootId, null, 0, {
    domNodes,
    a11yNodes,
    rootId,
    styleCache: new WeakMap(),
  });

  // Inherit focus only if the focused element survived a11y filtering — a
  // focused generic/decorative node that was flattened out isn't in this view.
  const a11yFocusedId =
    focusedId && a11yNodes.has(focusedId) ? focusedId : undefined;

  return {
    nodes: a11yNodes,
    rootId,
    ...(a11yFocusedId ? { focusedId: a11yFocusedId } : {}),
    source,
  };
}

/**
 * Extract an accessibility tree by filtering the DOM tree
 * to only show nodes exposed to assistive technology.
 *
 * In the a11y view, nodes with role="generic" that have no accessible name
 * are "flattened" — their children are promoted to the parent level.
 * This produces a tree that more closely matches what a screen reader sees.
 *
 * `redactInput` is strict mode: see {@link RedactInputOption}.
 */
export function extractA11yTree(
  root: Element,
  options: RedactInputOption = {},
): ExtractionResult {
  const {
    nodes: domNodes,
    rootId,
    focusedId: domFocusedId,
    source,
  } = extractDomTree(root, options);
  return buildA11yTree(domNodes, rootId, domFocusedId, source);
}
