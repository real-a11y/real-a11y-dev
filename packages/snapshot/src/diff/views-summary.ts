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

import { INTERACTIVE_ROLES } from "@real-a11y-dev/audit";
import { ROLE_FILTER_GROUPS } from "@real-a11y-dev/core";

import type { ViewDiff } from "./views-diff.js";
import {
  controlDesc,
  countInTree,
  findStop,
  focusChange,
  landmarkDesc,
  type Multiset,
  nameDesc,
  NO_HEADINGS,
  NOTHING_FOCUSABLE,
  outlineHeadings,
  parseRoleLine,
  plural,
  tabStops,
  take,
  takeByRoleName,
  toMultiset,
  withCount,
} from "./views-summary-lines.js";
import {
  outlineLeftovers,
  outlineLevelChanges,
  outlineRenames,
  reorderChanges,
  rollupChange,
  type StageMultisets,
} from "./views-summary-stages.js";

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
  | "focus-changed"
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
  "focus-changed",
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

const LANDMARK_ROLES: ReadonlySet<string> = new Set(
  ROLE_FILTER_GROUPS["landmark"] ?? [],
);

// ── the pipeline ─────────────────────────────────────────────────────────────

export function summarizeViews(input: SummarizeViewsInput): ViewChange[] {
  const { views, base, pr, ignore } = input;
  const changes: ViewChange[] = [];

  // Focus is stripped from the multiset views (see page-diff.ts) so it never
  // shows as add/remove churn — surface the transition as its own statement.
  const focus = focusChange(base.tree, pr.tree, ignore);
  if (focus) changes.push(focus);

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
  const drainTreeRoles = (
    ms: Multiset,
    roles: ReadonlySet<string>,
    kind: ViewChangeKind,
    describe: (role: string, name: string) => string,
  ) => {
    for (const [key, n] of [...ms]) {
      const { role, name = "" } = parseRoleLine(key);
      if (!roles.has(role)) continue;
      take(ms, key, n);
      changes.push({
        kind,
        view: "tree",
        message: withCount(describe(role, name), n),
        role,
        ...(name !== "" ? { name } : {}),
        ...(n > 1 ? { count: n } : {}),
      });
    }
  };
  drainTreeRoles(
    treeRemoved,
    LANDMARK_ROLES,
    "landmark-removed",
    (role, name) =>
      role === "main"
        ? 'Landmark removed: main — skip-to-content and "jump to main" navigation may break'
        : `Landmark removed: ${landmarkDesc(role, name)}`,
  );
  drainTreeRoles(
    treeAdded,
    LANDMARK_ROLES,
    "landmark-added",
    (role, name) => `New landmark: ${landmarkDesc(role, name)}`,
  );
  // 2c: interactive elements the tabs view can't see (menuitem, option, tab —
  // arrow-key targets inside composite widgets). Focusable ones were already
  // consumed by the tabs stage.
  drainTreeRoles(
    treeRemoved,
    INTERACTIVE_ROLES,
    "interactive-removed",
    (role, name) => `Interactive element removed: ${controlDesc(role, name)}`,
  );
  drainTreeRoles(
    treeAdded,
    INTERACTIVE_ROLES,
    "interactive-added",
    (role, name) => `Interactive element added: ${controlDesc(role, name)}`,
  );

  const m: StageMultisets = {
    treeAdded,
    treeRemoved,
    outlineAdded,
    outlineRemoved,
    tabsAdded,
    tabsRemoved,
  };
  // Order matters: each outline stage consumes lines the previous one left.
  outlineLevelChanges(m, changes);
  outlineRenames(m, changes);
  outlineLeftovers(m, changes);
  reorderChanges({ views, base, pr, ignore, baseStops, prStops }, changes);
  rollupChange(m, changes);

  changes.sort(
    (a, b) =>
      (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
  return changes;
}
