/**
 * What changed in a tree between two reads of it: the rows the later read
 * added, the rows still there that changed, and the rows it took away. Pure,
 * over two reads' nodes, for any tree whose nodes list their children: the
 * rules a caller passes say what differs on a row, and which ids name the same
 * node in a later read. The extension's Chrome tree passes its own
 * (`native-tree-diff.ts`); `tree-changes.ts` turns the result into what a tree
 * view marks, and `tree-changes-dialogs.ts` picks which two trees to compare
 * while a dialog stands in front of the page.
 */

/** A node as the diff walks it: its children, in order. */
export interface TreeRow {
  childIds?: readonly string[];
}

/** A read's nodes, and the root it is drawn from. Two reads of one page
 *  needn't share a root: a page whose tree is rooted at its one landmark is
 *  rooted elsewhere once it holds two. */
export interface Tree<N extends TreeRow> {
  nodes: ReadonlyMap<string, N>;
  rootId: string;
}

/** One thing about a row that differs between the two reads. */
export interface FieldChange {
  /**
   * What changed, as the rules name it. A tree view reads `role`, `name`,
   * `description`, `value`, `placeholder` and `controls`, and one state or
   * property as `states.<key>` or `properties.<key>`, the way a row's badges
   * name them.
   */
  field: string;
  /** Absent where the row had none, or a state was off. For `controls`,
   *  the ids of the rows it controls, sorted and space-separated. */
  before?: string | boolean;
  after?: string | boolean;
}

/** What one side of a {@link FieldChange} holds. */
type FieldValue = string | boolean | undefined;

/** `field`'s change from `before` to `after` added to `changes`, if it
 *  changed at all: how `DiffRules.compare` builds its list. */
export function noteFieldChange(
  changes: FieldChange[],
  field: string,
  before: FieldValue,
  after: FieldValue,
): void {
  if (before === after) return;
  changes.push({
    field,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  });
}

/** A row the earlier read had and the later one doesn't. */
export interface RemovedRow {
  id: string;
  role: string;
  name: string;
}

export interface TreeChanges {
  /** Rows the later read has and the earlier one didn't: every row of each
   *  new subtree. */
  added: ReadonlySet<string>;
  /** Rows both reads have that differ, with what differs on each. */
  changed: ReadonlyMap<string, readonly FieldChange[]>;
  /** Rows the earlier read had and the later one doesn't, every row of each
   *  gone subtree, in the earlier read's document order. */
  removed: readonly RemovedRow[];
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
export const NO_TREE_CHANGES: TreeChanges = {
  added: new Set(),
  changed: new Map(),
  removed: [],
  removedUnder: new Map(),
  stops: [],
};

/** Whether `changes` has nothing to show. */
export function isEmptyTreeChanges(changes: TreeChanges): boolean {
  return (
    changes.added.size === 0 &&
    changes.changed.size === 0 &&
    changes.removed.length === 0
  );
}

/** What a tree's rows are, for comparing two reads of it. */
export interface DiffRules<N extends TreeRow> {
  /** What differs between two reads of one row, as the row shows it. */
  compare(before: N, after: N): FieldChange[];
  /**
   * Whether a later read names this node by the same id. A node a read names
   * afresh, such as text a stylesheet generates in Chrome's tree, is never
   * compared, and is new or gone only as part of a subtree that is.
   */
  lasting(id: string): boolean;
  /**
   * Whether a row both reads show is compared: {@link lasting} unless said.
   * The shared panel's own root is compared but never new or gone, as a
   * read widened to the whole page flattens it away.
   */
  compared?(id: string): boolean;
  /** The row's role and name, for the rows that went. */
  label(node: N): { role: string; name: string };
}

/** A read's rows as the tree draws them, walking from its root: their
 *  document order, each one's parent, and the set of them. */
interface Walked<N extends TreeRow> {
  nodes: ReadonlyMap<string, N>;
  order: string[];
  parentOf: Map<string, string>;
  shown: Set<string>;
}

/** The rows `tree` shows, in document order, and each one's parent. A node
 *  nothing leads to has no row. A node met twice is walked once. */
function walk<N extends TreeRow>(tree: Tree<N>): Walked<N> {
  const { nodes, rootId } = tree;
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
  return { nodes, order, parentOf, shown: new Set(order) };
}

/** The rows `tree` shows, in document order: a walk from its root, as the
 *  tree draws it. */
export function documentOrder<N extends TreeRow>(tree: Tree<N>): string[] {
  return walk(tree).order;
}

/** Whether `id` belongs with a subtree `within` holds its parent in: a
 *  node that doesn't last is new or gone only with its parent. */
function counts<N extends TreeRow>(
  id: string,
  walked: Walked<N>,
  within: ReadonlySet<string>,
  rules: DiffRules<N>,
): boolean {
  const parent = walked.parentOf.get(id);
  return rules.lasting(id) || (parent !== undefined && within.has(parent));
}

/** The rows only the later read shows, and those both show that differ. */
function addedAndChanged<N extends TreeRow>(
  was: Walked<N>,
  now: Walked<N>,
  rules: DiffRules<N>,
): Pick<TreeChanges, "added" | "changed"> {
  const added = new Set<string>();
  const changed = new Map<string, FieldChange[]>();
  const compared = rules.compared ?? rules.lasting;
  for (const id of now.order) {
    if (!was.shown.has(id)) {
      if (counts(id, now, added, rules)) added.add(id);
    } else if (compared(id)) {
      const changes = rules.compare(was.nodes.get(id)!, now.nodes.get(id)!);
      if (changes.length > 0) changed.set(id, changes);
    }
  }
  return { added, changed };
}

/** The rows only the earlier read shows, each charged to the nearest row
 *  above it that the later read still shows, or, with none (the root moved,
 *  from a synthetic root to a single landmark, say), to the later read's
 *  root. */
function removedRows<N extends TreeRow>(
  was: Walked<N>,
  now: Walked<N>,
  rules: DiffRules<N>,
): Pick<TreeChanges, "removed" | "removedUnder"> {
  const gone = new Set<string>();
  const removed: RemovedRow[] = [];
  const removedUnder = new Map<string, number>();
  for (const id of was.order) {
    if (now.shown.has(id) || !counts(id, was, gone, rules)) continue;
    gone.add(id);
    removed.push({ id, ...rules.label(was.nodes.get(id)!) });
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
 * What changed between `before` and `after`, two reads of one page, each
 * drawn from its own root. A node that moved is neither new nor gone: it is
 * the same node, and only what it shows is compared.
 */
export function diffTreeRows<N extends TreeRow>(
  before: Tree<N>,
  after: Tree<N>,
  rules: DiffRules<N>,
): TreeChanges {
  const was = walk(before);
  const now = walk(after);
  const { added, changed } = addedAndChanged(was, now, rules);
  const { removed, removedUnder } = removedRows(was, now, rules);
  const stops = now.order.filter((id) => {
    if (changed.has(id) || removedUnder.has(id)) return true;
    const parent = now.parentOf.get(id);
    return added.has(id) && (parent === undefined || !added.has(parent));
  });
  return { added, changed, removed, removedUnder, stops };
}
