/**
 * Stages of the views summary that work on the outline (headings) view, the
 * reorder passes, and the totality rollup. Split out of views-summary.ts so the
 * pipeline there stays a readable sequence; every stage here consumes the
 * shared multisets in place and appends to the caller's `changes`, exactly as
 * the inline code did.
 */

import { INTERACTIVE_ROLES } from "@real-a11y-dev/audit";
import { splitStatesBlock } from "@real-a11y-dev/serialize";

import type { ViewDiff } from "./views-diff.js";
import {
  controlDesc,
  headingDesc,
  type Ignore,
  landmarkDesc,
  lcsLength,
  type Multiset,
  nameDesc,
  outlineHeadings,
  parseOutlineLine,
  parseRoleLine,
  plural,
  rawLines,
  REORDER_LCS_LIMIT,
  sameMultiset,
  statesDesc,
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

/**
 * State stage 0b — see the pipeline in views-summary.ts. Removed and added
 * lines that are the same once their `{…}` states block is set aside are
 * elements whose states changed (a box checked, a disclosure collapsed, a
 * description reworded): not removals plus additions, and in the tabs view
 * not a stop "renamed" to its own name. It is also how an old baseline reads
 * against text that prints the block: `(none) → checked`.
 *
 * Lines pair when as many left as arrived under one identity, so no element
 * of it can have appeared or disappeared. Usually that is one line each
 * side; when several same-name elements changed in different ways, the
 * statement lists each side's blocks (`checked=false; checked →
 * checked=mixed (×2)`) rather than guess which became which. A count that
 * differs is left for the later stages' add/remove statements.
 *
 * The tabs view goes first and consumes each paired stop's tree line too, so
 * the tree pass doesn't report the same element a second time. No tool here
 * writes tab stops with a block today: `real-a11y snapshot` and MCP
 * checkpoints record no tab order, and artifacts that do carry one predate
 * the block. The tabs pass is for a third-party artifact, or a snapshot that
 * records tab order again; every artifact the tools write is paired by the
 * tree pass alone.
 *
 * Elements that only traded states (two "Select row" checkboxes swapping
 * which is checked) leave the multisets equal, so nothing pairs here:
 * {@link swappedStates} reports them from the tree's line order.
 */
export function stateChanges(m: StageMultisets, changes: ViewChange[]): void {
  pairStateChanges(
    {
      view: "tabs",
      removed: m.tabsRemoved,
      added: m.tabsAdded,
      mirror: { removed: m.treeRemoved, added: m.treeAdded },
    },
    changes,
  );
  pairStateChanges(
    { view: "tree", removed: m.treeRemoved, added: m.treeAdded },
    changes,
  );
}

interface StatePairing {
  view: "tree" | "tabs";
  removed: Multiset;
  added: Multiset;
  /** The tree view's multisets, when pairing the tabs view. */
  mirror?: { removed: Multiset; added: Multiset };
}

interface IdentityLines {
  removed: string[];
  added: string[];
}

/** One side's lines, and the tree view's lines a tabs pass consumes with
 * them. */
interface PairSide {
  ms: Multiset;
  mirror?: { ms: Multiset; index: Map<string, string[]> };
}

function pairStateChanges(
  { view, removed, added, mirror }: StatePairing,
  changes: ViewChange[],
): void {
  // The tree-line index is built once per pass: looking a stop's tree line up
  // by scanning every tree line per stop is quadratic on a page whose stops
  // all changed.
  const removedSide: PairSide = { ms: removed };
  const addedSide: PairSide = { ms: added };
  if (mirror) {
    removedSide.mirror = {
      ms: mirror.removed,
      index: indexByRoleName(mirror.removed),
    };
    addedSide.mirror = {
      ms: mirror.added,
      index: indexByRoleName(mirror.added),
    };
  }

  for (const [identity, b] of groupByIdentity(removed, added)) {
    const n = sumCounts(removed, b.removed);
    if (n === 0 || sumCounts(added, b.added) !== n) continue;
    const blocks = { from: b.removed.map(blockOf), to: b.added.map(blockOf) };
    consumeSide(removedSide, b.removed);
    consumeSide(addedSide, b.added);
    changes.push(stateChange(view, identity, { ...blocks, n }));
  }
}

/** Removed and added lines grouped by the line without its states block. */
function groupByIdentity(
  removed: Multiset,
  added: Multiset,
): Map<string, IdentityLines> {
  const byIdentity = new Map<string, IdentityLines>();
  const bucket = (key: string) => {
    const identity = splitStatesBlock(key).line;
    let b = byIdentity.get(identity);
    if (!b) byIdentity.set(identity, (b = { removed: [], added: [] }));
    return b;
  };
  for (const key of removed.keys()) bucket(key).removed.push(key);
  for (const key of added.keys()) bucket(key).added.push(key);
  return byIdentity;
}

/** Take every line of `keys` from its side, and its tree lines with it. */
function consumeSide(side: PairSide, keys: readonly string[]): void {
  for (const key of keys) {
    const count = side.ms.get(key) ?? 0;
    take(side.ms, key, count);
    if (side.mirror)
      takeMirrored(side.mirror.ms, side.mirror.index, key, count);
  }
}

/** A line's block contents, `""` when it has none. */
const blockOf = (line: string) => splitStatesBlock(line).block ?? "";

/** The element a state statement is about: role, name and level, with an
 * unnamed element read as `(no accessible name)` only where that is a defect
 * (an interactive role) and as `(unnamed)` everywhere else. */
function stateSubject(identity: string): string {
  const { role, name = "", level } = parseRoleLine(identity);
  const desc = INTERACTIVE_ROLES.has(role)
    ? controlDesc(role, name)
    : landmarkDesc(role, name);
  return level === undefined ? desc : `${desc} (level ${level})`;
}

/**
 * A `state-changed` statement. `from` and `to` list each side's blocks. The
 * message shows them all, `; `-joined, `(none)` for a line without one. The
 * structured `from` / `to` fields carry a block's contents (`""` for none)
 * only when one line changed into one line, so they have a single encoding;
 * when several same-name lines paired, the message alone says how.
 */
export function stateChange(
  view: "tree" | "tabs",
  identity: string,
  { from, to, n }: { from: string[]; to: string[]; n: number },
): ViewChange {
  const { role, name = "" } = parseRoleLine(identity);
  const side = (blocks: string[]) => blocks.map(statesDesc).join("; ");
  const single = from.length === 1 && to.length === 1;
  return {
    kind: "state-changed",
    view,
    message: withCount(
      `States changed: ${stateSubject(identity)}: ${side(from)} → ${side(to)}`,
      n,
    ),
    role,
    ...(name !== "" ? { name } : {}),
    ...(single ? { from: from[0], to: to[0] } : {}),
    ...(n > 1 ? { count: n } : {}),
  };
}

const sumCounts = (ms: Multiset, keys: readonly string[]) =>
  keys.reduce((sum, key) => sum + (ms.get(key) ?? 0), 0);

/** One line becoming another whose blocks differ, tallied by identity and
 * blocks so identical changes coalesce into one `(×N)` statement. */
export type StateTally = Map<
  string,
  { identity: string; from: string; to: string; n: number }
>;

/** Tally `before` → `after` when their blocks differ. */
export function tallyBlockChange(
  tally: StateTally,
  before: string,
  after: string,
): void {
  const from = blockOf(before);
  const to = blockOf(after);
  if (from === to) return;
  const identity = splitStatesBlock(after).line;
  const id = `${identity}\u0000${from}\u0000${to}`;
  const entry = tally.get(id);
  if (entry) entry.n++;
  else tally.set(id, { identity, from, to, n: 1 });
}

/** Push the tallied changes as tree-view statements. */
export function flushStateTally(
  tally: StateTally,
  changes: ViewChange[],
): void {
  for (const { identity, from, to, n } of tally.values()) {
    changes.push(stateChange("tree", identity, { from: [from], to: [to], n }));
  }
}

/**
 * Elements that only traded states — two "Select row" checkboxes swapping
 * which is checked — leave both sides with the same lines, so the multiset
 * diff is empty and nothing pairs. When the tree reads the same line by line
 * once blocks are set aside, each position whose block changed is one
 * element whose states changed. Any other difference in order is a reorder,
 * which this leaves alone.
 *
 * Like the reorder passes, it runs only when the tree's multiset diff is
 * empty: a swap alongside any other tree change goes unreported (the other
 * change still flags the page). Aligning the unchanged lines would find it,
 * but would also re-report state changes the pairing stage already made.
 */
export function swappedStates(
  input: Pick<ReorderInput, "views" | "base" | "pr" | "ignore">,
  changes: ViewChange[],
): void {
  const { views, base, pr, ignore } = input;
  if (views.tree.added.length > 0 || views.tree.removed.length > 0) return;
  const before = rawLines(base.tree, ignore);
  const after = rawLines(pr.tree, ignore);
  if (before.length !== after.length) return;
  const tally: StateTally = new Map();
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    if (splitStatesBlock(before[i]).line !== splitStatesBlock(after[i]).line)
      return;
    tallyBlockChange(tally, before[i], after[i]);
  }
  flushStateTally(tally, changes);
}

const roleNameKey = (role: string, name: string) => `${role}\u0000${name}`;

/** Tree lines by role and name, level suffix and states block ignored. */
function indexByRoleName(ms: Multiset): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const key of ms.keys()) {
    const { role, name = "" } = parseRoleLine(key);
    const k = roleNameKey(role, name);
    const keys = index.get(k);
    if (keys) keys.push(key);
    else index.set(k, [key]);
  }
  return index;
}

/**
 * Consume `n` of a paired stop's tree lines: those with the same role, name
 * and block first, then any with the same role and name, as the other tab
 * stages do. The fallback keeps a tree line whose block differs from its tab
 * line's from being reported a second time by the tree pass.
 */
function takeMirrored(
  ms: Multiset,
  index: Map<string, string[]>,
  tabKey: string,
  n: number,
): void {
  const { role, name = "" } = parseRoleLine(tabKey);
  const block = splitStatesBlock(tabKey).block ?? "";
  const keys = index.get(roleNameKey(role, name)) ?? [];
  let remaining = n;
  for (const key of keys) {
    if (remaining === 0) return;
    if ((splitStatesBlock(key).block ?? "") === block)
      remaining -= take(ms, key, remaining);
  }
  for (const key of keys) {
    if (remaining === 0) return;
    remaining -= take(ms, key, remaining);
  }
}

/** Consume one tree line for a heading, whatever `{…}` states block it
 * carries: the outline has no block, and a heading line left behind for its
 * block would be counted again by the rollup. Returns the line it took, so a
 * caller pairing two headings can see whether their blocks changed too. */
function takeTreeHeading(
  ms: Multiset,
  name: string,
  level: number,
): string | undefined {
  const bare =
    name === ""
      ? `heading (level ${level})`
      : `heading "${name}" (level ${level})`;
  if (take(ms, bare)) return bare;
  for (const key of ms.keys()) {
    if (splitStatesBlock(key).line === bare) {
      take(ms, key);
      return key;
    }
  }
  return undefined;
}

/** Take a removed and an added heading's tree lines, and tally a block
 * change between them: a heading renamed or re-levelled whose description
 * changed too says so, rather than leaving only the rename. */
function takeHeadingPair(
  m: StageMultisets,
  tally: StateTally,
  removed: { name: string; level: number },
  added: { name: string; level: number },
): void {
  const before = takeTreeHeading(m.treeRemoved, removed.name, removed.level);
  const after = takeTreeHeading(m.treeAdded, added.name, added.level);
  if (before !== undefined && after !== undefined)
    tallyBlockChange(tally, before, after);
}

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
  const { outlineAdded, outlineRemoved } = m;
  const tally: StateTally = new Map();
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
        takeHeadingPair(m, tally, { name, level: a }, { name, level: to });
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
  flushStateTally(tally, changes);
}

/** Outline stage 3b. */
export function outlineRenames(m: StageMultisets, changes: ViewChange[]): void {
  const { outlineAdded, outlineRemoved } = m;
  const tally: StateTally = new Map();
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
    takeHeadingPair(
      m,
      tally,
      { name: oldName, level },
      { name: newName, level },
    );
    changes.push({
      kind: "heading-renamed",
      view: "outline",
      message: `Heading renamed (h${level}): ${nameDesc(oldName)} → ${nameDesc(newName)}`,
      from: oldName,
      to: newName,
    });
  }
  flushStateTally(tally, changes);
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
    for (let i = 0; i < e.count; i++)
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
    for (let i = 0; i < e.count; i++)
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
    // Compared without their `{…}` blocks: same-name stops that only traded
    // states (two "A" checkboxes, one checked, swapping which) did not move.
    const baseSeq = baseStops.map((stop) => splitStatesBlock(stop).line);
    const prSeq = prStops.map((stop) => splitStatesBlock(stop).line);
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
