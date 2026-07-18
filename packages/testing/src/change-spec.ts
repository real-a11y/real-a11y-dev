import type { NodeChange, SemanticNode, TreeDiff } from "@real-a11y-dev/core";

/** Match a diffed node by role and (optionally) accessible name. */
export interface NodeMatcher {
  role: string;
  /** String → case-insensitive, whitespace-normalized exact; RegExp → tested. */
  name?: string | RegExp;
}

export interface ChangedMatcher extends NodeMatcher {
  /** Dot-paths that must be among the node's changed fields, e.g.
   *  `["a11y.states.expanded"]`. Omitted = any change to this node. */
  changes?: string[];
}

/**
 * A structured assertion over a `TreeDiff` — the ergonomic form of
 * `flow().expectChanges`. Subset by default (resilient to incidental changes
 * like a live-region tick); `exact: true` forbids anything beyond what's listed.
 */
export interface ChangeSpec {
  added?: NodeMatcher[];
  removed?: NodeMatcher[];
  changed?: ChangedMatcher[];
  /**
   * false (default): the diff must contain AT LEAST these. true: and nothing
   * else — except a `childIds`-only change, which is the structural shadow of
   * an add/remove and is never counted as an unexpected extra.
   */
  exact?: boolean;
}

function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function nameMatches(name: string, want: string | RegExp | undefined): boolean {
  if (want === undefined) return true;
  return want instanceof RegExp
    ? want.test(name)
    : normalizeName(name) === normalizeName(want);
}

function nodeMatches(node: SemanticNode, m: NodeMatcher): boolean {
  return node.a11y.role === m.role && nameMatches(node.a11y.name, m.name);
}

function describeMatcher(m: NodeMatcher): string {
  if (m.name === undefined) return m.role;
  const name = m.name instanceof RegExp ? m.name.toString() : `"${m.name}"`;
  return `${m.role} ${name}`;
}

function describeNode(n: SemanticNode): string {
  return n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role;
}

/** Greedy 1:1 assignment of matchers to nodes (a matcher consumes one node). */
function matchNodes(
  nodes: readonly SemanticNode[],
  matchers: readonly NodeMatcher[],
): { missing: NodeMatcher[]; extras: SemanticNode[] } {
  const used = new Set<number>();
  const missing: NodeMatcher[] = [];
  for (const m of matchers) {
    let hit = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!used.has(i) && nodeMatches(nodes[i], m)) {
        hit = i;
        break;
      }
    }
    if (hit === -1) missing.push(m);
    else used.add(hit);
  }
  return { missing, extras: nodes.filter((_, i) => !used.has(i)) };
}

function matchChanged(
  changes: readonly NodeChange[],
  matchers: readonly ChangedMatcher[],
): { missing: ChangedMatcher[]; extras: NodeChange[] } {
  const used = new Set<number>();
  const missing: ChangedMatcher[] = [];
  for (const m of matchers) {
    let hit = -1;
    for (let i = 0; i < changes.length; i++) {
      if (used.has(i)) continue;
      const c = changes[i];
      const pathsPresent = (m.changes ?? []).every((p) =>
        c.changes.includes(p),
      );
      if (nodeMatches(c.after, m) && pathsPresent) {
        hit = i;
        break;
      }
    }
    if (hit === -1) missing.push(m);
    else used.add(hit);
  }
  return { missing, extras: changes.filter((_, i) => !used.has(i)) };
}

/**
 * Check a {@link TreeDiff} against a {@link ChangeSpec}. Returns a list of
 * human-readable problems (empty = pass). Subset semantics unless
 * `spec.exact`, which also flags nodes the spec didn't account for.
 */
export function checkChangeSpec(diff: TreeDiff, spec: ChangeSpec): string[] {
  const added = matchNodes(diff.added, spec.added ?? []);
  const removed = matchNodes(diff.removed, spec.removed ?? []);
  const changed = matchChanged(diff.changed, spec.changed ?? []);
  const problems: string[] = [];

  for (const m of added.missing) {
    problems.push(`expected an ADDED ${describeMatcher(m)}, but none matched`);
  }
  for (const m of removed.missing) {
    problems.push(`expected a REMOVED ${describeMatcher(m)}, but none matched`);
  }
  for (const m of changed.missing) {
    const paths = m.changes?.length ? ` changing ${m.changes.join(", ")}` : "";
    problems.push(
      `expected a CHANGED ${describeMatcher(m)}${paths}, but none matched`,
    );
  }

  if (spec.exact) {
    for (const n of added.extras) {
      problems.push(`unexpected ADDED ${describeNode(n)}`);
    }
    for (const n of removed.extras) {
      problems.push(`unexpected REMOVED ${describeNode(n)}`);
    }
    for (const c of changed.extras) {
      // A `childIds`-only change is the structural shadow of an add/remove the
      // user almost certainly already asserted (adding a child mutates the
      // parent's child list). Forcing every parent's churn to be enumerated
      // would defeat `exact`; assert it explicitly with a `changed` matcher
      // (`changes: ["childIds"]`) if a reorder is what you care about.
      if (c.changes.length === 1 && c.changes[0] === "childIds") continue;
      problems.push(
        `unexpected CHANGED ${describeNode(c.after)} (${c.changes.join(", ")})`,
      );
    }
  }
  return problems;
}
