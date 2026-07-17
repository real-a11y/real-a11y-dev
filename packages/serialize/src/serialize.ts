import type {
  ExtractionResult,
  NodeChange,
  SemanticNode,
  TreeDiff,
} from "@real-a11y-dev/core";
import { linearize, getOutline, getTabSequence } from "@real-a11y-dev/core";

import { extract } from "./extract.js";

/** A DOM root to extract from, or an already-extracted tree. */
export type SerializeInput = Element | ExtractionResult;

export interface SerializeOptions {
  /** `"a11y"` (default) or `"dom"` — only used when a root Element is passed. */
  mode?: "a11y" | "dom";
  /**
   * Redact matching substrings from accessible names and text content — useful
   * for stripping user data or timestamps so the output stays deterministic.
   */
  redact?: RegExp[];
  /** Include generic container nodes (`role="generic"`). Default false. */
  includeGeneric?: boolean;
  /**
   * Mark the element focused at extraction time with a trailing `[focused]`.
   * Default `true`. The marker appears only when something inside the tree
   * actually holds focus — a fresh page (focus on `<body>`) serializes
   * unchanged. Pass `false` for marker-free output, e.g. when diffing against a
   * tree from a source that has no focus concept (a native browser tree).
   */
  markFocus?: boolean;
}

function redactText(input: string, patterns: RegExp[] | undefined): string {
  if (!patterns?.length) return input;
  let out = input;
  for (const p of patterns) out = out.replace(p, "[REDACTED]");
  return out;
}

/**
 * The shared node label — `role "name" (level N)` — with no indentation and no
 * focus marker. This is the vocabulary every serializer speaks; `serializeTree`
 * wraps it with indent + focus, `serializeTreeDiff` prefixes it with `+`/`-`/`~`.
 * Never contains a node id (ids are internal, test-order-dependent).
 */
function nodeLabel(node: SemanticNode, redact?: RegExp[]): string {
  const name = redactText(node.a11y.name, redact);
  const nameSuffix = name ? ` "${name}"` : "";
  const level = node.a11y.properties?.level;
  const levelSuffix = level ? ` (level ${level})` : "";
  return `${node.a11y.role}${nameSuffix}${levelSuffix}`;
}

/** Resolve an input to a tree, extracting from the DOM only when needed. */
function toTree(input: SerializeInput, mode: "a11y" | "dom" = "a11y") {
  return input instanceof Element ? extract(input, mode) : input;
}

/**
 * Indent depth for each node we print, counted as its number of *printed*
 * ancestors.
 *
 * `node.depth` is the node's depth in the extracted tree, which is the wrong
 * ruler here: this serializer hides nodes (generics, and anything `linearize`
 * filters), and a hidden node's slot has to close up behind it. Printing
 * `node.depth` instead left children indented under a parent that isn't on the
 * page — a `<div aria-label="Decor">` around a button rendered the button as a
 * child of whatever preceded it. Counting printed ancestors is also why this
 * walks `parentId` rather than comparing depths: two nodes at the same depth
 * can have different parents, only one of which survived.
 */
function printedDepths(
  tree: ExtractionResult,
  printed: SemanticNode[],
): Map<string, number> {
  const printedIds = new Set(printed.map((n) => n.id));
  const depths = new Map<string, number>();

  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parentId = tree.nodes.get(id)?.parentId;
    const depth = parentId
      ? depthOf(parentId) + (printedIds.has(parentId) ? 1 : 0)
      : 0;
    depths.set(id, depth);
    return depth;
  };

  for (const node of printed) depthOf(node.id);
  return depths;
}

/**
 * Serialize the full semantic tree (or a DOM root) as a deterministic indented
 * string of roles + accessible names.
 *
 * The format is stable across runs: roles, accessible names, and a `[focused]`
 * marker on the element focused at extraction time — no node ids, no
 * timestamps. Determinism is run-to-run (same steps → same focus → same
 * output); pass `markFocus: false` to drop the marker. Suitable for snapshot
 * comparisons and shareable reports.
 */
export function serializeTree(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const {
    mode = "a11y",
    redact,
    includeGeneric = false,
    markFocus = true,
  } = options;
  const tree = toTree(input, mode);
  const focusedId = markFocus ? tree.focusedId : undefined;

  const printed = linearize(tree).filter(
    (node) => includeGeneric || node.a11y.role !== "generic",
  );
  const depths = printedDepths(tree, printed);

  const lines: string[] = [];
  for (const node of printed) {
    const indent = "  ".repeat(depths.get(node.id) ?? 0);
    const focusSuffix = node.id === focusedId ? " [focused]" : "";
    lines.push(`${indent}${nodeLabel(node, redact)}${focusSuffix}`);
  }
  return lines.join("\n");
}

/**
 * Serialize the heading outline (`h1`..`h6` in document order) as an indented
 * string. Accepts a DOM root or a pre-extracted tree.
 */
export function serializeOutline(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const { markFocus = true } = options;
  const tree = toTree(input);
  const focusedId = markFocus ? tree.focusedId : undefined;
  const entries = getOutline(tree);
  if (entries.length === 0) return "(no headings)";
  return entries
    .map((e) => {
      const marker = e.id === focusedId ? " [focused]" : "";
      return `${"  ".repeat(Math.max(0, e.level - 1))}h${e.level} ${e.name}${marker}`;
    })
    .join("\n");
}

/**
 * Serialize the computed tab order — role + accessible name, in the order a
 * user encounters while pressing Tab. Accepts a DOM root or a pre-extracted
 * tree.
 */
export function serializeTabSequence(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const { markFocus = true } = options;
  const tree = toTree(input);
  const focusedId = markFocus ? tree.focusedId : undefined;
  const seq = getTabSequence(tree);
  if (seq.length === 0) return "(nothing focusable)";
  return seq
    .map((n, i) => {
      const name = n.a11y.name ? ` "${n.a11y.name}"` : "";
      const marker = n.id === focusedId ? " [focused]" : "";
      return `${String(i + 1).padStart(2, "0")}. ${n.a11y.role}${name}${marker}`;
    })
    .join("\n");
}

// ─── tree diff ───────────────────────────────────────────────────────────────

export interface TreeDiffSerializeOptions {
  /** Redact matching substrings from names/values (like `SerializeOptions.redact`). */
  redact?: RegExp[];
  /**
   * Focus at the two capture points, resolved by the CALLER (a captured tree
   * can't answer "what was focused then" after the fact, and core `diffTrees`
   * stays focus-agnostic). When the focused node differs, a trailing
   * `focus: <before> → <after>` line is rendered; `(none)` marks a null side.
   */
  focusBefore?: SemanticNode | null;
  focusAfter?: SemanticNode | null;
}

/** `n children` / `1 child` — child-LIST changes render as counts, never ids. */
function childCount(n: number): string {
  return `${n} ${n === 1 ? "child" : "children"}`;
}

/**
 * A child-list change, id-free. core flags `childIds` when the child count OR
 * the child order differs, so counts alone would render a pure reorder as an
 * identical `N → N` (a change line showing no difference). Instead: report the
 * count transition, annotate `(reordered)` when surviving children moved, and
 * render a pure reorder as `reordered (N children)` — no misleading arrow. Ids
 * are used only to detect membership/order changes, never emitted; the exact
 * permutation isn't recoverable here (the moved children carry no change of
 * their own), so a reorder is reported as a fact, not a sequence.
 */
function childIdsDetail(change: NodeChange): string {
  const before = change.before.childIds;
  const after = change.after.childIds;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const removed = before.filter((id) => !afterSet.has(id)).length;
  const added = after.filter((id) => !beforeSet.has(id)).length;

  if (added === 0 && removed === 0) {
    // Same membership, so `childIds` was flagged for order alone.
    return `childIds reordered (${childCount(after.length)})`;
  }
  // Did the children present on BOTH sides also change relative order?
  const survivorsBefore = before.filter((id) => afterSet.has(id));
  const survivorsAfter = after.filter((id) => beforeSet.has(id));
  const reordered = survivorsBefore.join(",") !== survivorsAfter.join(",");
  const suffix = reordered ? " (reordered)" : "";
  return `childIds ${childCount(before.length)} → ${childCount(after.length)}${suffix}`;
}

/** Walk a dot-path (`a11y.states.expanded`) to its value; undefined if absent. */
function resolvePath(node: SemanticNode, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc == null ? undefined : (acc as Record<string, unknown>)[key],
      node,
    );
}

/** A single field value, rendered: strings quoted (and redacted), `(unset)`
 *  for a field present on only one side. */
function formatValue(value: unknown, redact?: RegExp[]): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") {
    return JSON.stringify(redactText(value, redact));
  }
  return JSON.stringify(value);
}

/** `<path> <before> → <after>` for one changed field of a node. */
function changeDetail(
  change: NodeChange,
  path: string,
  redact?: RegExp[],
): string {
  if (path === "childIds") return childIdsDetail(change);
  const before = formatValue(resolvePath(change.before, path), redact);
  const after = formatValue(resolvePath(change.after, path), redact);
  return `${path} ${before} → ${after}`;
}

/** `focus: <before> → <after>`, or null when focus didn't move. */
function focusLine(
  before: SemanticNode | null | undefined,
  after: SemanticNode | null | undefined,
  redact?: RegExp[],
): string | null {
  // A transition needs BOTH endpoints. `undefined` = "not supplied" (caller
  // isn't tracking focus, or supplied only one side); only an explicit `null`
  // means "nothing focused". Conflating them would render a one-sided call as
  // a false focus-lost/gained claim, so require both to be present.
  if (before === undefined || after === undefined) return null;
  const beforeId = before?.id ?? null;
  const afterId = after?.id ?? null;
  if (beforeId === afterId) return null; // both null, or the same node
  const from = before ? nodeLabel(before, redact) : "(none)";
  const to = after ? nodeLabel(after, redact) : "(none)";
  return `focus: ${from} → ${to}`;
}

/**
 * Serialize a {@link TreeDiff} (from core `diffTrees`) as a committable,
 * snapshot-stable change list — the interaction-effect counterpart to
 * `serializeTree`. Assert what one interaction changed in a single line each:
 *
 * ```
 * + option "Spain"
 * - listitem "Old entry"
 * ~ combobox "Country": a11y.states.expanded false → true
 * ~ main "Results": childIds 3 children → 5 children
 * focus: button "Country" → listbox "Countries"
 * ```
 *
 * One line per added/removed node, one per (node, changed-field) pair, then an
 * optional focus transition (see {@link TreeDiffSerializeOptions}). Nodes are
 * labeled `role "name" (level N)` — never a node id, so the output is stable
 * across runs and safe to commit. Section order and within-section order follow
 * the diff's own (document) order; an empty diff renders `(no changes)`.
 */
export function serializeTreeDiff(
  diff: TreeDiff,
  options: TreeDiffSerializeOptions = {},
): string {
  const { redact, focusBefore, focusAfter } = options;
  const lines: string[] = [];

  for (const node of diff.added) lines.push(`+ ${nodeLabel(node, redact)}`);
  for (const node of diff.removed) lines.push(`- ${nodeLabel(node, redact)}`);
  for (const change of diff.changed) {
    const label = nodeLabel(change.after, redact);
    for (const path of change.changes) {
      lines.push(`~ ${label}: ${changeDetail(change, path, redact)}`);
    }
  }

  const focus = focusLine(focusBefore, focusAfter, redact);
  if (focus) lines.push(focus);

  return lines.length ? lines.join("\n") : "(no changes)";
}
