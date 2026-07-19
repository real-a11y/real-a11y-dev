import type { NodeChange, SemanticNode, TreeDiff } from "@real-a11y-dev/core";
import { foldTypography } from "@real-a11y-dev/serialize";

/** Match a diffed node by role and (optionally) accessible name. */
export interface NodeMatcher {
  role: string;
  /**
   * String → case-, whitespace-, and typography-normalized exact match (so
   * `"Don't"` matches a rendered curly `"Don’t"`); RegExp → tested against the
   * typography-folded name (so `/Don't/` matches too), but case-sensitive
   * unless the pattern says otherwise.
   */
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
  return foldTypography(s).replace(/\s+/g, " ").trim().toLowerCase();
}

function nameMatches(name: string, want: string | RegExp | undefined): boolean {
  if (want === undefined) return true;
  if (typeof want === "string")
    return normalizeName(name) === normalizeName(want);
  // Clone off any global/sticky flag: `RegExp.test` on a `/g`|/y` regex
  // advances `lastIndex`, so a caller's shared or module-level pattern would
  // otherwise match statefully — alternating pass/fail across calls/matchers.
  const re =
    want.global || want.sticky
      ? new RegExp(want.source, want.flags.replace(/[gy]/g, ""))
      : want;
  // Test against the typography-folded name so a straight-quote pattern still
  // matches a rendered curly quote (the string branch normalizes both sides;
  // do the same here). Whitespace/case are left to the pattern.
  return re.test(foldTypography(name));
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

/**
 * Maximum 1:1 assignment of matchers to items (Kuhn's augmenting-path bipartite
 * matching). Greedy first-fit is WRONG here: a general matcher listed before a
 * specific one could consume the specific matcher's only viable item, reporting
 * a false "missing" even when a complete assignment exists — flipping on
 * incidental item order the spec author doesn't control. This finds a complete
 * assignment whenever one exists, so the result is order-independent.
 *
 * Returns the indices of matchers left unmatched and items left unassigned.
 */
function maxMatch(
  matcherCount: number,
  itemCount: number,
  compatible: (mi: number, ii: number) => boolean,
): { missing: number[]; extras: number[] } {
  const itemToMatcher = new Array<number>(itemCount).fill(-1);
  const augment = (mi: number, seen: boolean[]): boolean => {
    for (let ii = 0; ii < itemCount; ii++) {
      if (seen[ii] || !compatible(mi, ii)) continue;
      seen[ii] = true;
      // Free item, or its current matcher can be re-homed down the path.
      if (itemToMatcher[ii] === -1 || augment(itemToMatcher[ii], seen)) {
        itemToMatcher[ii] = mi;
        return true;
      }
    }
    return false;
  };
  for (let mi = 0; mi < matcherCount; mi++) {
    augment(mi, new Array<boolean>(itemCount).fill(false));
  }
  const matched = new Array<boolean>(matcherCount).fill(false);
  for (let ii = 0; ii < itemCount; ii++) {
    if (itemToMatcher[ii] !== -1) matched[itemToMatcher[ii]] = true;
  }
  const missing: number[] = [];
  for (let mi = 0; mi < matcherCount; mi++) if (!matched[mi]) missing.push(mi);
  const extras: number[] = [];
  for (let ii = 0; ii < itemCount; ii++) {
    if (itemToMatcher[ii] === -1) extras.push(ii);
  }
  return { missing, extras };
}

function matchNodes(
  nodes: readonly SemanticNode[],
  matchers: readonly NodeMatcher[],
): { missing: NodeMatcher[]; extras: SemanticNode[] } {
  const { missing, extras } = maxMatch(
    matchers.length,
    nodes.length,
    (mi, ii) => nodeMatches(nodes[ii], matchers[mi]),
  );
  return {
    missing: missing.map((mi) => matchers[mi]),
    extras: extras.map((ii) => nodes[ii]),
  };
}

function matchChanged(
  changes: readonly NodeChange[],
  matchers: readonly ChangedMatcher[],
): { missing: ChangedMatcher[]; extras: NodeChange[] } {
  const { missing, extras } = maxMatch(
    matchers.length,
    changes.length,
    (mi, ii) => {
      const m = matchers[mi];
      const c = changes[ii];
      return (
        nodeMatches(c.after, m) &&
        (m.changes ?? []).every((p) => c.changes.includes(p))
      );
    },
  );
  return {
    missing: missing.map((mi) => matchers[mi]),
    extras: extras.map((ii) => changes[ii]),
  };
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
