/**
 * Human structural summary — translate the raw added/removed view lines of a
 * page diff into plain-language change statements a non-expert reviewer can
 * act on ("Heading level changed: \"Setup\" h2 → h3"). Advisory by
 * construction: the exit gate never reads this data.
 *
 * A consumption pipeline over working multisets cloned from the ViewDiffs:
 * each stage parses, pairs, emits statements, and REMOVES the lines it
 * consumed — cross-view consumption (the tabs stage eats matching tree lines,
 * the outline stage eats tree heading lines) is what prevents one real-world
 * change from double-reporting. Everything left over lands in one `other`
 * rollup per page, so the summary is TOTAL: taxonomy gaps degrade to a count,
 * never to silence.
 *
 * Statements describe MULTISET DELTAS, not element identity — a deleted
 * "Setup" h2 can pair with an unrelated new "Setup" h3 elsewhere on the page;
 * the statement is still multiset-true. All rename pairings are strictly 1:1
 * and degrade to add/remove on any ambiguity: a confidently-wrong sentence in
 * a trusted bot comment costs more than two honest lines.
 *
 * Deterministic: no Date/Intl/locale — ordering is VIEW_CHANGE_ORDER rank,
 * then codepoint compare of `message` (localeCompare's ICU tables differ
 * across Node builds; page content is arbitrary Unicode).
 */

import { INTERACTIVE_ROLES, ROLE_FILTER_GROUPS } from "@real-a11y-dev/testing";

import { stripTabIndex, type ViewDiff } from "./views-diff.js";

export type ViewChangeKind =
  | "tabs-emptied"
  | "headings-emptied"
  | "landmark-added"
  | "landmark-removed"
  | "landmark-renamed"
  | "heading-level-changed"
  | "heading-added"
  | "heading-removed"
  | "heading-renamed"
  | "heading-order-changed"
  | "focus-stop-added"
  | "focus-stop-removed"
  | "focus-stop-renamed"
  | "tab-order-reordered"
  | "interactive-added"
  | "interactive-removed"
  | "other";

export interface ViewChange {
  kind: ViewChangeKind;
  /** Provenance — the view whose lines produced this statement. */
  view: "tree" | "outline" | "tabs";
  /** Pre-rendered plain-text sentence, single line. Wording may be refined in
   * patch releases — consumers key on `kind` + the structured fields. */
  message: string;
  role?: string;
  /** Raw accessible name, unescaped (page content — escape before markdown). */
  name?: string;
  /** Level ("h2") or old name, depending on kind. */
  from?: string;
  /** Level ("h3") or new name, depending on kind. */
  to?: string;
  /** Tab stops: 1-based position, only when unambiguous. */
  position?: number;
  /** Tab stops: total stops on the relevant side. */
  of?: number;
  /** ×N coalescing of identical statements; emptied-view old counts;
   * displaced stops for reorders. */
  count?: number;
  /** `other` rollup only: leftover line counts. */
  added?: number;
  removed?: number;
}

export interface RawViews {
  tree: string;
  outline: string;
  tabs: string;
}

export interface SummarizeViewsInput {
  views: { tree: ViewDiff; outline: ViewDiff; tabs: ViewDiff };
  /** Raw serialized views — removed-stop positions, "was N stops", the
   * still-on-page check, and the reorder passes need the full texts. */
  base: RawViews;
  pr: RawViews;
  /** The same predicate given to diffViews — every raw-text scan here must
   * skip the same lines, or ignored (volatile) lines resurface as phantom
   * reorders and wrong stop counts. */
  ignore?: (trimmedLine: string) => boolean;
}

/** Importance order — most alarming first; removals before additions
 * (removals are the higher review signal); the rollup always last. */
export const VIEW_CHANGE_ORDER: readonly ViewChangeKind[] = [
  "tabs-emptied",
  "headings-emptied",
  "landmark-removed",
  "focus-stop-removed",
  "heading-level-changed",
  "tab-order-reordered",
  "heading-order-changed",
  "landmark-added",
  "focus-stop-added",
  "heading-removed",
  "heading-added",
  "heading-renamed",
  "landmark-renamed",
  "focus-stop-renamed",
  "interactive-removed",
  "interactive-added",
  "other",
];

const RANK = new Map(VIEW_CHANGE_ORDER.map((k, i) => [k, i]));

// Sentinels emitted by @real-a11y-dev/serialize for empty views.
const NO_HEADINGS = "(no headings)";
const NOTHING_FOCUSABLE = "(nothing focusable)";

const LANDMARK_ROLES: ReadonlySet<string> = new Set(
  ROLE_FILTER_GROUPS["landmark"] ?? [],
);

/** Reorder detection is O(n·m) LCS — skip pathological pages. */
const REORDER_LCS_LIMIT = 500;

type Ignore = ((trimmedLine: string) => boolean) | undefined;

// ── line grammar ─────────────────────────────────────────────────────────────

interface ParsedLine {
  role: string;
  /** Accessible name; undefined when the line has none. Unescaped. */
  name?: string;
  /** `(level N)` suffix — legal on any role, not just headings. */
  level?: number;
}

/**
 * Parse a tree or tabs view line: `ROLE [ "NAME" ] [ (level N) ]`. The level
 * suffix is stripped FIRST (end-anchored, so a literal "(level 2)" inside a
 * quoted name never matches); names are NOT quote-escaped, so the name is
 * everything between the first `"` and the LAST `"`.
 */
function parseRoleLine(line: string): ParsedLine {
  let rest = line;
  let level: number | undefined;
  const suffix = / \(level (\d+)\)$/.exec(rest);
  if (suffix) {
    level = Number(suffix[1]);
    rest = rest.slice(0, rest.length - suffix[0].length);
  }
  const space = rest.indexOf(" ");
  if (space === -1) {
    return level === undefined ? { role: rest } : { role: rest, level };
  }
  const role = rest.slice(0, space);
  const tail = rest.slice(space + 1);
  if (tail.length >= 2 && tail.startsWith('"') && tail.endsWith('"')) {
    const name = tail.slice(1, -1);
    return level === undefined ? { role, name } : { role, name, level };
  }
  // Unexpected shape — keep the role, let the line ride to the rollup.
  return level === undefined ? { role } : { role, level };
}

/** Outline line: `h{N} NAME` (name may be absent — an unnamed heading trims
 * from `h2 ` to `h2`). Levels 0 and 7+ are legal via aria-level. */
function parseOutlineLine(
  line: string,
): { level: number; name: string } | null {
  const m = /^h(\d+)(?: (.*))?$/.exec(line);
  if (!m) return null;
  return { level: Number(m[1]), name: m[2] ?? "" };
}

// ── multiset helpers ─────────────────────────────────────────────────────────

type Multiset = Map<string, number>;

function toMultiset(lines: readonly string[]): Multiset {
  const ms: Multiset = new Map();
  for (const line of lines) ms.set(line, (ms.get(line) ?? 0) + 1);
  return ms;
}

function take(ms: Multiset, key: string, n = 1): number {
  const have = ms.get(key) ?? 0;
  const taken = Math.min(have, n);
  if (taken === 0) return 0;
  if (have === taken) ms.delete(key);
  else ms.set(key, have - taken);
  return taken;
}

function total(ms: Multiset): number {
  let sum = 0;
  for (const n of ms.values()) sum += n;
  return sum;
}

/** Consume up to `n` tree lines matching (role, name), tolerating any
 * `(level N)` suffix — a role-overridden focusable carries a level in the tree
 * but never in the tabs view. Consuming `n` (not 1) matters when a tabs
 * statement coalesces N identical stops: leaving N−1 tree lines behind would
 * re-report them in the interactive stage. */
function takeByRoleName(ms: Multiset, role: string, name: string, n = 1): void {
  let remaining = n;
  for (const key of [...ms.keys()]) {
    if (remaining === 0) break;
    const parsed = parseRoleLine(key);
    if (parsed.role === role && (parsed.name ?? "") === name) {
      remaining -= take(ms, key, remaining);
    }
  }
}

// ── raw-text scans ───────────────────────────────────────────────────────────

function rawLines(text: string, ignore: Ignore): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (ignore?.(line)) continue;
    lines.push(line);
  }
  return lines;
}

/** The tab-order sequence as stripped stop content (`NN.` counter removed,
 * sentinel and ignored lines dropped), in document order. */
function tabStops(rawTabs: string, ignore: Ignore): string[] {
  const stops: string[] = [];
  for (const line of rawLines(rawTabs, ignore)) {
    if (line === NOTHING_FOCUSABLE) continue;
    stops.push(stripTabIndex(line));
  }
  return stops;
}

/** Position of a diffed stop in the sequence — its 1-based index, only when
 * the stripped line occurs exactly once (never guess among duplicates). The
 * index (not the line's own `NN.` counter) keeps `position ≤ of` even when
 * `--ignore-view-line` drops earlier stops from the sequence. */
function findStop(
  stops: readonly string[],
  stripped: string,
): { position?: number; of: number } {
  let found = -1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i] !== stripped) continue;
    if (found !== -1) return { of: stops.length }; // duplicate — ambiguous
    found = i;
  }
  return found === -1
    ? { of: stops.length }
    : { position: found + 1, of: stops.length };
}

function outlineHeadings(rawOutline: string, ignore: Ignore): string[] {
  return rawLines(rawOutline, ignore).filter((l) => l !== NO_HEADINGS);
}

/** How many tree lines match (role, name), level suffix ignored. */
function countInTree(
  rawTree: string,
  ignore: Ignore,
  role: string,
  name: string,
): number {
  let count = 0;
  for (const line of rawLines(rawTree, ignore)) {
    const parsed = parseRoleLine(line);
    if (parsed.role === role && (parsed.name ?? "") === name) count++;
  }
  return count;
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  // Two-row DP — lengths are bounded by REORDER_LCS_LIMIT.
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const ms = toMultiset(a);
  for (const line of b) if (take(ms, line) === 0) return false;
  return ms.size === 0;
}

// ── message helpers ──────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `navigation "Footer"` | `banner (unnamed)` — landmarks. */
const landmarkDesc = (role: string, name: string) =>
  name === "" ? `${role} (unnamed)` : `${role} "${name}"`;

/** `link "Docs"` | `button (no accessible name)` — stops + interactive. */
const controlDesc = (role: string, name: string) =>
  name === "" ? `${role} (no accessible name)` : `${role} "${name}"`;

const headingDesc = (name: string) =>
  name === "" ? "(unnamed heading)" : `"${name}"`;

const nameDesc = (name: string) => (name === "" ? "(unnamed)" : `"${name}"`);

const withCount = (message: string, n: number) =>
  n > 1 ? `${message} (×${n})` : message;

// ── the pipeline ─────────────────────────────────────────────────────────────

export function summarizeViews(input: SummarizeViewsInput): ViewChange[] {
  const { views, base, pr, ignore } = input;
  const changes: ViewChange[] = [];

  const treeAdded = toMultiset(views.tree.added);
  const treeRemoved = toMultiset(views.tree.removed);
  const outlineAdded = toMultiset(views.outline.added);
  const outlineRemoved = toMultiset(views.outline.removed);
  const tabsAdded = toMultiset(views.tabs.added);
  const tabsRemoved = toMultiset(views.tabs.removed);

  const baseStops = tabStops(base.tabs, ignore);
  const prStops = tabStops(pr.tabs, ignore);

  // 0 — sentinels. An added sentinel is a headline; a removed sentinel (the
  // page gained its first heading/stop) is dropped silently — the individual
  // added statements tell that story.
  if (take(tabsAdded, NOTHING_FOCUSABLE)) {
    const was = baseStops.length;
    changes.push({
      kind: "tabs-emptied",
      view: "tabs",
      message: `Nothing on this page is keyboard-focusable any more (was ${plural(was, "tab stop")})`,
      count: was,
    });
  }
  take(tabsRemoved, NOTHING_FOCUSABLE);
  if (take(outlineAdded, NO_HEADINGS)) {
    const was = outlineHeadings(base.outline, ignore).length;
    changes.push({
      kind: "headings-emptied",
      view: "outline",
      message: `This page no longer has any headings (was ${was})`,
      count: was,
    });
  }
  take(outlineRemoved, NO_HEADINGS);

  // 1 — tabs stage (positions make these the richest statements; they consume
  // the matching tree lines so the tree stage never re-reports the element).
  // 1a: renames — same role, exactly one removed + one added, both named.
  {
    const byRole = new Map<string, { added: string[]; removed: string[] }>();
    const bucket = (role: string) => {
      let b = byRole.get(role);
      if (!b) byRole.set(role, (b = { added: [], removed: [] }));
      return b;
    };
    for (const key of tabsAdded.keys()) {
      bucket(parseRoleLine(key).role).added.push(key);
    }
    for (const key of tabsRemoved.keys()) {
      bucket(parseRoleLine(key).role).removed.push(key);
    }
    for (const [role, b] of byRole) {
      if (b.added.length !== 1 || b.removed.length !== 1) continue;
      if (
        tabsAdded.get(b.added[0]) !== 1 ||
        tabsRemoved.get(b.removed[0]) !== 1
      )
        continue;
      const oldName = parseRoleLine(b.removed[0]).name ?? "";
      const newName = parseRoleLine(b.added[0]).name ?? "";
      if (oldName === "" || newName === "") continue; // bare lines are indistinguishable
      take(tabsRemoved, b.removed[0]);
      take(tabsAdded, b.added[0]);
      takeByRoleName(treeRemoved, role, oldName);
      takeByRoleName(treeAdded, role, newName);
      changes.push({
        kind: "focus-stop-renamed",
        view: "tabs",
        message: `Tab stop renamed: ${role} "${oldName}" → "${newName}"`,
        role,
        from: oldName,
        to: newName,
      });
    }
  }
  // 1b: removed stops — position from the BASE side; the still-on-page
  // cross-check against the PR tree picks the variant (an element that stays
  // visible but leaves the tab order is the most dangerous structural change).
  for (const [key, n] of [...tabsRemoved]) {
    take(tabsRemoved, key, n);
    const { role, name = "" } = parseRoleLine(key);
    takeByRoleName(treeRemoved, role, name, n);
    const { position, of } = findStop(baseStops, key);
    const still = countInTree(pr.tree, ignore, role, name);
    const variant =
      still === 0
        ? " (element removed from the page)"
        : still === 1
          ? " — still on the page but no longer keyboard-focusable (check this is intentional)"
          : " — may still be on the page but no longer keyboard-focusable";
    const pos =
      n === 1 && position !== undefined
        ? ` (was stop ${position} of ${of})`
        : "";
    changes.push({
      kind: "focus-stop-removed",
      view: "tabs",
      message: withCount(
        `Keyboard tab stop removed: ${controlDesc(role, name)}${pos}${variant}`,
        n,
      ),
      role,
      ...(name !== "" ? { name } : {}),
      ...(pos !== "" ? { position, of } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }
  // 1c: added stops — position from the PR side.
  for (const [key, n] of [...tabsAdded]) {
    take(tabsAdded, key, n);
    const { role, name = "" } = parseRoleLine(key);
    takeByRoleName(treeAdded, role, name, n);
    const { position, of } = findStop(prStops, key);
    const pos =
      n === 1 && position !== undefined
        ? ` (now stop ${position} of ${of})`
        : "";
    changes.push({
      kind: "focus-stop-added",
      view: "tabs",
      message: withCount(
        `Keyboard tab stop added: ${controlDesc(role, name)}${pos}`,
        n,
      ),
      role,
      ...(name !== "" ? { name } : {}),
      ...(pos !== "" ? { position, of } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }

  // 2 — tree stage: landmarks, then interactive leftovers. Tree lines with
  // role `heading` are untouched here — the outline stage owns headings.
  // 2a: landmark renames — same role, exactly one removed + one added.
  {
    const byRole = new Map<string, { added: string[]; removed: string[] }>();
    const bucket = (role: string) => {
      let b = byRole.get(role);
      if (!b) byRole.set(role, (b = { added: [], removed: [] }));
      return b;
    };
    for (const key of treeAdded.keys()) {
      const { role } = parseRoleLine(key);
      if (LANDMARK_ROLES.has(role)) bucket(role).added.push(key);
    }
    for (const key of treeRemoved.keys()) {
      const { role } = parseRoleLine(key);
      if (LANDMARK_ROLES.has(role)) bucket(role).removed.push(key);
    }
    for (const [role, b] of byRole) {
      if (b.added.length !== 1 || b.removed.length !== 1) continue;
      if (
        treeAdded.get(b.added[0]) !== 1 ||
        treeRemoved.get(b.removed[0]) !== 1
      )
        continue;
      const oldName = parseRoleLine(b.removed[0]).name ?? "";
      const newName = parseRoleLine(b.added[0]).name ?? "";
      take(treeRemoved, b.removed[0]);
      take(treeAdded, b.added[0]);
      changes.push({
        kind: "landmark-renamed",
        view: "tree",
        message: `Landmark renamed: ${role} ${nameDesc(oldName)} → ${nameDesc(newName)}`,
        role,
        from: oldName,
        to: newName,
      });
    }
  }
  // 2b: landmark add/remove.
  for (const [key, n] of [...treeRemoved]) {
    const { role, name = "" } = parseRoleLine(key);
    if (!LANDMARK_ROLES.has(role)) continue;
    take(treeRemoved, key, n);
    const message =
      role === "main"
        ? 'Landmark removed: main — skip-to-content and "jump to main" navigation may break'
        : `Landmark removed: ${landmarkDesc(role, name)}`;
    changes.push({
      kind: "landmark-removed",
      view: "tree",
      message: withCount(message, n),
      role,
      ...(name !== "" ? { name } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }
  for (const [key, n] of [...treeAdded]) {
    const { role, name = "" } = parseRoleLine(key);
    if (!LANDMARK_ROLES.has(role)) continue;
    take(treeAdded, key, n);
    changes.push({
      kind: "landmark-added",
      view: "tree",
      message: withCount(`New landmark: ${landmarkDesc(role, name)}`, n),
      role,
      ...(name !== "" ? { name } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }
  // 2c: interactive elements the tabs view can't see (menuitem, option, tab —
  // arrow-key targets inside composite widgets). Focusable ones were already
  // consumed by the tabs stage.
  for (const [key, n] of [...treeRemoved]) {
    const { role, name = "" } = parseRoleLine(key);
    if (!INTERACTIVE_ROLES.has(role)) continue;
    take(treeRemoved, key, n);
    changes.push({
      kind: "interactive-removed",
      view: "tree",
      message: withCount(
        `Interactive element removed: ${controlDesc(role, name)}`,
        n,
      ),
      role,
      ...(name !== "" ? { name } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }
  for (const [key, n] of [...treeAdded]) {
    const { role, name = "" } = parseRoleLine(key);
    if (!INTERACTIVE_ROLES.has(role)) continue;
    take(treeAdded, key, n);
    changes.push({
      kind: "interactive-added",
      view: "tree",
      message: withCount(
        `Interactive element added: ${controlDesc(role, name)}`,
        n,
      ),
      role,
      ...(name !== "" ? { name } : {}),
      ...(n > 1 ? { count: n } : {}),
    });
  }

  // 3 — outline stage (authoritative for headings; consumes the matching tree
  // `heading` lines).
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
  // 3a: level changes — group by exact name; pair k-th smallest removed level
  // with k-th smallest added level (count-aware; equal levels are impossible,
  // identical lines already cancelled in the multiset).
  {
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
  // 3b: renames — within one level, exactly one removed + one added leftover.
  {
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

  changes.sort(
    (a, b) =>
      (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
  return changes;
}
