/**
 * Pure normalization of a flat CDP `Accessibility.getFullAXTree` node list
 * into an ordered, depth-annotated tree in this engine's vocabulary.
 *
 * See `ax-vocabulary.ts` for why this lives in core (one copy, pure,
 * importable from Node / workers / browsers) and what is deliberately NOT
 * here (transport, DOM enrichment, the attribute allowlist —
 * `@real-a11y-dev/browser`). One redaction rule IS here, because it is a
 * naming rule: a node's value never becomes its name (see
 * {@link carriesValue}). Every native transport inherits it, so none can
 * forget it.
 *
 * Ordering note (a real drift bug this consolidation fixed): the flat list
 * CDP returns is NOT in document order — a parent's children are ordered by
 * its `childIds` array, while unrelated subtrees interleave in the flat
 * list. Early spike normalizers grouped siblings by flat-list position and
 * silently shuffled them. This walker follows `childIds` from the roots, so
 * sibling order is Chromium's own.
 */

import {
  mapNativeAXRole,
  NATIVE_AX_AUTHOR_NAMED_ROLES,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_DROP_UNLESS_NAMED,
  NATIVE_AX_DROP_WHEN_BARE,
  NATIVE_AX_EXPOSING_PROPERTIES,
  NATIVE_AX_NAME_FROM_CONTENT_ROLES,
  NATIVE_AX_NAME_SOURCE_ROLES,
  NATIVE_AX_OWN_TEXT_ROLES,
  NATIVE_AX_TEXT_OWNING_ROLES,
} from "./ax-vocabulary.js";

/** The subset of CDP `Accessibility.AXNode` this normalizer consumes. */
export interface RawNativeAXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  /** Read only for its property NAMES and the `focusable` flag — see
   *  `NATIVE_AX_DROP_WHEN_BARE`. Values are never inspected otherwise. */
  properties?: Array<{
    name: string;
    value?: { type?: string; value?: unknown };
  }>;
  /** Read only for whether there is one — see {@link carriesValue}. Never
   *  copied onto a normalized node. */
  value?: { value?: unknown };
}

/** One kept node of the normalized native tree, in document order. */
export interface NativeAXNode {
  /**
   * `ax-dom-<backendDOMNodeId>` when Chromium exposes a backing DOM node,
   * else `ax-<nodeId>`. Session-scoped — backend ids do not survive
   * navigation. A producer that resolves the DOM node should replace this
   * with the engine's shared id-generator id (RFC v3 §5.1 / R2).
   */
  id: string;
  role: string;
  name: string;
  /** Number of kept ancestors — indentation depth in serialized output. */
  depth: number;
  /** CDP backing-DOM reference for enrichment/dispatch; null for pure AX nodes. */
  backendDOMNodeId: number | null;
  /** Ids (in this normalized id space) of kept children, in Chromium's order. */
  childIds: string[];
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isEditable(node: RawNativeAXNode | undefined): boolean {
  return (node?.properties ?? []).some((p) => p.name === "editable");
}

/**
 * The root of a rich-text editing region: Chromium marks it
 * `editable: "richtext"` and its parent is not editable. A role-less
 * `<div contenteditable>` is such a root; the spans and paragraphs inside it
 * are editable too, but not roots. A native text field's inner editor is
 * `"plaintext"` — UA-shadow plumbing, not a field of its own — and a
 * `plaintext-only` editor is kept by its value instead (see `isKept`).
 */
function isEditingRoot(
  node: RawNativeAXNode,
  byId: ReadonlyMap<string, RawNativeAXNode>,
): boolean {
  const editable = node.properties?.find((p) => p.name === "editable");
  if (editable?.value?.value !== "richtext") return false;
  return !isEditable(node.parentId ? byId.get(node.parentId) : undefined);
}

function isKept(
  node: RawNativeAXNode,
  byId: ReadonlyMap<string, RawNativeAXNode>,
): boolean {
  const role = node.role?.value ?? "";
  if (node.ignored || role === "" || NATIVE_AX_DROP_ROLES.has(role)) {
    return false;
  }
  // A `generic` (and any drop-unless-named role) is noise when bare but a
  // meaningful labelled container when named — keep it only if it has a name.
  // Or if it is a field: a role-less `<div contenteditable>` is a `generic`
  // holding what was typed, and a text that sits directly in it is nowhere
  // else in the tree. It is a field, not a wrapper (ADR-0001), as the DOM
  // producer keeps it. Kept for being an EDITING ROOT, not for holding a value
  // right now — a node that came and went with its contents would print as
  // `+ generic` / `- generic` in a diff whenever someone typed into an empty
  // editor or cleared one. (A generic that carries a value without being
  // editable is kept too, the one other shape a field takes.) Its text still
  // never names it — see {@link carriesValue}.
  if (NATIVE_AX_DROP_UNLESS_NAMED.has(role)) {
    return (
      (node.name?.value ?? "").trim() !== "" ||
      isEditingRoot(node, byId) ||
      carriesValue(node)
    );
  }
  if (NATIVE_AX_DROP_WHEN_BARE.has(role)) {
    if ((node.name?.value ?? "").trim() !== "") return true;
    return (node.properties ?? []).some(
      (p) =>
        (p.name === "focusable" && p.value?.value === true) ||
        NATIVE_AX_EXPOSING_PROPERTIES.has(p.name),
    );
  }
  return true;
}

function idOf(node: RawNativeAXNode): string {
  return typeof node.backendDOMNodeId === "number"
    ? `ax-dom-${node.backendDOMNodeId}`
    : `ax-${node.nodeId}`;
}

/**
 * Whether Chromium reports a value for `node` — in which case the text inside
 * it is that value, not its name, and name promotion leaves it alone. (It is
 * also what keeps a role-less editor in the tree — see `isKept`.)
 *
 * An editable region's text is its value, and Chromium 151 reports it twice: as
 * the AX `value` and on a `StaticText` child. That covers `<div
 * role="application" contenteditable>`, `role="document"` and `role="log"`
 * editors, and a contenteditable `<p>`. Promoting the child would print what a
 * user typed as the node's name, which the R1 gate exists to prevent. Chromium
 * leaves all of them unnamed.
 *
 * The same holds one level removed: a value carrier that normalization drops
 * must not name the kept ancestor it flattens into either. (A role-less
 * `<div contenteditable>` was the case that motivated it; it is kept as a
 * `generic` now, so its text is its own value, never an ancestor's name.)
 *
 * The field roles and the range widgets (`progressbar`, `meter`, `scrollbar`,
 * `separator`) never reach this check — {@link NATIVE_AX_AUTHOR_NAMED_ROLES}
 * already keeps them unnamed, value or not — so it is what covers the roles
 * that otherwise read their text. A `0` is a value; an empty string or `null`
 * is none.
 */
function carriesValue(node: RawNativeAXNode): boolean {
  const value = node.value?.value;
  return value !== undefined && value !== null && String(value) !== "";
}

/**
 * The text Chromium hung DIRECTLY on `node`: its own `StaticText` children,
 * concatenated in document order, with a `LineBreak` read as a space. The
 * native analog of the DOM producer's own-text name fallback, which
 * concatenates an element's own text-node children and the text of the
 * role-less inline wrappers Chromium gives no node (`isTextRun` in
 * extraction/dom-extractor) — the very runs Chromium hangs here — and skips
 * every other child element's text.
 *
 * This is how a paragraph that mixes plain text with inline elements keeps its
 * words: `<p>See <a>#386</a> and <code>x</code> here.</p>` puts "See ", " and "
 * and " here." on `StaticText` children of the paragraph, between a kept `link`
 * and `code` — and since a node with kept children is not a leaf, the deep
 * search below never runs for it. Chromium keeps each run's own whitespace
 * (`"See "`, `" and "`), so plain concatenation reads right.
 *
 * Strictly direct: it never enters another node, dropped or kept. A kept child
 * owns its text; a dropped wrapper (`LabelText`, a bare `generic`, an ignored
 * span) is one Chromium gave a node of its own, whose text the DOM producer
 * keeps off the element around it too — and crossing into an out-of-flow one
 * glues words, because the whitespace beside it has already collapsed.
 *
 * On a node with kept children it runs only for the prose roles in
 * {@link NATIVE_AX_OWN_TEXT_ROLES}: a dialog or landmark with a loose sentence
 * beside its buttons has no accessible name, and must keep reading that way.
 * It never runs for {@link NATIVE_AX_AUTHOR_NAMED_ROLES}, even on a leaf, nor
 * for a node that {@link carriesValue}. It also names a block of text that is
 * kept for holding it — see {@link textBlock}.
 */
function directText(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): string {
  let text = "";
  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (!child || child.ignored) continue;
    const role = child.role?.value;
    if (role === "StaticText") text += child.name?.value ?? "";
    else if (role === "LineBreak") text += " ";
  }
  return collapseWhitespace(text);
}

/**
 * Chromium often leaves a node's visible text on a `StaticText`/`LabelText`
 * descendant while the node's own name is empty — and the text is not always
 * a DIRECT child (`LabelText` usually carries no name itself; its text sits
 * on its own `StaticText` child, sometimes under a dropped `generic` too).
 * So promotion searches depth-first through the node's DROPPED descendants,
 * in document order, for the first named `StaticText`/`LabelText`. Kept
 * descendants are never entered: their text belongs to them.
 *
 * Callers only invoke this for normalized LEAVES (no kept descendants) with
 * an empty name, and only once {@link directText} found nothing. The leaf
 * guard is what keeps deep search safe — without it a container like `main`
 * would steal the text of a dropped form label deep in its subtree. Nor is it
 * ever invoked for an author-named role (NATIVE_AX_AUTHOR_NAMED_ROLES): a
 * `textbox` whose *value* lives in a StaticText child, or an `<svg role="img">`
 * with a `<text>` inside, stays as unnamed as Chromium left it. Nor for a node
 * that {@link carriesValue}: an editor's typed text is not its name.
 * And the search never enters a dropped descendant that carries a value.
 *
 * The block of text a leaf is named after stays dropped: `<li><div>Alpha</div>
 * </li>` reads `listitem "Alpha"`. Every other block is kept as a node of its
 * own, and a node whose only kept children are blocks is still named here as
 * a leaf — see {@link textBlock}.
 */
function promoteNameFromDroppedDescendants(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): string {
  return collapseWhitespace(promotionSource(node, byId)?.name?.value ?? "");
}

/** The text run {@link promoteNameFromDroppedDescendants} names `node` after,
 *  if any. */
function promotionSource(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): RawNativeAXNode | undefined {
  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (!child || isKept(child, byId)) continue;
    // A dropped node's value is no more its ancestor's name than its own. (A
    // role-less `<div contenteditable>` is kept, not dropped, so the `isKept`
    // check above already stops there; this guards any other value carrier.)
    if (carriesValue(child)) continue;
    // A dropped sectionheader/sectionfooter is name-from-author only: its
    // loose text (a byline) must not name the ancestor it flattened into —
    // the DOM producer never names anything from it either.
    if (NATIVE_AX_DROP_WHEN_BARE.has(child.role?.value ?? "")) continue;
    if (
      NATIVE_AX_NAME_SOURCE_ROLES.has(child.role?.value ?? "") &&
      collapseWhitespace(child.name?.value ?? "") !== ""
    ) {
      return child;
    }
    const fromDescendants = promotionSource(child, byId);
    if (fromDescendants) return fromDescendants;
  }
  return undefined;
}

/**
 * Whether the text inside `node` is its own, so no block of it is loose: a
 * role in {@link NATIVE_AX_TEXT_OWNING_ROLES} (naming another node with that
 * text, holding it as a value, or keeping it presentational); one in
 * {@link NATIVE_AX_NAME_FROM_CONTENT_ROLES} that Chromium named, from that
 * text; or a node that {@link carriesValue} or is editable, whatever its role,
 * since an editor's text is what was typed into it. It holds for the whole
 * subtree, through kept nodes and dropped ones alike.
 */
function ownsText(node: RawNativeAXNode): boolean {
  const role = node.role?.value ?? "";
  return (
    NATIVE_AX_TEXT_OWNING_ROLES.has(role) ||
    (NATIVE_AX_NAME_FROM_CONTENT_ROLES.has(role) &&
      collapseWhitespace(node.name?.value ?? "") !== "") ||
    carriesValue(node) ||
    isEditable(node)
  );
}

/**
 * The text of a block that holds text of its own, or `""` for anything else:
 * a bare `generic` (the `<div>` around a sentence) with text on its own
 * `StaticText` children ({@link directText}).
 *
 * Chromium names no generic, so the normalizer drops one as a wrapper, and with
 * it the text runs only it carried. One block can still name the kept ancestor
 * it flattens into (see {@link promoteNameFromDroppedDescendants}): that block
 * stays dropped. Every other one is kept, named from its own text —
 * `generic "A window splitter is a moveable separator."`, the line the DOM
 * producer prints for the same `<div>` — where its text vanished before:
 * beside a kept sibling (an APG pattern card's description beside the link to
 * the pattern, a sentence beside a button in `main` or in a dialog), beside the
 * block a list item is named after, under an ancestor that takes no name from
 * it (a `<main>` holding nothing but a `<div>` of text, a byline in a bare
 * `<header>`), and with no kept ancestor at all. A kept child, such as an
 * inline link, nests beneath it. Which block names its ancestor is
 * `namingBlock` in {@link normalizeNativeAX}.
 *
 * Never inside a node that {@link ownsText}. Nor is an ignored node a block,
 * even with text of its own: Chromium ignores a `<div>` that mixes text with
 * blocks, and a `<span>` that is a flex or grid item, and their text is still
 * dropped beside a kept sibling.
 */
function textBlock(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): string {
  if (
    node.ignored ||
    !NATIVE_AX_DROP_UNLESS_NAMED.has(node.role?.value ?? "")
  ) {
    return "";
  }
  return directText(node, byId);
}

/**
 * Normalize a flat `getFullAXTree` node list: drop vocabulary noise and
 * ignored nodes, re-parent surviving descendants to the nearest kept
 * ancestor, keep a block of text wherever its text would otherwise be lost,
 * promote names off dropped text children, and map Blink roles to engine
 * roles. Returns kept nodes in document order (parents before their children).
 */
export function normalizeNativeAX(rawNodes: RawNativeAXNode[]): NativeAXNode[] {
  const byId = new Map(rawNodes.map((n) => [n.nodeId, n]));
  const out: NativeAXNode[] = [];
  const rawOf = new Map<NativeAXNode, RawNativeAXNode>();

  // Whether `raw` has a kept node anywhere below it, reached through dropped
  // ones, so that it is no leaf whatever blocks of text are kept beneath it.
  // Memoized, since every block under it asks.
  const keptBelow = new Map<string, boolean>();
  const hasKeptBelow = (raw: RawNativeAXNode): boolean => {
    let known = keptBelow.get(raw.nodeId);
    if (known === undefined) {
      known = (raw.childIds ?? []).some((childId) => {
        const child = byId.get(childId);
        return (
          child !== undefined && (isKept(child, byId) || hasKeptBelow(child))
        );
      });
      keptBelow.set(raw.nodeId, known);
    }
    return known;
  };

  // The block of text `parent`'s name would come from, by raw id: the one
  // whose own text promotion names it after, when promotion is what names it
  // — a node whose only kept children are blocks of text is still named as a
  // leaf (see the post-pass). That block stays dropped, since kept it would
  // say the name twice; every other block under `parent` is kept. So keeping
  // blocks never changes a name: `<li><div>Alpha</div></li>` still reads
  // `listitem "Alpha"`, and `<li><div>Alice</div><div>Engineer</div></li>`
  // reads `listitem "Alice"` holding `generic "Engineer"`, which was lost.
  // Memoized: every block under one node asks.
  const namingBlockOf = new Map<NativeAXNode, string | null>();
  const namingBlock = (parent: NativeAXNode): string | null => {
    let known = namingBlockOf.get(parent);
    if (known === undefined) {
      known = findNamingBlock(parent);
      namingBlockOf.set(parent, known);
    }
    return known;
  };
  const findNamingBlock = (parent: NativeAXNode): string | null => {
    const parentRaw = rawOf.get(parent);
    if (parentRaw === undefined) return null;
    // Named already, or no leaf: promotion never runs for it.
    if (parent.name !== "" || hasKeptBelow(parentRaw)) return null;
    // Named by its author only: it takes no name from any text.
    if (NATIVE_AX_AUTHOR_NAMED_ROLES.has(parentRaw.role?.value ?? "")) {
      return null;
    }
    // Named after its own text, which comes first, not a block's.
    if (directText(parentRaw, byId) !== "") return null;
    // The node holding the text run promotion names it after: a block, or
    // something no block is (a label, an ignored wrapper), so none stays
    // dropped for it.
    return promotionSource(parentRaw, byId)?.parentId ?? null;
  };
  const visit = (
    nodeId: string,
    depth: number,
    parent: NativeAXNode | null,
    inOwner: boolean,
  ): void => {
    const raw = byId.get(nodeId);
    if (!raw) return;
    const owned = inOwner || ownsText(raw);
    const kept = isKept(raw, byId);
    const text = kept || owned ? "" : textBlock(raw, byId);
    const block =
      text !== "" && (parent === null || namingBlock(parent) !== raw.nodeId);
    if (!kept && !block) {
      // Flattened: children re-parent to the nearest kept ancestor,
      // at the same depth.
      for (const childId of raw.childIds ?? []) {
        visit(childId, depth, parent, owned);
      }
      return;
    }
    const node: NativeAXNode = {
      id: idOf(raw),
      role: mapNativeAXRole(raw.role?.value ?? ""),
      name: block ? text : collapseWhitespace(raw.name?.value ?? ""),
      depth,
      backendDOMNodeId:
        typeof raw.backendDOMNodeId === "number" ? raw.backendDOMNodeId : null,
      childIds: [],
    };
    out.push(node);
    rawOf.set(node, raw);
    parent?.childIds.push(node.id);
    for (const childId of raw.childIds ?? []) {
      visit(childId, depth + 1, node, owned);
    }
  };

  // Multi-frame note: every raw node without a parentId is treated as a
  // top-level root, so a cross-frame payload (multiple RootWebAreas)
  // serializes child documents as separate top-level subtrees. Nesting them
  // at their <iframe> location needs frame metadata only a transport has
  // (frameId → DOM.getFrameOwner): the transport reads each frame on its own
  // and grafts it with `graftNativeFrame` (./frames.ts), as the extension's
  // debugger mode does. This pure module never sees more than one document.
  for (const root of rawNodes.filter((n) => !n.parentId)) {
    visit(root.nodeId, 0, null, false);
  }

  // Name promotion is a post-pass so the leaf guard can see the normalized
  // shape. An unnamed leaf takes the text on its own StaticText children
  // (directText), else the first text in its dropped subtree
  // (promoteNameFromDroppedDescendants). A node with kept children takes its
  // own text only if it is a prose role — see NATIVE_AX_OWN_TEXT_ROLES. A
  // block of text was named from its own text as it was kept, and is no kept
  // child here: a node holding only blocks is named as a leaf, after its own
  // text or the one block left dropped for it (see namingBlock).
  for (const node of out) {
    if (node.name) continue;
    const raw = rawOf.get(node);
    if (!raw) continue;
    const role = raw.role?.value ?? "";
    // Named by its author only: Chromium's empty name is the finding, and no
    // text inside it stands in for one, leaf or not. An unlabeled
    // `<span role="img">🎉</span>` stays a bare `img` — see
    // NATIVE_AX_AUTHOR_NAMED_ROLES.
    if (NATIVE_AX_AUTHOR_NAMED_ROLES.has(role)) continue;
    // Its text is its value: what was typed into an editor, or a range
    // widget's fallback. Never a name — see carriesValue.
    if (carriesValue(raw)) continue;
    // No kept node anywhere below it but blocks of text (a link inside a
    // block still counts).
    const isLeaf = !hasKeptBelow(raw);
    if (isLeaf || NATIVE_AX_OWN_TEXT_ROLES.has(role)) {
      node.name = directText(raw, byId);
    }
    if (!node.name && isLeaf) {
      node.name = promoteNameFromDroppedDescendants(raw, byId);
    }
  }

  return out;
}

/**
 * Serialize a normalized native tree in the engine's standard shape —
 * indented `role "name"` lines, comparable with `serializeTree` output.
 */
export function serializeNativeAX(nodes: NativeAXNode[]): string {
  return nodes
    .map((n) => {
      const label = n.name ? `${n.role} "${n.name}"` : n.role;
      return `${"  ".repeat(n.depth)}${label}`;
    })
    .join("\n");
}
