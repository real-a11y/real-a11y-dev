/**
 * Stages of the views summary that work on the outline (headings) view, the
 * reorder passes, and the totality rollup. Split out of views-summary.ts so the
 * pipeline there stays a readable sequence; every stage here consumes the
 * shared multisets in place and appends to the caller's `changes`, exactly as
 * the inline code did.
 */

import type { ViewDiff } from "./views-diff.js";
import {
  headingDesc,
  type Ignore,
  lcsLength,
  type Multiset,
  nameDesc,
  outlineHeadings,
  parseOutlineLine,
  parseRoleLine,
  plural,
  REORDER_LCS_LIMIT,
  sameMultiset,
  take,
  total,
  withCount,
} from "./views-summary-lines.js";
import type { RawViews, ViewChange } from "./views-summary.js";

/** The six multisets the stages consume from, named by view and side. */
export interface StageMultisets {
  treeAdded: Multiset;
  treeRemoved: Multiset;
  outlineAdded: Multiset;
  outlineRemoved: Multiset;
  tabsAdded: Multiset;
  tabsRemoved: Multiset;
}

export interface ReorderInput {
  views: { tree: ViewDiff; outline: ViewDiff; tabs: ViewDiff };
  base: RawViews;
  pr: RawViews;
  ignore: Ignore;
  baseStops: readonly string[];
  prStops: readonly string[];
}

const takeTreeHeading = (ms: Multiset, name: string, level: number) =>
  take(
    ms,
    name === ""
      ? `heading (level ${level})`
      : `heading "${name}" (level ${level})`,
  );
interface OutlineEntry {
  key: string;
  level: number;
  name: string;
  count: number;
}
const outlineEntries = (ms: Multiset): OutlineEntry[] => {
  const entries: OutlineEntry[] = [];
  for (const [key, count] of ms) {
    const parsed = parseOutlineLine(key);
    if (parsed) entries.push({ key, ...parsed, count });
  }
  return entries;
};

/** Outline stage 3a — see the pipeline in views-summary.ts. */
export function outlineLevelChanges(
  m: StageMultisets,
  changes: ViewChange[],
): void {
  const { treeAdded, treeRemoved, outlineAdded, outlineRemoved } = m;
  // 3a: level changes — group by exact name; pair k-th smallest removed level
  // with k-th smallest added level (count-aware; equal levels are impossible,
  // identical lines already cancelled in the multiset).
  const byName = new Map<string, { added: number[]; removed: number[] }>();
  const bucket = (name: string) => {
    let b = byName.get(name);
    if (!b) byName.set(name, (b = { added: [], removed: [] }));
    return b;
  };
  for (const e of outlineEntries(outlineAdded)) {
    for (let i = 0; i < e.count; i++) bucket(e.name).added.push(e.level);
  }
  for (const e of outlineEntries(outlineRemoved)) {
    for (let i = 0; i < e.count; i++) bucket(e.name).removed.push(e.level);
  }
  for (const [name, b] of byName) {
    b.added.sort((x, y) => x - y);
    b.removed.sort((x, y) => x - y);
    const pairs = new Map<string, { a: number; b: number; n: number }>();
    for (let i = 0; i < Math.min(b.added.length, b.removed.length); i++) {
      const a = b.removed[i];
      const to = b.added[i];
      // Equal levels normally can't pair (identical lines already cancelled),
      // but an accessible name literally ending in " [focused]" collides with
      // the stripped focus marker on the unquoted outline line — never emit a
      // no-op "h2 → h2".
      if (a === to) continue;
      const id = `${a}→${to}`;
      const prev = pairs.get(id);
      if (prev) prev.n++;
      else pairs.set(id, { a, b: to, n: 1 });
    }
    for (const { a, b: to, n } of pairs.values()) {
      const nameKey = name === "" ? `h${a}` : `h${a} ${name}`;
      const newKey = name === "" ? `h${to}` : `h${to} ${name}`;
      take(outlineRemoved, nameKey, n);
      take(outlineAdded, newKey, n);
      for (let i = 0; i < n; i++) {
        takeTreeHeading(treeRemoved, name, a);
        takeTreeHeading(treeAdded, name, to);
      }
      changes.push({
        kind: "heading-level-changed",
        view: "outline",
        message: withCount(
          `Heading level changed: ${headingDesc(name)} h${a} → h${to}`,
          n,
        ),
        ...(name !== "" ? { name } : {}),
        from: `h${a}`,
        to: `h${to}`,
        ...(n > 1 ? { count: n } : {}),
      });
    }
  }
}

/** Outline stage 3b. */
export function outlineRenames(m: StageMultisets, changes: ViewChange[]): void {
  const { treeAdded, treeRemoved, outlineAdded, outlineRemoved } = m;
  // 3b: renames — within one level, exactly one removed + one added leftover.
  const byLevel = new Map<
    number,
    { added: OutlineEntry[]; removed: OutlineEntry[] }
  >();
  const bucket = (level: number) => {
    let b = byLevel.get(level);
    if (!b) byLevel.set(level, (b = { added: [], removed: [] }));
    return b;
  };
  for (const e of outlineEntries(outlineAdded)) bucket(e.level).added.push(e);
  for (const e of outlineEntries(outlineRemoved))
    bucket(e.level).removed.push(e);
  for (const [level, b] of byLevel) {
    if (b.added.length !== 1 || b.removed.length !== 1) continue;
    if (b.added[0].count !== 1 || b.removed[0].count !== 1) continue;
    const oldName = b.removed[0].name;
    const newName = b.added[0].name;
    // Same-name "rename" is never real — guards the outline focus-marker
    // collision (a name ending in " [focused]" parses equal on both sides).
    if (oldName === newName) continue;
    take(outlineRemoved, b.removed[0].key);
    take(outlineAdded, b.added[0].key);
    takeTreeHeading(treeRemoved, oldName, level);
    takeTreeHeading(treeAdded, newName, level);
    changes.push({
      kind: "heading-renamed",
      view: "outline",
      message: `Heading renamed (h${level}): ${nameDesc(oldName)} → ${nameDesc(newName)}`,
      from: oldName,
      to: newName,
    });
  }
}

/** Outline stage 3c. */
export function outlineLeftovers(
  m: StageMultisets,
  changes: ViewChange[],
): void {
  const { treeAdded, treeRemoved, outlineAdded, outlineRemoved } = m;
  // 3c: add/remove leftovers.
  for (const e of outlineEntries(outlineRemoved)) {
    take(outlineRemoved, e.key, e.count);
    takeTreeHeading(treeRemoved, e.name, e.level);
    changes.push({
      kind: "heading-removed",
      view: "outline",
      message: withCount(
        `Heading removed: h${e.level} ${nameDesc(e.name)}`,
        e.count,
      ),
      ...(e.name !== "" ? { name: e.name } : {}),
      from: `h${e.level}`,
      ...(e.count > 1 ? { count: e.count } : {}),
    });
  }
  for (const e of outlineEntries(outlineAdded)) {
    take(outlineAdded, e.key, e.count);
    takeTreeHeading(treeAdded, e.name, e.level);
    changes.push({
      kind: "heading-added",
      view: "outline",
      message: withCount(
        `Heading added: h${e.level} ${nameDesc(e.name)}`,
        e.count,
      ),
      ...(e.name !== "" ? { name: e.name } : {}),
      to: `h${e.level}`,
      ...(e.count > 1 ? { count: e.count } : {}),
    });
  }
}

/** Stage 4 — reorder passes. */
export function reorderChanges(
  input: ReorderInput,
  changes: ViewChange[],
): void {
  const { views, base, pr, ignore, baseStops, prStops } = input;
  // 4 — reorder passes. Pure reorders are invisible in the multiset diff BY
  // DESIGN (views-diff.ts) — today those pages produce no signal anywhere.
  // Only run when the corresponding ViewDiff is empty: mixed edit+reorder is
  // too ambiguous to narrate and the edits already flag the page.
  if (
    views.tabs.added.length === 0 &&
    views.tabs.removed.length === 0 &&
    baseStops.length <= REORDER_LCS_LIMIT &&
    prStops.length <= REORDER_LCS_LIMIT
  ) {
    const baseSeq = baseStops;
    const prSeq = prStops;
    if (
      baseSeq.join("\n") !== prSeq.join("\n") &&
      sameMultiset(baseSeq, prSeq)
    ) {
      const displaced = baseSeq.length - lcsLength(baseSeq, prSeq);
      changes.push({
        kind: "tab-order-reordered",
        view: "tabs",
        message: `Keyboard tab order changed: ${plural(displaced, "stop")} moved (same ${baseSeq.length} stops)`,
        count: displaced,
        of: baseSeq.length,
      });
    }
  }
  if (views.outline.added.length === 0 && views.outline.removed.length === 0) {
    const baseSeq = outlineHeadings(base.outline, ignore);
    const prSeq = outlineHeadings(pr.outline, ignore);
    if (
      baseSeq.join("\n") !== prSeq.join("\n") &&
      sameMultiset(baseSeq, prSeq)
    ) {
      changes.push({
        kind: "heading-order-changed",
        view: "outline",
        message: "Heading order changed (same headings, different order)",
      });
    }
  }
}

/** Stage 5 — totality rollup. */
export function rollupChange(m: StageMultisets, changes: ViewChange[]): void {
  const {
    treeAdded,
    treeRemoved,
    outlineAdded,
    outlineRemoved,
    tabsAdded,
    tabsRemoved,
  } = m;
  // 5 — totality rollup: whatever no stage consumed, counted with a role
  // histogram so a mass content edit reads as one calm sentence.
  const leftoverAdded =
    total(treeAdded) + total(outlineAdded) + total(tabsAdded);
  const leftoverRemoved =
    total(treeRemoved) + total(outlineRemoved) + total(tabsRemoved);
  if (leftoverAdded + leftoverRemoved > 0) {
    const histogram = new Map<string, number>();
    for (const ms of [treeAdded, treeRemoved]) {
      for (const [key, n] of ms) {
        const { role } = parseRoleLine(key);
        histogram.set(role, (histogram.get(role) ?? 0) + n);
      }
    }
    const roles = [...histogram]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 4);
    const rest = histogram.size - roles.length;
    const hist = roles.map(([role, n]) => `${role} ×${n}`).join(", ");
    const histClause =
      hist === ""
        ? ""
        : rest > 0
          ? ` (${hist}, +${plural(rest, "other role")})`
          : ` (${hist})`;
    changes.push({
      kind: "other",
      view: "tree",
      message: `Other content changed: ${leftoverAdded} added / ${leftoverRemoved} removed line${
        leftoverAdded + leftoverRemoved === 1 ? "" : "s"
      }${histClause} — expand the raw diff below`,
      added: leftoverAdded,
      removed: leftoverRemoved,
    });
  }
}
