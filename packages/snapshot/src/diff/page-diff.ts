/**
 * Join two snapshot artifacts page-by-page (by `name`, never URL — base and PR
 * legitimately differ in host/port) and diff each pair. Pure: artifacts in,
 * classified result out, no browser.
 */

import {
  measuredViews,
  SNAPSHOT_VIEWS,
  type SnapshotArtifact,
  type SnapshotPage,
  type SnapshotView,
} from "../snapshot-artifact.js";

import {
  diffFindings,
  summarize,
  type DiffEntry,
  type DiffSummary,
} from "./findings-diff.js";
import { unifiedDiff, type ViewHunks } from "./unified-diff.js";
import {
  diffViews,
  stripFocusMarker,
  stripTabIndex,
  type ViewDiff,
} from "./views-diff.js";
import { summarizeViews, type ViewChange } from "./views-summary.js";

export type PageDiffStatus =
  | "ok"
  | "added" // page only in PR
  | "removed" // page only in base
  | "incomparable"; // one side errored

export interface PageDiff {
  name: string;
  status: PageDiffStatus;
  entries: DiffEntry[];
  views: { tree: ViewDiff; outline: ViewDiff; tabs: ViewDiff };
  /** Human structural summary — plain-language statements derived from the
   * view diffs. Advisory: the exit gate never reads it. Empty for
   * added/removed/incomparable pages. */
  structural: ViewChange[];
  /** Git-style unified diff of each view (context + order + indentation) — the
   * neutral, reviewable structural output. Empty hunks for
   * added/removed/incomparable pages. */
  viewHunks: ViewHunks;
  /** Why a page is incomparable (the errored side's message). */
  note?: string;
}

export interface DiffOptions {
  /** Drop view lines matching any pattern before diffing (--ignore-view-line)
   * — e.g. a generated "last updated" timestamp that differs on every build. */
  ignoreViewLine?: readonly RegExp[];
}

export interface DiffResult {
  pages: PageDiff[];
  summary: DiffSummary;
  /**
   * Views at least one side never measured, so the diff couldn't compare them
   * — reported as "not measured", never as "everything on this axis is gone".
   * The renderers surface it; the exit gate ignores it (views never gate).
   */
  skippedViews: SnapshotView[];
}

const EMPTY_VIEW: ViewDiff = { added: [], removed: [] };
const EMPTY_VIEWS = { tree: EMPTY_VIEW, outline: EMPTY_VIEW, tabs: EMPTY_VIEW };
const EMPTY_HUNKS: ViewHunks = { tree: [], outline: [], tabs: [] };

type Ignore = ((trimmedLine: string) => boolean) | undefined;

/**
 * A view neither side measured compares as nothing-versus-nothing.
 *
 * Not `""` versus the other side's content: that is the whole hazard this
 * guards. Feeding an unmeasured view into the differ would classify every line
 * on the measured side as removed — on a producer migration, "Keyboard tab stop
 * removed" once per focusable element, on every page, with no page having
 * changed. Blanking BOTH sides is what makes the axis read as unmeasured.
 *
 * Applied to EVERY view, not just `tabs`. Only `tabs` can go unmeasured today —
 * every producer emits a tree and an outline — but `meta.views` is a general
 * list, and a third-party or future artifact may declare a different subset.
 * Special-casing one view would let `skippedViews` name an axis the differ
 * quietly compared anyway: a report claiming "not compared" about something it
 * did compare is the same class of lie this whole mechanism exists to prevent.
 */
function comparable(page: SnapshotPage, compare: ReadonlySet<SnapshotView>) {
  const view = (name: SnapshotView, text: string | undefined) =>
    (compare.has(name) ? text : undefined) ?? "";
  return {
    tree: view("tree", page.tree),
    outline: view("outline", page.outline),
    tabs: view("tabs", page.tabs),
  };
}

function pageViews(
  base: SnapshotPage,
  pr: SnapshotPage,
  ignore: Ignore,
  compare: ReadonlySet<SnapshotView>,
) {
  const b = comparable(base, compare);
  const p = comparable(pr, compare);
  // `diffViews` strips the `[focused]` marker itself (before the ignore test),
  // so a pure focus move (same elements, only the focused one differs) produces
  // no structural churn — the transition is reported as a `focus-changed`
  // statement instead. The unified diff (pageHunks) keeps the marker; it's the
  // literal reviewable view.
  return {
    tree: diffViews(b.tree, p.tree, undefined, ignore),
    outline: diffViews(b.outline, p.outline, undefined, ignore),
    // Tabs are unnumbered now, but a legacy base (or third-party producer) may
    // still carry `NN.` numbers — strip them so the multiset compares stop
    // content, never the sequence counter.
    tabs: diffViews(b.tabs, p.tabs, stripTabIndex, ignore),
  };
}

/** Drop ignored lines (matched on the trimmed form, like diffViews) while
 * keeping indentation, so the unified diff never shows a volatile line. The
 * ignore test sees the focus-marker-stripped line (matching diffViews), so a
 * transient `[focused]` can't flip an ignore pattern and keep only one side. */
function stripIgnored(text: string, ignore: Ignore): string {
  if (!ignore) return text;
  return text
    .split("\n")
    .filter((line) => !ignore(stripFocusMarker(line.trim())))
    .join("\n");
}

/** Unified diff per view. Tabs are unnumbered now (the canonical form), so an
 * inserted stop is a single `+` line here — the renumber cascade that used to
 * make this hunk unreadable is gone. A legacy numbered base still diffs cleanly
 * in the multiset (stripTabIndex), but its tabs HUNK shows a one-time rewrite
 * until it is re-captured; advisory output only, never gates. */
function pageHunks(
  base: SnapshotPage,
  pr: SnapshotPage,
  ignore: Ignore,
  compare: ReadonlySet<SnapshotView>,
): ViewHunks {
  const b = comparable(base, compare);
  const p = comparable(pr, compare);
  return {
    tree: unifiedDiff(
      stripIgnored(b.tree, ignore),
      stripIgnored(p.tree, ignore),
    ),
    outline: unifiedDiff(
      stripIgnored(b.outline, ignore),
      stripIgnored(p.outline, ignore),
    ),
    tabs: unifiedDiff(
      stripIgnored(b.tabs, ignore),
      stripIgnored(p.tabs, ignore),
    ),
  };
}

/**
 * True when both sides have pages but share no `name` at all — so every page
 * classifies as added/removed and no pair is ever structurally compared. Since
 * the join is by name (never URL), this is nearly always a snapshotting slip:
 * both sides taken with positional URLs, whose auto-derived names then differ
 * by host/port. A genuine full rewrite trips it too, hence a warning, not an
 * error. Empty on either side is not this case — nothing to match against.
 */
export function noPagesMatched(
  base: SnapshotArtifact,
  pr: SnapshotArtifact,
): boolean {
  if (base.pages.length === 0 || pr.pages.length === 0) return false;
  const baseNames = new Set(base.pages.map((p) => p.name));
  return !pr.pages.some((p) => baseNames.has(p.name));
}

export function diffArtifacts(
  base: SnapshotArtifact,
  pr: SnapshotArtifact,
  options: DiffOptions = {},
): DiffResult {
  const patterns = options.ignoreViewLine ?? [];
  const ignore: Ignore = patterns.length
    ? (line) => patterns.some((re) => re.test(line))
    : undefined;
  // An axis is comparable only when BOTH sides measured it. Across a producer
  // migration the base is the side that still carries tab order — comparing it
  // against a PR that never measured one is exactly the false "N → 0" this
  // avoids.
  const baseViews = measuredViews(base);
  const prViews = measuredViews(pr);
  const compare = new Set(
    SNAPSHOT_VIEWS.filter((v) => baseViews.has(v) && prViews.has(v)),
  );
  const skippedViews = SNAPSHOT_VIEWS.filter((v) => !compare.has(v));
  const baseByName = new Map(base.pages.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const pages: PageDiff[] = [];

  // PR order drives the output; base-only pages are appended after.
  for (const prPage of pr.pages) {
    seen.add(prPage.name);
    const basePage = baseByName.get(prPage.name);
    if (!basePage) {
      pages.push({
        name: prPage.name,
        status: "added",
        entries: diffFindings([], prPage.findings),
        views: EMPTY_VIEWS,
        structural: [],
        viewHunks: EMPTY_HUNKS,
      });
      continue;
    }
    if (basePage.status === "error" || prPage.status === "error") {
      pages.push({
        name: prPage.name,
        status: "incomparable",
        entries: [],
        views: EMPTY_VIEWS,
        structural: [],
        viewHunks: EMPTY_HUNKS,
        note:
          prPage.status === "error"
            ? prPage.error
            : `base snapshot failed: ${basePage.error ?? "unknown"}`,
      });
      continue;
    }
    const views = pageViews(basePage, prPage, ignore, compare);
    pages.push({
      name: prPage.name,
      status: "ok",
      entries: diffFindings(basePage.findings, prPage.findings),
      views,
      structural: summarizeViews({
        views,
        base: comparable(basePage, compare),
        pr: comparable(prPage, compare),
        ignore,
      }),
      viewHunks: pageHunks(basePage, prPage, ignore, compare),
    });
  }

  for (const basePage of base.pages) {
    if (seen.has(basePage.name)) continue;
    pages.push({
      name: basePage.name,
      status: "removed",
      entries: diffFindings(basePage.findings, []),
      views: EMPTY_VIEWS,
      structural: [],
      viewHunks: EMPTY_HUNKS,
    });
  }

  const summary = summarize(pages.flatMap((p) => p.entries));
  return { pages, summary, skippedViews };
}
