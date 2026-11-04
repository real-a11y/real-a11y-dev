/**
 * What changed in Chrome's tree between two reads of the same page: the
 * rows the page added, the rows still there that changed, and the rows it
 * took away. Pure, over two reads' nodes. `compareRead`
 * (`use-native-changes.ts`) decides which two trees to compare, and
 * `NativeTreeView.tsx` marks the result on the tree.
 *
 * Two reads of one document name an element the same way: a node's id is
 * built from its element's backend node id (`ax-dom-<n>`), which lasts as
 * long as the element does. A node with no element of its own, such as text
 * a stylesheet generates, is named by its AX node id instead (`ax-<n>`),
 * which Chromium hands out afresh whenever it builds the page's
 * accessibility tree again, as it may between two reads. Such a node is never
 * compared, and is new or gone only as part of a subtree that is.
 */

import { splitNativeNodeId } from "@real-a11y-dev/core";

import type { NativeNode } from "./native-actions.js";

/** One thing about a row that differs between the two reads. */
export interface NativeNodeChange {
  /**
   * What changed: `role`, `name`, `description`, `value`, `placeholder` or
   * `controls`, or one state or property as `states.<key>` or
   * `properties.<key>`, the way the row's badges name them.
   */
  field: string;
  /** Absent where the row had none, or a state was off. For `controls`,
   *  the ids of the rows it controls, sorted and space-separated. */
  before?: string | boolean;
  after?: string | boolean;
}

/** A row the earlier read had and the later one doesn't. */
export interface NativeRemovedNode {
  id: string;
  role: string;
  name: string;
}

export interface NativeTreeChanges {
  /** Rows the later read has and the earlier one didn't: every row of each
   *  new subtree. */
  added: ReadonlySet<string>;
  /** Rows both reads have that differ, with what differs on each. */
  changed: ReadonlyMap<string, readonly NativeNodeChange[]>;
  /** Rows the earlier read had and the later one doesn't, every row of each
   *  gone subtree, in the earlier read's document order. */
  removed: readonly NativeRemovedNode[];
  /** For each row the later read still has, how many rows went from under
   *  it: the rows of each gone subtree whose parent it was, or, where that
   *  parent went too without a subtree of its own, its nearest ancestor
   *  that stayed. */
  removedUnder: ReadonlyMap<string, number>;
  /**
   * Where moving from change to change stops, in the later read's document
   * order: the top row of each new subtree, each changed row, and each row
   * rows went from under.
   */
  stops: readonly string[];
}

/** Changes with nothing in them. */
export const NO_NATIVE_CHANGES: NativeTreeChanges = {
  added: new Set(),
  changed: new Map(),
  removed: [],
  removedUnder: new Map(),
  stops: [],
};

/** Whether `changes` has nothing to show. */
export function isEmptyNativeChanges(changes: NativeTreeChanges): boolean {
  return (
    changes.added.size === 0 &&
    changes.changed.size === 0 &&
    changes.removed.length === 0
  );
}

/**
 * Whether a later read names this node the same way: true for an id built
 * from an element's backend node id, false for one built from an AX node id
 * (see the file header). Anything else, such as a test's own ids, counts as
 * lasting.
 */
export function isLastingNativeId(id: string): boolean {
  const { localId } = splitNativeNodeId(id);
  return !localId.startsWith("ax-") || localId.startsWith("ax-dom-");
}

/** The rows a read shows, in document order, and each one's parent. Walks
 *  from `rootId`, as the tree draws it: a node nothing leads to has no row.
 *  A node met twice is walked once. */
function walk(
  nodes: ReadonlyMap<string, NativeNode>,
  rootId: string,
): { order: string[]; parentOf: Map<string, string> } {
  const order: string[] = [];
  const parentOf = new Map<string, string>();
  const seen = new Set<string>();
  const stack = nodes.has(rootId) ? [rootId] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const children = nodes.get(id)?.childIds ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      if (seen.has(child) || !nodes.has(child)) continue;
      if (!parentOf.has(child)) parentOf.set(child, id);
      stack.push(child);
    }
  }
  return { order, parentOf };
}

/** A text the row shows only when it has some: an empty one is none. */
function shownText(text: string | undefined): string | undefined {
  return text === "" ? undefined : text;
}

/** A state as the row's badges show it: an `expanded` of false reads
 *  "collapsed", but any other state that is off shows no badge, as if it
 *  were absent. */
function shownState(
  key: string,
  value: string | boolean | undefined,
): string | boolean | undefined {
  return value === false && key !== "expanded" ? undefined : value;
}

/** Each key once, `a`'s first. */
function keysOf(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): string[] {
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
}

/** The rows `node` controls, as one comparable value. */
function controlsOf(node: NativeNode): string | undefined {
  return node.controls && node.controls.length > 0
    ? [...node.controls].sort().join(" ")
    : undefined;
}

/**
 * What differs between two reads of one row, as the row shows it. Focus is
 * left out: it moves on every click, and the panel follows it on its own.
 * So is what the row never shows, such as the raw value a retype starts
 * from, or the numbers Focus sync gives it.
 */
export function compareNativeNodes(
  before: NativeNode,
  after: NativeNode,
): NativeNodeChange[] {
  const changes: NativeNodeChange[] = [];
  const add = (
    field: string,
    from: string | boolean | undefined,
    to: string | boolean | undefined,
  ) => {
    if (from === to) return;
    changes.push({
      field,
      ...(from === undefined ? {} : { before: from }),
      ...(to === undefined ? {} : { after: to }),
    });
  };
  add("role", before.role, after.role);
  add("name", shownText(before.name), shownText(after.name));
  add(
    "description",
    shownText(before.description),
    shownText(after.description),
  );
  // An empty value shows (`= ""`), unlike an empty name.
  add("value", before.value, after.value);
  add(
    "placeholder",
    shownText(before.placeholder),
    shownText(after.placeholder),
  );
  for (const key of keysOf(after.states, before.states)) {
    if (key === "focused") continue;
    add(
      `states.${key}`,
      shownState(key, before.states?.[key]),
      shownState(key, after.states?.[key]),
    );
  }
  for (const key of keysOf(after.properties, before.properties)) {
    add(`properties.${key}`, before.properties?.[key], after.properties?.[key]);
  }
  add("controls", controlsOf(before), controlsOf(after));
  return changes;
}

/** A read's rows as {@link walk} finds them, and the set of them. */
type Walked = ReturnType<typeof walk> & { shown: Set<string> };

function walked(
  nodes: ReadonlyMap<string, NativeNode>,
  rootId: string,
): Walked {
  const w = walk(nodes, rootId);
  return { ...w, shown: new Set(w.order) };
}

/** Whether `id` belongs with a subtree `within` holds its parent in: a
 *  node that doesn't last is new or gone only with its parent. */
function counts(
  id: string,
  parentOf: Map<string, string>,
  within: ReadonlySet<string>,
): boolean {
  const parent = parentOf.get(id);
  return isLastingNativeId(id) || (parent !== undefined && within.has(parent));
}

/** The rows only the later read shows, and those both show that differ. */
function addedAndChanged(
  before: ReadonlyMap<string, NativeNode>,
  after: ReadonlyMap<string, NativeNode>,
  was: Walked,
  now: Walked,
): Pick<NativeTreeChanges, "added" | "changed"> {
  const added = new Set<string>();
  const changed = new Map<string, NativeNodeChange[]>();
  for (const id of now.order) {
    if (!was.shown.has(id)) {
      if (counts(id, now.parentOf, added)) added.add(id);
    } else if (isLastingNativeId(id)) {
      const changes = compareNativeNodes(before.get(id)!, after.get(id)!);
      if (changes.length > 0) changed.set(id, changes);
    }
  }
  return { added, changed };
}

/** The rows only the earlier read shows, each charged to the nearest row
 *  above it that the later read still shows, or, with none (the root moved,
 *  from the synthetic `ax-root` to a single landmark, say), to the later
 *  read's root. */
function removedRows(
  before: ReadonlyMap<string, NativeNode>,
  was: Walked,
  now: Walked,
): Pick<NativeTreeChanges, "removed" | "removedUnder"> {
  const gone = new Set<string>();
  const removed: NativeRemovedNode[] = [];
  const removedUnder = new Map<string, number>();
  for (const id of was.order) {
    if (now.shown.has(id) || !counts(id, was.parentOf, gone)) continue;
    gone.add(id);
    const node = before.get(id)!;
    removed.push({ id, role: node.role, name: node.name });
    let site = was.parentOf.get(id);
    while (site !== undefined && !now.shown.has(site)) {
      site = was.parentOf.get(site);
    }
    site ??= now.order[0];
    if (site !== undefined) {
      removedUnder.set(site, (removedUnder.get(site) ?? 0) + 1);
    }
  }
  return { removed, removedUnder };
}

/**
 * What changed between `before` and `after`, two reads of one document:
 * `after` drawn from `rootId`, and `before` from `beforeRootId`, the same
 * root unless the document's root moved between them (see `rootIdOf`). A
 * node that moved is neither new nor gone: it is the same element, and only
 * what it shows is compared.
 */
export function diffNativeTrees(
  before: ReadonlyMap<string, NativeNode>,
  after: ReadonlyMap<string, NativeNode>,
  rootId: string,
  beforeRootId = rootId,
): NativeTreeChanges {
  const was = walked(before, beforeRootId);
  const now = walked(after, rootId);
  const { added, changed } = addedAndChanged(before, after, was, now);
  const { removed, removedUnder } = removedRows(before, was, now);
  const stops = now.order.filter((id) => {
    if (changed.has(id) || removedUnder.has(id)) return true;
    const parent = now.parentOf.get(id);
    return added.has(id) && (parent === undefined || !added.has(parent));
  });
  return { added, changed, removed, removedUnder, stops };
}
